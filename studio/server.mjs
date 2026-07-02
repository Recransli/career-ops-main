#!/usr/bin/env node
/**
 * Career-Ops Studio — zero-dependency local server.
 *
 * A thin wrapper around a career-ops checkout: it drives the repo's own
 * scripts (scan.mjs, ollama-eval.mjs, openai-eval.mjs) and only ever writes
 * USER-layer files (cv.md, config/profile.yml, portals.yml). System files
 * (modes/, templates/, *.mjs) are never touched, so `update-system.mjs`
 * keeps working.
 *
 * Privacy: binds to 127.0.0.1 only. API keys are stored in studio/.local/
 * (gitignored) and sent only to the provider you configure.
 *
 * Usage:  node server.mjs   [PORT=4949] [CAREER_OPS_ROOT=/path/to/career-ops]
 */

import http from "http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "fs";
import { join, dirname, extname, resolve, basename } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { spawn } from "child_process";

const STUDIO = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.CAREER_OPS_ROOT || join(STUDIO, ".."));
const PORT = Number(process.env.PORT || 4949);
const LOCAL = join(STUDIO, ".local");
const SETTINGS_PATH = join(LOCAL, "settings.json");
const PUBLIC = join(STUDIO, "public");

// yaml comes from the career-ops checkout's own node_modules (it needs it anyway).
let yaml = null;
try {
  yaml = (await import(pathToFileURL(join(ROOT, "node_modules", "js-yaml", "dist", "js-yaml.mjs")).href)).default;
} catch {
  console.warn("[studio] js-yaml not found — run `npm install` in the career-ops root first.");
}

// ---------------------------------------------------------------------------
// Settings (provider config, stored locally, never committed)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  provider: "ollama",              // "ollama" | "openai" (any OpenAI-compatible endpoint)
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "",
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  mkdirSync(LOCAL, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------
function providerHeaders(s) {
  const h = { "content-type": "application/json" };
  if (s.apiKey) {
    h["authorization"] = `Bearer ${s.apiKey}`;
    h["x-api-key"] = s.apiKey;            // Anthropic compat
    h["anthropic-version"] = "2023-06-01"; // harmless for others
  }
  return h;
}

async function listModels(s) {
  const base = s.baseUrl.replace(/\/$/, "");
  if (s.provider === "ollama") {
    const r = await fetch(`${base}/api/tags`);
    if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
    const data = await r.json();
    return (data.models || []).map((m) => m.name);
  }
  const r = await fetch(`${base}/models`, { headers: providerHeaders(s) });
  if (!r.ok) throw new Error(`Provider responded ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.data || []).map((m) => m.id);
}

async function chat(s, messages, { maxTokens = 2048 } = {}) {
  const base = s.baseUrl.replace(/\/$/, "");
  if (!s.model) throw new Error("No model selected — pick one in Settings.");
  if (s.provider === "ollama") {
    const r = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: s.model, messages, stream: false, options: { num_ctx: 16384 } }),
    });
    if (!r.ok) throw new Error(`Ollama responded ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).message?.content || "";
  }
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: providerHeaders(s),
    body: JSON.stringify({ model: s.model, messages, temperature: 0.4, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error(`Provider responded ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).choices?.[0]?.message?.content || "";
}

// ---------------------------------------------------------------------------
// Career-ops file helpers (USER layer only)
// ---------------------------------------------------------------------------
const P = {
  cv: join(ROOT, "cv.md"),
  profile: join(ROOT, "config", "profile.yml"),
  profileExample: join(ROOT, "config", "profile.example.yml"),
  portals: join(ROOT, "portals.yml"),
  portalsExample: join(ROOT, "templates", "portals.example.yml"),
  pipeline: join(ROOT, "data", "pipeline.md"),
  tracker: join(ROOT, "data", "applications.md"),
  reports: join(ROOT, "reports"),
  jds: join(ROOT, "jds"),
};

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

function loadYaml(p) {
  const raw = read(p);
  return raw && yaml ? yaml.load(raw) : null;
}

function groundingContext() {
  // Source-of-truth boundary: user-facing text is grounded ONLY in these files.
  const cv = read(P.cv);
  const profile = read(P.profile);
  const digest = read(join(ROOT, "article-digest.md"));
  if (!cv) throw new Error("No resume on file yet — add it in the Resume tab first.");
  let ctx = `## CANDIDATE RESUME (cv.md — the ONLY source of factual claims)\n\n${cv}`;
  if (profile) ctx += `\n\n## CANDIDATE PROFILE (config/profile.yml)\n\n${profile}`;
  if (digest) ctx += `\n\n## PROOF POINTS (article-digest.md)\n\n${digest}`;
  return ctx;
}

const GROUNDING_RULES = `STRICT GROUNDING RULES (non-negotiable):
- Every factual claim (skills, employers, metrics, projects, education) MUST come from the resume/profile above. Reorder, reframe, emphasise — NEVER invent.
- Never claim the candidate authored or built a project, tool, or library unless the resume explicitly says so. Using a tool is not building it.
- If information needed for a good answer is missing, insert a placeholder like [ADD: your notice period] instead of making something up.
- Write in the first person as the candidate. Plain, confident, specific. No clichés ("passionate", "team player"), no flattery padding.`;

function ensureProfile() {
  if (!existsSync(P.profile)) {
    mkdirSync(dirname(P.profile), { recursive: true });
    copyFileSync(P.profileExample, P.profile);
  }
}
function ensurePortals() {
  if (!existsSync(P.portals)) copyFileSync(P.portalsExample, P.portals);
}
function ensureTracker() {
  if (!existsSync(P.tracker)) {
    mkdirSync(dirname(P.tracker), { recursive: true });
    writeFileSync(
      P.tracker,
      "# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n"
    );
  }
}

function runNode(args, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env } });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, out, err });
    });
  });
}

// ---------------------------------------------------------------------------
// Parsers for career-ops data files
// ---------------------------------------------------------------------------
function parsePipeline() {
  // scan.mjs writes: `- [ ] {url} | {company} | {title} | {location}`
  const raw = read(P.pipeline) || "";
  const items = [];
  for (const line of raw.split("\n")) {
    if (/^- \[x\]/i.test(line)) continue; // processed
    const url = line.match(/https?:\/\/\S+/)?.[0];
    if (!url) continue;
    const rest = line.slice(line.indexOf(url) + url.length).split("|").map((s) => s.trim()).filter(Boolean);
    const [company = "", title = "", location = ""] = rest;
    items.push({ url, company, title: title || url, location });
  }
  return items;
}

function parseTracker() {
  const raw = read(P.tracker) || "";
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*#|^\|\s*-/.test(line)) continue;
    const c = line.split("|").map((x) => x.trim());
    if (c.length < 9) continue;
    rows.push({ num: c[1], date: c[2], company: c[3], role: c[4], score: c[5], status: c[6], pdf: c[7], report: c[8], notes: c[9] || "" });
  }
  return rows;
}

// Vision chat — sends an image (base64, no data: prefix) to the configured model.
async function visionChat(s, prompt, b64, mime) {
  const base = s.baseUrl.replace(/\/$/, "");
  if (s.provider === "ollama") {
    const r = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: s.model, stream: false, messages: [{ role: "user", content: prompt, images: [b64] }] }),
    });
    if (!r.ok) throw new Error(`Ollama vision failed (${r.status}) — is ${s.model} a vision model? Try llama3.2-vision.`);
    return (await r.json()).message?.content || "";
  }
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: providerHeaders(s),
    body: JSON.stringify({
      model: s.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }],
    }),
  });
  if (!r.ok) throw new Error(`Provider vision failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).choices?.[0]?.message?.content || "";
}

// Crude LaTeX → plain text (the LLM structures it afterwards).
function detex(src) {
  return src
    .replace(/%.*$/gm, "")
    .replace(/\\(?:textbf|textit|emph|texttt|underline|mbox|textsc)\{([^{}]*)\}/g, "$1")
    .replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, "$2 ($1)")
    .replace(/\\(?:section|subsection|subsubsection)\*?\{([^{}]*)\}/g, "\n\n## $1\n")
    .replace(/\\begin\{[^}]*\}(\[[^\]]*\])?/g, "\n")
    .replace(/\\end\{[^}]*\}/g, "\n")
    .replace(/\\item/g, "\n- ")
    .replace(/\\\\/g, "\n")
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const TRANSCRIBE_RULES = `You are transcribing a resume into clean markdown. RULES:
- FAITHFUL TRANSCRIPTION ONLY: keep every fact, date, employer, metric and skill exactly as written. Do not add, embellish, summarise away, or "improve" anything.
- Structure with standard sections where present: # Name, contact line, ## Summary, ## Experience (role — company — dates, bullets), ## Projects, ## Education, ## Skills.
- If part of the source is unreadable, write [UNREADABLE] rather than guessing.
- Output ONLY the markdown resume, no commentary.`;

// Tracker integration — respects the career-ops pipeline contract:
// new entries go through batch/tracker-additions + merge-tracker.mjs,
// status updates of existing entries edit applications.md in place.
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
}

async function trackApplication({ company, role, status, score, reportPath, note }) {
  ensureTracker();
  const rows = parseTracker();
  const existing = rows.find((r) => r.company.toLowerCase() === String(company).toLowerCase() && r.role.toLowerCase() === String(role).toLowerCase());
  if (existing) {
    // update status in place (allowed for existing entries)
    const raw = readFileSync(P.tracker, "utf8").split("\n");
    const idx = raw.findIndex((l) => l.startsWith("|") && l.split("|")[1]?.trim() === existing.num && l.includes(existing.company));
    if (idx >= 0) {
      const cells = raw[idx].split("|");
      cells[6] = ` ${status} `;
      if (note) cells[9] = ` ${note.replace(/\|/g, "/")} `;
      raw[idx] = cells.join("|");
      writeFileSync(P.tracker, raw.join("\n"));
    }
    return { updated: true, num: existing.num };
  }
  const num = rows.reduce((m, r) => Math.max(m, parseInt(r.num) || 0), 0) + 1;
  const date = new Date().toISOString().slice(0, 10);
  const scoreCell = score ? (String(score).includes("/") ? score : `${score}/5`) : "-";
  const reportCell = reportPath ? `[${num}](${reportPath})` : "-";
  const dir = join(ROOT, "batch", "tracker-additions");
  mkdirSync(dir, { recursive: true });
  const line = [num, date, company, role, status, scoreCell, "❌", reportCell, (note || "").replace(/[\t|]/g, " ")].join("\t");
  writeFileSync(join(dir, `${num}-${slugify(company)}.tsv`), line + "\n");
  const r = await runNode([join(ROOT, "merge-tracker.mjs")], { timeoutMs: 60_000 });
  return { created: true, num, mergeLog: (r.out + r.err).trim().split("\n").slice(-3).join("\n") };
}

// ---------------------------------------------------------------------------
// Request plumbing
// ---------------------------------------------------------------------------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function send(res, code, body, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(data);
}
const ok = (res, body) => send(res, 200, body);
const fail = (res, msg, code = 400) => send(res, code, { error: String(msg) });

function body(req) {
  return new Promise((resolvePromise, reject) => {
    let data = "";
    req.on("data", (d) => { data += d; if (data.length > 10 * 1024 * 1024) reject(new Error("payload too large")); });
    req.on("end", () => { try { resolvePromise(data ? JSON.parse(data) : {}); } catch { reject(new Error("bad json")); } });
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const routes = {
  "GET /api/status": async (req, res) => {
    const s = loadSettings();
    const reports = existsSync(P.reports) ? readdirSync(P.reports).filter((f) => f.endsWith(".md")).length : 0;
    ok(res, {
      root: ROOT,
      cv: existsSync(P.cv),
      profile: existsSync(P.profile),
      portals: existsSync(P.portals),
      yaml: !!yaml,
      reports,
      pipeline: parsePipeline().length,
      settings: { provider: s.provider, baseUrl: s.baseUrl, model: s.model, hasKey: !!s.apiKey },
    });
  },

  "GET /api/settings": async (req, res) => {
    const s = loadSettings();
    ok(res, { ...s, apiKey: s.apiKey ? "••••••" : "" });
  },

  "POST /api/settings": async (req, res) => {
    const b = await body(req);
    const cur = loadSettings();
    const next = {
      provider: b.provider === "openai" ? "openai" : "ollama",
      baseUrl: String(b.baseUrl || cur.baseUrl).trim(),
      apiKey: b.apiKey === "••••••" ? cur.apiKey : String(b.apiKey ?? cur.apiKey).trim(),
      model: String(b.model ?? cur.model).trim(),
    };
    saveSettings(next);
    ok(res, { saved: true });
  },

  "GET /api/models": async (req, res) => {
    try {
      ok(res, { models: await listModels(loadSettings()) });
    } catch (e) { fail(res, e.message, 502); }
  },

  "POST /api/test-llm": async (req, res) => {
    try {
      const reply = await chat(loadSettings(), [{ role: "user", content: "Reply with exactly: ready" }], { maxTokens: 10 });
      ok(res, { ok: true, reply: reply.trim().slice(0, 100) });
    } catch (e) { fail(res, e.message, 502); }
  },

  "GET /api/roles": async (req, res) => {
    const catalog = JSON.parse(readFileSync(join(STUDIO, "data", "roles.json"), "utf8"));
    const profile = loadYaml(P.profile);
    catalog.selected = profile?.target_roles?.primary || [];
    ok(res, catalog);
  },

  "POST /api/roles": async (req, res) => {
    // Writes the user's chosen target roles into USER-layer files:
    // config/profile.yml target_roles.primary + portals.yml title_filter.positive
    if (!yaml) return fail(res, "js-yaml unavailable — run `npm install` in the career-ops root.", 500);
    const { roles: chosen } = await body(req);
    if (!Array.isArray(chosen) || !chosen.length) return fail(res, "roles[] required");

    ensureProfile();
    const profile = loadYaml(P.profile) || {};
    profile.target_roles = profile.target_roles || {};
    profile.target_roles.primary = chosen;
    writeFileSync(P.profile, yaml.dump(profile, { lineWidth: 120 }));

    ensurePortals();
    const portals = loadYaml(P.portals) || {};
    // Keywords: the role titles plus distinctive words from them (dedup, keep short).
    const words = new Set();
    for (const t of chosen) {
      words.add(t);
      for (const w of t.split(/\s+/)) if (w.length > 3 && !/^(and|the|of)$/i.test(w)) words.add(w);
    }
    portals.title_filter = portals.title_filter || {};
    portals.title_filter.positive = [...words];
    writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 120 }));
    ensureTracker();
    ok(res, { saved: true, keywords: [...words] });
  },

  "GET /api/resume": async (req, res) => ok(res, { content: read(P.cv) || "" }),

  // Multi-format resume conversion. The client extracts text from PDF (pdf.js)
  // and DOCX (mammoth) in the browser and sends kind:"text"; LaTeX and images
  // are handled here. Output is a PREVIEW — the user reviews before saving.
  "POST /api/convert-resume": async (req, res) => {
    const { kind, content, mime } = await body(req);
    const s = loadSettings();
    if (!s.model) return fail(res, "Connect a model first — the converter uses it to structure your resume.");
    try {
      let markdown;
      if (kind === "image") {
        markdown = await visionChat(s, TRANSCRIBE_RULES + "\n\nTranscribe this resume image.", content, mime || "image/png");
      } else {
        const text = kind === "latex" ? detex(content) : String(content || "");
        if (text.trim().length < 40) return fail(res, "Couldn't extract meaningful text from that file.");
        markdown = await chat(s, [
          { role: "system", content: TRANSCRIBE_RULES },
          { role: "user", content: `Source resume text:\n\n${text.slice(0, 24000)}` },
        ], { maxTokens: 4096 });
      }
      markdown = markdown.replace(/^```(?:markdown)?\n?/, "").replace(/\n?```\s*$/, "");
      ok(res, { markdown });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Onboarding interview — answers persist to USER-layer files:
  // config/profile.yml (interview block, read by every generation as context)
  // and portals.yml location_filter (drives location-specific scanning).
  "GET /api/interview": async (req, res) => {
    const profile = loadYaml(P.profile);
    ok(res, { answers: profile?.interview || {} });
  },

  "POST /api/interview": async (req, res) => {
    if (!yaml) return fail(res, "js-yaml unavailable — run `npm install` in the career-ops root.", 500);
    const { answers } = await body(req);
    if (!answers || typeof answers !== "object") return fail(res, "answers object required");
    ensureProfile();
    const profile = loadYaml(P.profile) || {};
    profile.interview = { ...(profile.interview || {}), ...answers };
    writeFileSync(P.profile, yaml.dump(profile, { lineWidth: 120 }));

    // Location-specific scanning: seed portals.yml location_filter.
    const locs = [answers.home_location, ...(answers.target_locations || [])].filter(Boolean);
    if (locs.length) {
      ensurePortals();
      const portals = loadYaml(P.portals) || {};
      portals.location_filter = portals.location_filter || {};
      portals.location_filter.always_allow = [...new Set([answers.home_location].filter(Boolean))];
      const allow = new Set(portals.location_filter.allow || []);
      for (const l of locs) allow.add(l);
      if (/remote|any/i.test(answers.remote_preference || "")) allow.add("Remote");
      portals.location_filter.allow = [...allow];
      writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 120 }));
    }
    ok(res, { saved: true });
  },

  // Tailoring advice for a specific JD — reorder/reframe only, never invent.
  "POST /api/tailor": async (req, res) => {
    const { jd, company, role } = await body(req);
    if (!jd || jd.trim().length < 80) return fail(res, "Paste the job description first.");
    try {
      const ctx = groundingContext();
      const advice = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are a resume-tailoring advisor.\n\n${ctx}\n\n${GROUNDING_RULES}\n\nProduce markdown with exactly these sections:\n## Keyword alignment — table: JD requirement | where the resume already covers it (quote the resume) | strength (strong/partial/missing)\n## Reorder & emphasise — 3-6 concrete edits: which existing bullets/sections to move up or rephrase FOR THIS JD, using only facts already in the resume ("Keywords get reformulated, never fabricated")\n## Honest gaps — requirements the resume genuinely doesn't cover. Do NOT suggest inventing them; suggest how to address honestly (transferable experience actually present, or leave silent).`,
        },
        { role: "user", content: `Company: ${company || "?"} — Role: ${role || "?"}\n\nJob description:\n${jd.slice(0, 8000)}` },
      ], { maxTokens: 3000 });
      ok(res, { advice });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Mark a job Evaluated/Applied/SKIP etc. through the official pipeline.
  "POST /api/track": async (req, res) => {
    const { company, role, status, score, reportPath, note } = await body(req);
    if (!company || !role || !status) return fail(res, "company, role, status required");
    const CANONICAL = ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "SKIP"];
    if (!CANONICAL.includes(status)) return fail(res, `status must be one of: ${CANONICAL.join(", ")}`);
    try {
      ok(res, await trackApplication({ company, role, status, score, reportPath, note }));
    } catch (e) { fail(res, e.message, 500); }
  },

  "POST /api/resume": async (req, res) => {
    const { content } = await body(req);
    if (!content || content.trim().length < 40) return fail(res, "Resume looks empty — paste the full text.");
    writeFileSync(P.cv, content);
    ok(res, { saved: true });
  },

  "POST /api/profile": async (req, res) => {
    if (!yaml) return fail(res, "js-yaml unavailable — run `npm install` in the career-ops root.", 500);
    const b = await body(req);
    ensureProfile();
    const profile = loadYaml(P.profile) || {};
    profile.candidate = profile.candidate || {};
    for (const k of ["full_name", "email", "phone", "location", "linkedin", "github", "portfolio_url"]) {
      if (b[k] !== undefined) profile.candidate[k] = String(b[k]);
    }
    writeFileSync(P.profile, yaml.dump(profile, { lineWidth: 120 }));
    ok(res, { saved: true });
  },

  "GET /api/profile": async (req, res) => {
    const profile = loadYaml(P.profile);
    ok(res, { candidate: profile?.candidate || {}, roles: profile?.target_roles?.primary || [] });
  },

  "POST /api/scan": async (req, res) => {
    ensurePortals();
    ensureTracker();
    const r = await runNode([join(ROOT, "scan.mjs")], { timeoutMs: 10 * 60 * 1000 });
    ok(res, { code: r.code, output: (r.out + "\n" + r.err).trim().split("\n").slice(-40).join("\n"), pipeline: parsePipeline() });
  },

  "GET /api/pipeline": async (req, res) => ok(res, { items: parsePipeline() }),
  "GET /api/tracker": async (req, res) => ok(res, { rows: parseTracker() }),

  "POST /api/evaluate": async (req, res) => {
    // Delegates to the repo's own evaluators — same reports, same A–G format.
    const { jd } = await body(req);
    if (!jd || jd.trim().length < 100) return fail(res, "Paste the full job description text (at least a few paragraphs).");
    if (!existsSync(P.cv)) return fail(res, "No resume on file — add it in the Resume tab first.");
    const s = loadSettings();
    if (!s.model) return fail(res, "No model selected — pick one in Settings.");

    mkdirSync(P.jds, { recursive: true });
    const jdFile = join(P.jds, `studio-${Date.now()}.txt`);
    writeFileSync(jdFile, jd);

    const args = s.provider === "ollama"
      ? [join(ROOT, "ollama-eval.mjs"), "--model", s.model, "--url", s.baseUrl, "--file", jdFile]
      : [join(ROOT, "openai-eval.mjs"), "--url", s.baseUrl, "--model", s.model, ...(s.apiKey ? ["--key", s.apiKey] : []), "--file", jdFile];

    const r = await runNode(args);
    const reportRel = (r.out.match(/reports\/[\w.\-]+\.md/) || [])[0] || null;
    const report = reportRel ? read(join(ROOT, reportRel)) : null;
    if (r.code !== 0 && !report) return fail(res, `Evaluator failed: ${(r.err || r.out).slice(-500)}`, 502);
    ok(res, { reportPath: reportRel, report, log: r.out.split("\n").slice(-15).join("\n") });
  },

  "GET /api/reports": async (req, res) => {
    if (!existsSync(P.reports)) return ok(res, { reports: [] });
    const reports = readdirSync(P.reports)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ file: f, mtime: statSync(join(P.reports, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    ok(res, { reports: reports.map((r) => r.file) });
  },

  "GET /api/report": async (req, res, url) => {
    const f = basename(url.searchParams.get("f") || "");
    if (!f.endsWith(".md")) return fail(res, "bad file");
    const content = read(join(P.reports, f));
    if (content === null) return fail(res, "not found", 404);
    ok(res, { file: f, content });
  },

  "POST /api/cover-letter": async (req, res) => {
    const { jd, company, role } = await body(req);
    if (!company && !jd) return fail(res, "Provide at least a company name or a job description.");
    try {
      const ctx = groundingContext();
      const letter = await chat(loadSettings(), [
        {
          role: "system",
          content: `You write cover letters for a job candidate.\n\n${ctx}\n\n${GROUNDING_RULES}\n\nFormat: 3–4 short paragraphs, 220–320 words, no address block, no date. Start with "Dear Hiring Team," (or the hiring manager if named in the JD). End with "Sincerely," and the candidate's name from the resume. Output ONLY the letter, in markdown.`,
        },
        {
          role: "user",
          content: `Write a cover letter for this application.\nCompany: ${company || "[from JD]"}\nRole: ${role || "[from JD]"}\n\nJob description:\n${jd || "(not provided — write from the role title alone, staying generic about the company)"}\n\nREMINDER: use ONLY facts present in the resume above. Do not invent years of experience, skills, employers, or metrics. Where a needed fact is missing, write [ADD: …].`,
        },
      ]);
      ok(res, { letter });
    } catch (e) { fail(res, e.message, 502); }
  },

  "POST /api/answers": async (req, res) => {
    const { questions, jd, company, role } = await body(req);
    if (!Array.isArray(questions) || !questions.length) return fail(res, "questions[] required");
    try {
      const ctx = groundingContext();
      const raw = await chat(loadSettings(), [
        {
          role: "system",
          content: `You draft job-application form answers for a candidate.\n\n${ctx}\n\n${GROUNDING_RULES}\n\nAnswers: 60–140 words each unless the question implies a one-liner (start date, authorization, salary — those get 1–2 sentences with [ADD: …] placeholders where the resume is silent).\n\nOutput STRICT JSON only — an array of objects: [{"q": "<question>", "a": "<answer>"}]. No markdown fences, no commentary.`,
        },
        {
          role: "user",
          content: `Company: ${company || "unknown"}\nRole: ${role || "unknown"}\n${jd ? `\nJob description:\n${jd.slice(0, 6000)}\n` : ""}\nDraft answers for these application questions:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nREMINDER: use ONLY facts present in the resume above — never invent experience, numbers, or employers. Where a needed fact is missing, write [ADD: …]. Output strict JSON only.`,
        },
      ], { maxTokens: 4096 });
      // Tolerate models that wrap JSON in fences or prose.
      const match = raw.match(/\[[\s\S]*\]/);
      let answers;
      try { answers = JSON.parse(match ? match[0] : raw); } catch { answers = null; }
      if (!answers) return ok(res, { answers: questions.map((q) => ({ q, a: "" })), rawText: raw });
      ok(res, { answers });
    } catch (e) { fail(res, e.message, 502); }
  },
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const key = `${req.method} ${url.pathname}`;
  try {
    if (routes[key]) return await routes[key](req, res, url);
    if (url.pathname.startsWith("/api/")) return fail(res, "not found", 404);

    // static files
    const file = url.pathname === "/" ? "/index.html" : url.pathname;
    const safe = resolve(join(PUBLIC, file));
    if (!safe.startsWith(PUBLIC)) return fail(res, "forbidden", 403);
    if (!existsSync(safe) || !statSync(safe).isFile()) return send(res, 404, "not found", "text/plain");
    send(res, 200, readFileSync(safe), MIME[extname(safe)] || "application/octet-stream");
  } catch (e) {
    fail(res, e.message || "server error", 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Career-Ops Studio\n  → http://localhost:${PORT}\n  career-ops root: ${ROOT}\n`);
});

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
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, appendFileSync } from "fs";
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

// ---------------------------------------------------------------------------
// Per-job artifact store + telemetry (both local, gitignored).
// jobs.json maps a job key → { evaluate, market, tailored, cover, ... } so the
// apply flow is resumable and each posting keeps its own mapped context.
// ---------------------------------------------------------------------------
const JOBS_PATH = join(LOCAL, "jobs.json");
const TELEMETRY_PATH = join(LOCAL, "telemetry.jsonl");
const jobKey = (o) => (o.url || `${(o.company || "").toLowerCase()}|${(o.role || "").toLowerCase()}`).slice(0, 200);

function loadJobs() {
  try { return JSON.parse(readFileSync(JOBS_PATH, "utf8")); } catch { return {}; }
}
function saveJobArtifact(key, patch) {
  mkdirSync(LOCAL, { recursive: true });
  const all = loadJobs();
  all[key] = { ...(all[key] || {}), ...patch, updated: Date.now() };
  writeFileSync(JOBS_PATH, JSON.stringify(all));
  return all[key];
}
function logEvent(event, data = {}) {
  try {
    mkdirSync(LOCAL, { recursive: true });
    appendFileSync(TELEMETRY_PATH, JSON.stringify({ t: Date.now(), event, ...data }) + "\n");
  } catch { /* telemetry is best-effort */ }
}

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

// The example profile ships with Jane Smith placeholders — they must never
// leak into generated documents. Any candidate field still holding one of
// these is treated as unset.
const EXAMPLE_VALUES = new Set([
  "Jane Smith", "jane@example.com", "+1-555-0123", "San Francisco, CA",
  "linkedin.com/in/janesmith", "https://janesmith.dev", "github.com/janesmith", "https://x.com/janesmith",
]);
const isExample = (v) => !v || EXAMPLE_VALUES.has(String(v).trim());

function scrubCandidate(candidate = {}) {
  const out = {};
  for (const [k, v] of Object.entries(candidate)) out[k] = isExample(v) ? "" : v;
  return out;
}

// Pull contact details straight out of the resume header so the profile is
// always the user's own data, even if they never touch the contact form.
function syncContactFromCv(cv) {
  if (!yaml) return;
  ensureProfile();
  const profile = loadYaml(P.profile) || {};
  profile.candidate = scrubCandidate(profile.candidate);
  const head = cv.slice(0, 800);
  const found = {
    full_name: (head.match(/^#\s+(.+?)\s*$/m) || [])[1]?.replace(/[*_]/g, "").trim(),
    email: (head.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0],
    phone: (head.match(/(?:\+?\d[\d\s().-]{8,}\d)/) || [])[0]?.trim(),
    linkedin: (head.match(/(?:www\.)?linkedin\.com\/in\/[\w-]+/i) || [])[0],
    github: (head.match(/(?:www\.)?github\.com\/[\w-]+/i) || [])[0],
  };
  for (const [k, v] of Object.entries(found)) {
    if (v && !profile.candidate[k]) profile.candidate[k] = v;
  }
  writeFileSync(P.profile, yaml.dump(profile, { lineWidth: 120 }));
}

// Build a precise title_filter from chosen role titles. The scanner passes a
// job if ANY positive keyword matches, so positives must be PHRASES (or
// distinctive multi-word/compound terms) — never bare words like "Engineer"
// that match everything. That over-broad matching was the false-positive source.
const GENERIC_WORDS = new Set(["engineer", "developer", "manager", "analyst", "scientist", "specialist", "consultant", "designer", "architect", "lead", "senior", "junior", "staff", "principal", "associate", "director", "head", "of", "and", "the", "a", "an"]);
// Distinctive single tokens worth matching on their own (domain signals).
const STRONG_TOKENS = new Set(["ml", "ai", "llm", "nlp", "genai", "mlops", "llmops", "devops", "sre", "data", "backend", "frontend", "fullstack", "full-stack", "security", "cloud", "kubernetes", "platform", "infrastructure", "cybersecurity", "blockchain", "robotics", "embedded", "qa", "sdet", "ux", "ui", "product", "growth", "sales", "marketing", "finance", "recruiter", "designer"]);

function buildTitleFilter(chosen) {
  const positive = new Set();
  for (const raw of chosen) {
    const t = raw.trim();
    if (!t) continue;
    positive.add(t); // the full title is always a good phrase
    const words = t.split(/\s+/);
    // meaningful bigrams (drop ones that are two generic words)
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i].toLowerCase(), b = words[i + 1].toLowerCase();
      if (GENERIC_WORDS.has(a) && GENERIC_WORDS.has(b)) continue;
      positive.add(`${words[i]} ${words[i + 1]}`);
    }
    // distinctive single tokens only
    for (const w of words) {
      const lw = w.toLowerCase().replace(/[^a-z0-9-]/g, "");
      if (STRONG_TOKENS.has(lw)) positive.add(w);
    }
  }
  return {
    positive: [...positive],
    negative: ["Intern", "Internship", "Apprentice", "Working Student", "Trainee", "Co-op", "Graduate Program", "Contract", "Volunteer"],
    seniority_boost: ["Senior", "Staff", "Principal", "Lead", "Head", "Director"],
  };
}

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
// JD auto-fetch — ATS public APIs first (same rung check-liveness uses),
// generic page fetch as fallback. The user never pastes a JD by hand.
// ---------------------------------------------------------------------------
function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

// Postings are third-party content rendered in our UI — strip anything active.
function sanitizeHtml(html) {
  return String(html || "")
    .replace(/<(script|style|iframe|object|embed|form|link|meta)\b[\s\S]*?(<\/\1>|\/?>)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "");
}

function htmlToText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Keyless web search via DuckDuckGo's HTML endpoint. Best-effort, cached.
const searchCache = new Map();
async function webSearch(query) {
  const key = query.toLowerCase();
  if (searchCache.has(key)) return searchCache.get(key);
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 (career-ops-studio)" },
  });
  if (!r.ok) throw new Error(`search ${r.status}`);
  const html = await r.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && results.length < 8) {
    let href = decodeEntities(m[1]);
    const uddg = href.match(/uddg=([^&]+)/);       // DDG wraps external links
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (!/^https?:\/\//.test(href)) continue;
    results.push({ url: href, title: htmlToText(m[2]).slice(0, 160), snippet: htmlToText(m[3] || "").slice(0, 300) });
  }
  if (searchCache.size > 200) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(key, results);
  return results;
}

const jdCache = new Map(); // url → {title, company, location, html, text, source}

async function greenhouseApi(board, id) {
  for (const api of [
    `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`,
    `https://boards-api.eu.greenhouse.io/v1/boards/${board}/jobs/${id}`,
  ]) {
    const r = await fetch(api).catch(() => null);
    if (!r?.ok) continue;
    const j = await r.json();
    const html = sanitizeHtml(decodeEntities(j.content));
    return { title: j.title, company: board.replace(/-/g, " "), location: j.location?.name || "", html, text: htmlToText(html), source: "greenhouse-api" };
  }
  return null;
}

async function fetchJdFromUrl(url) {
  if (jdCache.has(url)) return jdCache.get(url);
  const u = new URL(url);
  const qp = u.searchParams;
  let out = null;

  try {
    if (/(^|\.)greenhouse\.io$/.test(u.hostname)) {
      const m = u.pathname.match(/\/([^/]+)\/jobs\/(\d+)/);
      if (m) out = await greenhouseApi(m[1], m[2]);
    } else if (qp.get("gh_jid")) {
      // Embedded Greenhouse on a custom careers domain (CoreWeave, many others):
      // the board slug rides in ?board= or ?for=, else guess from the hostname.
      const id = qp.get("gh_jid");
      const board = qp.get("board") || qp.get("for") || u.hostname.split(".").slice(-2, -1)[0];
      out = await greenhouseApi(board, id);
    } else if (qp.get("ashby_jid")) {
      const org = qp.get("ashby_org") || u.hostname.split(".").slice(-2, -1)[0];
      const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`).catch(() => null);
      if (r?.ok) {
        const j = await r.json();
        const job = (j.jobs || []).find((x) => url.includes(x.id));
        if (job) { const html = sanitizeHtml(job.descriptionHtml || ""); out = { title: job.title, company: org, location: job.location || "", html, text: job.descriptionPlain || htmlToText(html), source: "ashby-api" }; }
      }
    } else if (u.hostname === "jobs.lever.co") {
      const [, slug, id] = u.pathname.split("/");
      if (slug && id) {
        const r = await fetch(`https://api.lever.co/v0/postings/${slug}/${id}`).catch(() => null);
        if (r?.ok) {
          const j = await r.json();
          const lists = (j.lists || []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join("");
          const html = sanitizeHtml(`${j.description || ""}${lists}${j.additional || ""}`);
          out = { title: j.text, company: slug, location: j.categories?.location || "", html, text: htmlToText(html), source: "lever-api" };
        }
      }
    } else if (u.hostname === "jobs.ashbyhq.com") {
      const [, org, jobId] = u.pathname.split("/");
      if (org && jobId) {
        const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${org}?includeCompensation=true`).catch(() => null);
        if (r?.ok) {
          const j = await r.json();
          const job = (j.jobs || []).find((x) => x.id === jobId || url.includes(x.id));
          if (job) {
            const html = sanitizeHtml(job.descriptionHtml || "");
            out = { title: job.title, company: org, location: job.location || "", html, text: job.descriptionPlain || htmlToText(html), source: "ashby-api" };
          }
        }
      }
    }

    // Generic fallback: fetch the page and pull readable text. Prefers a JSON-LD
    // JobPosting block (many career sites embed one even when JS-rendered),
    // then <main>, then body. JS-only pages come back thin → UI offers paste.
    if (!out) {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (career-ops-studio)", "accept-language": "en" }, redirect: "follow" }).catch(() => null);
      if (r?.ok) {
        const page = await r.text();
        const title = htmlToText((page.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s*[|\-–].*$/, "").trim();
        // JSON-LD JobPosting
        for (const m of page.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
          try {
            const data = JSON.parse(m[1].trim());
            const nodes = Array.isArray(data) ? data : (data["@graph"] || [data]);
            const jp = nodes.find((n) => /JobPosting/i.test(n?.["@type"] || ""));
            if (jp?.description) {
              const html = sanitizeHtml(jp.description);
              out = { title: jp.title || title, company: jp.hiringOrganization?.name || "", location: jp.jobLocation?.address?.addressLocality || "", html, text: htmlToText(html), source: "page-jsonld" };
              break;
            }
          } catch { /* not this block */ }
        }
        if (!out) {
          const stripped = page.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, " ");
          const bodyMatch = stripped.match(/<main\b[\s\S]*?<\/main>/i) || stripped.match(/<(?:article|section)\b[\s\S]*?<\/(?:article|section)>/i) || stripped.match(/<body\b[\s\S]*?<\/body>/i);
          const text = htmlToText(bodyMatch ? bodyMatch[0] : stripped).slice(0, 20000);
          if (text.length > 200) out = { title, company: "", location: "", html: "", text, source: "page-text" };
        }
      }
    }
  } catch { /* fall through */ }

  if (out) {
    if (jdCache.size > 300) jdCache.delete(jdCache.keys().next().value);
    jdCache.set(url, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tailored CV → PDF (uses the repo's own template + Playwright pipeline)
// ---------------------------------------------------------------------------
const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Tolerant action-envelope parser: small models mangle the closing (`}}`,
// missing `>>`, extra whitespace). Find `<<act:NAME`, then brace-match the JSON
// args if present, and strip the whole envelope (however it was closed) out of
// the visible reply.
const AGENT_ACTIONS = ["navigate", "regenerateResume", "tailorResume", "evaluate", "generatePdf", "draftCover", "markApplied", "addCompany", "scanNow", "backgroundEval"];
function extractAction(reply) {
  // Tolerate: `<<act:NAME …>>`, `<<NAME …>>` (dropped prefix), stray braces,
  // missing `>>`. Gate on a known action name so a stray `<<` isn't an action.
  const m = reply.match(new RegExp(`<<\\s*(?:act:)?\\s*(${AGENT_ACTIONS.join("|")})\\b`, "i"));
  if (!m) return { action: null, clean: reply.trim() };
  const name = AGENT_ACTIONS.find((a) => a.toLowerCase() === m[1].toLowerCase());
  let i = m.index + m[0].length;
  // find start of JSON
  const braceStart = reply.indexOf("{", i);
  let args = {}, end = i;
  if (braceStart !== -1 && braceStart < (reply.indexOf("\n", i) === -1 ? reply.length : reply.indexOf("\n", i) + 200)) {
    let depth = 0, j = braceStart, inStr = false, esc = false;
    for (; j < reply.length; j++) {
      const c = reply[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
      else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { j++; break; } }
    }
    const jsonStr = reply.slice(braceStart, j);
    try { args = JSON.parse(jsonStr); } catch { args = {}; }
    end = j;
  }
  // consume trailing junk up to and including >> or end of line
  let tail = reply.slice(end).match(/^[^\n]*?(>>|$)/);
  const envEnd = end + (tail ? tail[0].length : 0);
  const clean = (reply.slice(0, m.index) + reply.slice(envEnd)).replace(/\n{3,}/g, "\n\n").trim();
  return { action: { name, args }, clean };
}

const TAILOR_JSON_PROMPT = `Produce the candidate's resume TAILORED to the job description, as STRICT JSON (no fences, no commentary):
{
  "summary": "3-4 sentence professional summary weaving in the JD's top keywords where the resume genuinely supports them",
  "competencies": ["8-12 short competency tags, JD-relevant ones first"],
  "experience": [{"company": "", "role": "", "period": "", "location": "", "bullets": ["3-5 bullets; most JD-relevant first; keep the resume's real metrics"]}],
  "projects": [{"title": "", "desc": "", "tech": ""}],
  "education": [{"title": "degree", "org": "school", "year": ""}],
  "certifications": [{"title": "", "org": "", "year": ""}],
  "skills": [{"category": "", "items": "comma-separated"}]
}
Tailoring means REORDER and REPHRASE what the resume already contains so JD keywords surface — never add skills, employers, dates, metrics or claims that are not in the resume. Keep every company/role/date exactly as the resume states them. Omit sections the resume has no content for (empty arrays).`;

// generate-pdf.mjs enforces that rendered section order matches cv.md's own
// heading order — so we assemble sections in the user's order, not the
// template's default order.
function cvSectionOrder() {
  const cv = read(P.cv) || "";
  const KEYMAP = [
    [/summary|profile|about/i, "summary"], [/experience|employment|work history/i, "experience"],
    [/project/i, "projects"], [/education|academic/i, "education"],
    [/certification|certificate|license/i, "certifications"], [/skill|technolog|competenc/i, "skills"],
  ];
  const order = [];
  for (const line of cv.split("\n")) {
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+)/);
    if (!h) continue;
    for (const [re, key] of KEYMAP) {
      if (re.test(h[1]) && !order.includes(key)) { order.push(key); break; }
    }
  }
  return order.length ? order : ["summary", "experience", "projects", "education", "certifications", "skills"];
}

function fillCvTemplate(data, candidate) {
  let html = readFileSync(join(ROOT, "templates", "cv-template.html"), "utf8");
  const c = candidate || {};
  const li = (c.linkedin || "").replace(/^https?:\/\//, "");
  const port = c.portfolio_url || (c.github ? `https://${String(c.github).replace(/^https?:\/\//, "")}` : "");
  const rep = {
    LANG: "en", PAGE_WIDTH: "7.3in", PHOTO: "",
    NAME: escHtml(c.full_name || ""), EMAIL: escHtml(c.email || ""), PHONE: escHtml(c.phone || ""),
    LOCATION: escHtml(c.location || ""),
    LINKEDIN_URL: li ? `https://${escHtml(li)}` : "", LINKEDIN_DISPLAY: escHtml(li),
    PORTFOLIO_URL: escHtml(port), PORTFOLIO_DISPLAY: escHtml(port.replace(/^https?:\/\//, "")),
  };
  for (const [k, v] of Object.entries(rep)) html = html.split(`{{${k}}}`).join(v);

  // Rebuild the contact row from only the fields that exist — the template's
  // fixed separators leave "| |" gaps when portfolio/location are empty.
  const contactBits = [
    c.phone && `<a href="tel:${escHtml(c.phone)}">${escHtml(c.phone)}</a>`,
    c.email && `<a href="mailto:${escHtml(c.email)}">${escHtml(c.email)}</a>`,
    li && `<a href="https://${escHtml(li)}">${escHtml(li)}</a>`,
    port && `<a href="${escHtml(port)}">${escHtml(port.replace(/^https?:\/\//, ""))}</a>`,
    c.location && `<span>${escHtml(c.location)}</span>`,
  ].filter(Boolean);
  html = html.replace(/<div class="contact-row">[\s\S]*?<\/div>/,
    `<div class="contact-row">${contactBits.join('<span class="separator">|</span>')}</div>`);

  // Build each section's inner HTML, then emit them in the ORDER cv.md uses.
  const bodies = {
    summary: data.summary ? `<div class="summary-text">${escHtml(data.summary)}</div>` : "",
    competencies: (data.competencies || []).length
      ? `<div class="competencies-grid">${data.competencies.map((t) => `<span class="competency-tag">${escHtml(t)}</span>`).join("\n")}</div>` : "",
    experience: (data.experience || []).map((j) => `
      <div class="job">
        <div class="job-header"><span class="job-company">${escHtml(j.company)}</span><span class="job-period">${escHtml(j.period)}</span></div>
        <div class="job-role">${escHtml(j.role)}${j.location ? ` <span class="job-location">· ${escHtml(j.location)}</span>` : ""}</div>
        <ul>${(j.bullets || []).map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>
      </div>`).join("\n"),
    projects: (data.projects || []).map((p) => `
      <div class="project"><div class="project-title">${escHtml(p.title)}</div>
      <div class="project-desc">${escHtml(p.desc)}</div>${p.tech ? `<div class="project-tech">${escHtml(p.tech)}</div>` : ""}</div>`).join("\n"),
    education: (data.education || []).map((e) => `
      <div class="edu-item"><div class="edu-header"><span class="edu-title">${escHtml(e.title)}</span><span class="edu-year">${escHtml(e.year || "")}</span></div>
      <div class="edu-org">${escHtml(e.org || "")}</div>${e.desc ? `<div class="edu-desc">${escHtml(e.desc)}</div>` : ""}</div>`).join("\n"),
    certifications: (data.certifications || []).length
      ? `<div class="cert-table">${data.certifications.map((x) => `
        <div class="cert-row"><span class="cert-title">${escHtml(x.title)}</span><span class="cert-org">${escHtml(x.org || "")}</span><span class="cert-year">${escHtml(x.year || "")}</span></div>`).join("")}</div>` : "",
    skills: (data.skills || []).length
      ? `<div class="skills-grid">${data.skills.map((s) => `<div class="skill-item"><span class="skill-category">${escHtml(s.category)}:</span> ${escHtml(s.items)}</div>`).join("")}</div>` : "",
  };
  const TITLES = {
    summary: "Professional Summary", competencies: "Core Competencies", experience: "Work Experience",
    projects: "Projects", education: "Education", certifications: "Certifications", skills: "Skills",
  };
  const order = cvSectionOrder();
  // competencies has no cv.md heading — slot it right after summary
  const withComp = order.includes("summary")
    ? order.flatMap((k) => (k === "summary" ? ["summary", "competencies"] : [k]))
    : ["competencies", ...order];
  const sectionsHtml = withComp
    .filter((k) => bodies[k])
    .map((k) => `\n  <div class="section">\n    <div class="section-title">${TITLES[k]}</div>\n    ${bodies[k]}\n  </div>`)
    .join("\n");

  // Swap the template's fixed section blocks for our ordered ones.
  const start = html.indexOf("<!-- PROFESSIONAL SUMMARY -->");
  const end = html.lastIndexOf("</div>\n</body>");
  if (start === -1 || end === -1) throw new Error("cv-template.html structure changed — can't place sections");
  html = html.slice(0, start) + sectionsHtml + "\n\n" + html.slice(end);
  return html;
}

// Recognise an ATS + board slug from a careers URL (for manual company add).
function detectAts(url) {
  try {
    const u = new URL(url);
    const h = u.hostname, seg = u.pathname.split("/").filter(Boolean);
    if (/greenhouse\.io$/.test(h)) return { provider: "greenhouse", slug: seg[0] };
    if (u.searchParams.get("gh_jid") || u.searchParams.get("for") || u.searchParams.get("board")) return { provider: "greenhouse", slug: u.searchParams.get("board") || u.searchParams.get("for") || h.split(".").slice(-2, -1)[0] };
    if (h === "jobs.lever.co") return { provider: "lever", slug: seg[0] };
    if (h === "jobs.ashbyhq.com") return { provider: "ashby", slug: seg[0] };
    return null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Daily scheduler — refresh the inventory (scan) every day at a set hour.
// In-process: works while the server runs. For always-on, install the launchd
// agent (see studio/mac/). Optionally chains a background evaluation.
// ---------------------------------------------------------------------------
const sched = { timer: null, lastRun: 0, lastResult: "" };
function scheduleConfig() {
  const s = loadSettings();
  return { enabled: !!s.scheduleEnabled, hour: Number.isFinite(s.scheduleHour) ? s.scheduleHour : 12, autoEval: !!s.scheduleAutoEval };
}
function nextRunAt(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}
function armScheduler() {
  if (sched.timer) { clearTimeout(sched.timer); sched.timer = null; }
  const cfg = scheduleConfig();
  if (!cfg.enabled) return;
  const at = nextRunAt(cfg.hour);
  sched.timer = setTimeout(async () => {
    try {
      const r = await runNode([join(ROOT, "scan.mjs")], { timeoutMs: 15 * 60 * 1000 });
      sched.lastRun = Date.now();
      sched.lastResult = (r.out + r.err).trim().split("\n").slice(-3).join(" | ");
      logEvent("scheduled_scan", { code: r.code });
      if (cfg.autoEval && !bg.running) runBackground({ threshold: 4, limit: 25 }).catch(() => {});
    } catch (e) { sched.lastResult = `error: ${e.message}`; }
    armScheduler(); // reschedule for tomorrow
  }, at - Date.now());
}
function schedulerState() {
  const cfg = scheduleConfig();
  return { ...cfg, nextRun: cfg.enabled ? nextRunAt(cfg.hour).toISOString() : null, lastRun: sched.lastRun || null, lastResult: sched.lastResult };
}

// ---------------------------------------------------------------------------
// Background evaluation worker (single instance, in-memory state)
// ---------------------------------------------------------------------------
const bg = { running: false, stop: false, done: 0, total: 0, prepared: 0, current: "", error: "", log: [] };
const bgState = () => ({ running: bg.running, stop: bg.stop, done: bg.done, total: bg.total, prepared: bg.prepared, current: bg.current, error: bg.error, log: bg.log.slice(-8) });

async function bgEvaluate(jd) {
  const s = loadSettings();
  mkdirSync(P.jds, { recursive: true });
  const jdFile = join(P.jds, `bg-${Date.now()}.txt`);
  writeFileSync(jdFile, jd);
  const args = s.provider === "ollama"
    ? [join(ROOT, "ollama-eval.mjs"), "--model", s.model, "--url", s.baseUrl, "--file", jdFile]
    : [join(ROOT, "openai-eval.mjs"), "--url", s.baseUrl, "--model", s.model, ...(s.apiKey ? ["--key", s.apiKey] : []), "--file", jdFile];
  const r = await runNode(args);
  const reportRel = (r.out.match(/reports\/[\w.\-]+\.md/) || [])[0] || null;
  const report = reportRel ? read(join(ROOT, reportRel)) : null;
  const score = report ? parseFloat((report.match(/(\d(?:\.\d)?)\s*\/\s*5/) || [])[1]) || null : null;
  return { report, reportRel, score };
}

async function runBackground({ threshold, limit }) {
  bg.running = true; bg.stop = false; bg.done = 0; bg.prepared = 0; bg.error = ""; bg.log = [];
  const s = loadSettings();
  if (!s.model) { bg.error = "No model selected"; bg.running = false; return; }
  const items = parsePipeline().slice(0, limit);
  bg.total = items.length;
  const store = loadJobs();
  for (const it of items) {
    if (bg.stop) break;
    const key = jobKey({ url: it.url });
    if (store[key]?.score != null) { bg.done++; continue; } // already evaluated
    bg.current = it.title || it.url;
    try {
      const jd = await fetchJdFromUrl(it.url).catch(() => null);
      if (!jd?.text || jd.text.length < 120) { bg.log.push(`skip (no JD): ${it.title}`); bg.done++; continue; }
      const company = (jd.company || it.company || "").replace(/\b\w/g, (c) => c.toUpperCase());
      const role = jd.title || it.title;
      const { report, reportRel, score } = await bgEvaluate(jd.text);
      const patch = { report, reportPath: reportRel, score, company, role };
      await trackApplication({ company, role, status: "Evaluated", score, reportPath: reportRel, note: "auto (background)" }).catch(() => {});
      bg.log.push(`${score ?? "?"}/5 — ${role} @ ${company}`);
      logEvent("bg_evaluate", { score });

      // High scorer → auto-prepare everything
      if (score != null && score >= threshold && !bg.stop) {
        bg.current = `preparing ${role} (${score}/5)`;
        const context = [report && `FIT:\n${report}`, ""].filter(Boolean).join("\n\n");
        try {
          const profile = loadYaml(P.profile) || {};
          const candidate = scrubCandidate(profile.candidate);
          if (candidate.full_name && candidate.email) {
            const rawTailor = await chat(s, [
              { role: "system", content: `You tailor resumes.\n\n${groundingContext()}\n\n${GROUNDING_RULES}\n\n${TAILOR_JSON_PROMPT}\n\n${context}` },
              { role: "user", content: `Company: ${company} — Role: ${role}\n\nJD:\n${jd.text.slice(0, 8000)}` },
            ], { maxTokens: 4096 });
            const data = JSON.parse((rawTailor.match(/\{[\s\S]*\}/) || ["{}"])[0]);
            const slug = slugify(`${candidate.full_name.split(" ")[0]}-${company}`);
            const date = new Date().toISOString().slice(0, 10);
            const htmlPath = join(ROOT, "output", `cv-${slug}-${date}.html`);
            const pdfPath = join(ROOT, "output", `cv-${slug}-${date}.pdf`);
            mkdirSync(join(ROOT, "output"), { recursive: true });
            writeFileSync(htmlPath, fillCvTemplate(data, candidate));
            await runNode([join(ROOT, "generate-pdf.mjs"), htmlPath, pdfPath, "--format=letter"], { timeoutMs: 120000 });
            if (existsSync(pdfPath)) patch.pdf = basename(pdfPath);
          }
          const letter = await chat(s, [
            { role: "system", content: `You write cover letters.\n\n${groundingContext()}\n\n${GROUNDING_RULES}\n\n3–4 short paragraphs, markdown only.` },
            { role: "user", content: `Cover letter for ${role} at ${company}.\n\nJD:\n${jd.text.slice(0, 4000)}` },
          ], { maxTokens: 1200 });
          patch.letter = letter;
          bg.prepared++;
          logEvent("bg_prepared", { score });
        } catch (e) { bg.log.push(`prep failed: ${e.message.slice(0, 60)}`); }
      }
      saveJobArtifact(key, patch);
    } catch (e) { bg.log.push(`error: ${e.message.slice(0, 60)}`); }
    bg.done++;
  }
  bg.current = "";
  bg.running = false;
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
    portals.title_filter = buildTitleFilter(chosen);
    writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 120 }));
    ensureTracker();
    ok(res, { saved: true, keywords: portals.title_filter.positive });
  },

  // Job boards + companies picker. Returns the catalog plus which are enabled
  // in the user's portals.yml right now.
  "GET /api/boards": async (req, res) => {
    const catalog = JSON.parse(readFileSync(join(STUDIO, "data", "boards.json"), "utf8"));
    const portals = loadYaml(P.portals) || {};
    const enabledBoards = new Set((portals.job_boards || []).filter((b) => b.enabled !== false).map((b) => (b.provider || b.name || "").toLowerCase()));
    const enabledCompanies = new Set((portals.tracked_companies || []).filter((c) => c.enabled !== false).map((c) => (c.name || "").toLowerCase()));
    catalog.enabledBoards = catalog.remoteBoards.filter((b) => enabledBoards.has(b.id)).map((b) => b.id);
    catalog.enabledCompanies = catalog.companies.filter((c) => enabledCompanies.has(c.name.toLowerCase())).map((c) => c.name);
    // any tracked companies in portals.yml not in our catalog (e.g. career-ops defaults)
    const known = new Set(catalog.companies.map((c) => c.name.toLowerCase()));
    catalog.otherEnabledCompanies = (portals.tracked_companies || [])
      .filter((c) => c.enabled !== false && !known.has((c.name || "").toLowerCase()))
      .map((c) => c.name);
    ok(res, catalog);
  },

  // Manually add a company by careers URL (we sniff the ATS + slug) or by
  // provider+slug. Appended to portals.yml tracked_companies with its API URL.
  "POST /api/add-company": async (req, res) => {
    if (!yaml) return fail(res, "js-yaml unavailable", 500);
    const b = await body(req);
    let { name, provider, slug, url } = b;
    if (url && (!provider || !slug)) {
      const d = detectAts(url);
      if (!d) return fail(res, "Couldn't recognise the ATS from that URL. Use a Greenhouse, Lever, or Ashby careers link — or enter provider + slug directly.");
      provider = d.provider; slug = d.slug;
    }
    if (!provider || !slug) return fail(res, "Need a careers URL, or provider + slug.");
    name = (name || slug).trim();
    const api = { greenhouse: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`, lever: `https://api.lever.co/v0/postings/${slug}`, ashby: `https://api.ashbyhq.com/posting-api/job-board/${slug}` }[provider];
    if (!api) return fail(res, "provider must be greenhouse, lever, or ashby");
    // Verify it resolves before saving (cheap, avoids dead entries).
    const probe = await fetch(api).catch(() => null);
    if (!probe?.ok) return fail(res, `That board didn't respond (${probe?.status || "no response"}). Check the slug.`, 502);
    ensurePortals();
    const portals = loadYaml(P.portals) || {};
    portals.tracked_companies = portals.tracked_companies || [];
    const exists = portals.tracked_companies.find((c) => (c.name || "").toLowerCase() === name.toLowerCase());
    if (exists) { exists.enabled = true; exists.api = api; exists.provider = provider; }
    else portals.tracked_companies.push({ name, careers_url: url || `https://jobs.${provider}.co/${slug}`, provider, api, enabled: true });
    writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 120 }));
    logEvent("add_company", { provider });
    ok(res, { saved: true, name, provider, slug });
  },

  "POST /api/boards": async (req, res) => {
    if (!yaml) return fail(res, "js-yaml unavailable", 500);
    const { boards = [], companies = [] } = await body(req);
    const catalog = JSON.parse(readFileSync(join(STUDIO, "data", "boards.json"), "utf8"));
    ensurePortals();
    const portals = loadYaml(P.portals) || {};

    // Remote aggregator boards → job_boards[] entries
    const boardSet = new Set(boards.map((b) => b.toLowerCase()));
    const existingBoards = (portals.job_boards || []).filter((b) => !catalog.remoteBoards.some((rb) => rb.id === (b.provider || b.name || "").toLowerCase()));
    portals.job_boards = [
      ...existingBoards,
      ...catalog.remoteBoards.filter((rb) => boardSet.has(rb.id)).map((rb) => ({ name: rb.name, provider: rb.id, enabled: true })),
    ];

    // Direct-company boards → tracked_companies[] with the right ATS api URL
    const apiFor = (c) => ({
      greenhouse: `https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs`,
      lever: `https://api.lever.co/v0/postings/${c.slug}`,
      ashby: `https://api.ashbyhq.com/posting-api/job-board/${c.slug}`,
    }[c.provider] || "");
    const compSet = new Set(companies.map((x) => x.toLowerCase()));
    const chosenCatalog = catalog.companies.filter((c) => compSet.has(c.name.toLowerCase()));
    // keep any tracked companies the user already had that aren't in our catalog
    const known = new Set(catalog.companies.map((c) => c.name.toLowerCase()));
    const kept = (portals.tracked_companies || []).filter((c) => !known.has((c.name || "").toLowerCase()));
    portals.tracked_companies = [
      ...kept,
      ...chosenCatalog.map((c) => ({ name: c.name, careers_url: `https://jobs.${c.provider === "greenhouse" ? "greenhouse.io" : c.provider + ".co"}/${c.slug}`, provider: c.provider, api: apiFor(c), enabled: true })),
    ];
    writeFileSync(P.portals, yaml.dump(portals, { lineWidth: 120 }));
    ok(res, { saved: true, boards: boards.length, companies: chosenCatalog.length });
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

  // Keyless web search (DuckDuckGo HTML endpoint) — returns title/url/snippet.
  "GET /api/websearch": async (req, res, url) => {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 3) return ok(res, { results: [] });
    try {
      ok(res, { results: await webSearch(q) });
    } catch (e) { fail(res, `Search unavailable (${e.message})`, 502); }
  },

  // Current skills/trends for a role — searches the web, reads the top
  // results, and has the model distill what's in demand RIGHT NOW. This is
  // market intel (not about the user), so web content is fair game here.
  "POST /api/market-trends": async (req, res) => {
    const { role, jd } = await body(req);
    if (!role) return fail(res, "role required");
    try {
      const year = new Date().getFullYear();
      const results = await webSearch(`${role} required skills and hiring trends ${year}`);
      let corpus = "";
      for (const r of results.slice(0, 3)) {
        const page = await fetchJdFromUrl(r.url).catch(() => null);
        corpus += `\n### ${r.title} (${r.url})\n${(page?.text || r.snippet || "").slice(0, 2500)}\n`;
      }
      const cvSkills = (read(P.cv) || "").slice(0, 1500);
      const summary = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are a job-market analyst. Using the web excerpts provided, summarize what employers want for this role RIGHT NOW. Markdown, these sections:\n## In-demand skills — bullet list, most-cited first; mark each (hard) or (soft).\n## Rising / emerging — tools or topics gaining traction this year.\n## Table stakes — expected baseline.\n## How the candidate stacks up — compare against THIS résumé (below): what they already have vs. gaps worth closing. Be honest; do not invent résumé content.\nCite sources inline like [1],[2] mapping to the excerpts' order. If the web excerpts are thin, say so rather than padding.`,
        },
        { role: "user", content: `ROLE: ${role}\n${jd ? `\nJD context:\n${jd.slice(0, 1500)}\n` : ""}\nWEB EXCERPTS:\n${corpus || "(search returned little — rely on general knowledge but flag it)"}\n\nCANDIDATE RÉSUMÉ (excerpt):\n${cvSkills}` },
      ], { maxTokens: 2200 });
      ok(res, { summary, sources: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url })) });
    } catch (e) { fail(res, e.message, 502); }
  },

  // "Ask Job Studio" — global assistant. Knows the user's files and can pull
  // the web when asked. Read-only advisor; it does not edit files or submit.
  "POST /api/ask": async (req, res) => {
    const { messages, pageContext } = await body(req);
    if (!Array.isArray(messages) || !messages.length) return fail(res, "messages[] required");
    try {
      const profile = loadYaml(P.profile) || {};
      const cv = (read(P.cv) || "").slice(0, 3000);
      const roles = profile.target_roles?.primary || [];
      const tracker = parseTracker();
      const applied = tracker.filter((r) => ["Applied", "Responded", "Interview", "Offer"].includes(r.status));

      // Optional web lookup: if the latest user turn clearly wants current info.
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      let web = "";
      if (/\b(latest|current|trend|market|202\d|salary|in demand|right now|news)\b/i.test(lastUser)) {
        const r = await webSearch(lastUser.slice(0, 120)).catch(() => []);
        web = r.slice(0, 4).map((x, i) => `[${i + 1}] ${x.title} — ${x.snippet} (${x.url})`).join("\n");
      }

      const reply = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are "Job Studio" — the user's job-search co-pilot inside a local app. Be concise, concrete, and honest.\n\nWHAT YOU KNOW:\nRÉSUMÉ (excerpt):\n${cv}\n\nTARGET ROLES: ${roles.join(", ") || "not set"}\nINTERVIEW/PROFILE FACTS: ${JSON.stringify(profile.interview || {})}\nAPPLIED (${applied.length}): ${applied.slice(0, 12).map((r) => `${r.role}@${r.company} [${r.status}]`).join("; ") || "none yet"}\n${pageContext ? `\nWHERE THEY ARE: ${pageContext}` : ""}${web ? `\n\nFRESH WEB RESULTS:\n${web}` : ""}\n\nRULES: Advise on their real situation. When you cite the web, reference [n]. Never invent résumé facts. You can't submit applications or edit files — if they want an action (tailor, evaluate, generate PDF), tell them which stage/button does it. Keep answers short unless asked to go deep.`,
        },
        ...messages.slice(-12),
      ], { maxTokens: 1100 });
      ok(res, { reply });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Regenerate the MASTER résumé per an instruction (no JD). Returns a full
  // revised résumé draft the UI renders in the canvas; the user saves to cv.md.
  "POST /api/regenerate-resume": async (req, res) => {
    const { instruction } = await body(req);
    if (!instruction || instruction.trim().length < 3) return fail(res, "instruction required");
    try {
      const ctx = groundingContext();
      const raw = await chat(loadSettings(), [
        { role: "system", content: `You are a résumé editor.\n\n${ctx}\n\n${GROUNDING_RULES}\n\nRewrite the candidate's résumé per the user's instruction. ONLY reorder, rephrase, re-emphasise, or restructure existing facts — never add employers, dates, metrics, or claims not already present. Keep it a complete résumé. Output ONLY the full résumé as markdown (no commentary, no code fence).` },
        { role: "user", content: `Instruction: ${instruction}` },
      ], { maxTokens: 4096 });
      const draft = raw.replace(/^```(?:markdown|md)?\n?/, "").replace(/\n?```\s*$/, "").trim();
      logEvent("regenerate_resume");
      ok(res, { draft });
    } catch (e) { fail(res, e.message, 502); }
  },

  // The action-capable assistant. Same knowledge as /api/ask, but it may emit
  // ONE action envelope on its own line: <<act:ACTION {json}>>. The client
  // parses it, runs the action against the existing endpoints, and renders the
  // resulting artifact in the main window. Destructive actions confirm client-side.
  "POST /api/agent": async (req, res) => {
    const { messages, context } = await body(req);
    if (!Array.isArray(messages) || !messages.length) return fail(res, "messages[] required");
    try {
      const profile = loadYaml(P.profile) || {};
      const cv = (read(P.cv) || "").slice(0, 2500);
      const roles = profile.target_roles?.primary || [];
      const applied = parseTracker().filter((r) => ["Applied", "Responded", "Interview", "Offer"].includes(r.status));
      const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      let web = "";
      if (/\b(latest|current|trend|market|202\d|salary|in demand|right now|news)\b/i.test(lastUser)) {
        const r = await webSearch(lastUser.slice(0, 120)).catch(() => []);
        web = r.slice(0, 4).map((x, i) => `[${i + 1}] ${x.title} — ${x.snippet} (${x.url})`).join("\n");
      }
      const jobOpen = context?.job ? `A JOB IS OPEN: ${context.job.role} @ ${context.job.company}${context.job.hasJd ? " (JD loaded)" : ""}.` : "No job is currently open.";

      const SYSTEM = `You are "Job Studio" — the user's action-capable job-search co-pilot inside a LOCAL app. You both advise AND do things.

WHAT YOU KNOW:
RÉSUMÉ (excerpt):\n${cv}
TARGET ROLES: ${roles.join(", ") || "not set"}
INTERVIEW/PROFILE FACTS: ${JSON.stringify(profile.interview || {})}
APPLIED (${applied.length}): ${applied.slice(0, 10).map((r) => `${r.role}@${r.company} [${r.status}]`).join("; ") || "none yet"}
CONTEXT: ${jobOpen} Current view: ${context?.view || "?"}.${web ? `\nFRESH WEB:\n${web}` : ""}

YOU CAN ACT by emitting EXACTLY ONE action on its own line (never inside a code fence). Format: <<act:ACTION {"key":"value"}>>
Actions:
- regenerateResume {"instruction":"…","scope":"master"} — rewrite the user's MASTER résumé per the instruction (reorder/rephrase only, never invent). Use scope "master" from the home view.
- tailorResume {"instruction":"…"} — tailor the résumé to the OPEN job (only if a job is open).
- evaluate {} — run the A–G fit evaluation on the open job.
- generatePdf {} — render the tailored résumé PDF for the open job.
- draftCover {} — draft the cover letter for the open job.
- markApplied {} — mark the open job Applied (asks the user to confirm).
- addCompany {"url":"https://…careers…"} — add a Greenhouse/Lever/Ashby company to the scan.
- scanNow {} — run a portal scan now.
- backgroundEval {} — start background evaluation + auto-prep of the inbox.
- navigate {"view":"cockpit|apply|track|discover|resume"} — take the user somewhere.

RULES:
- Emit an action ONLY when the user is asking to DO something you have an action for. Otherwise just answer — no envelope.
- Say briefly what you're doing, THEN the envelope on its own line. Don't paste résumé text in chat — the app renders artifacts in the window.
- Never invent résumé facts. Never auto-submit an application. Prefer the open job's context for job-specific actions.
- Keep replies short and concrete.`;

      const reply = await chat(loadSettings(), [{ role: "system", content: SYSTEM }, ...messages.slice(-12)], { maxTokens: 900 });
      const { action, clean } = extractAction(reply);
      logEvent("agent", { action: action?.name || "none" });
      ok(res, { reply: clean, action });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Inline résumé-improvement chat (apply screen). The model proposes an
  // improved résumé for the current JD; when it emits a full markdown résumé
  // in a ```markdown fence, the UI shows it in the live preview to accept.
  "POST /api/resume-chat": async (req, res) => {
    const { messages, jd, company, role } = await body(req);
    if (!Array.isArray(messages) || !messages.length) return fail(res, "messages[] required");
    try {
      const ctx = groundingContext();
      const reply = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are a résumé editor working on the candidate's résumé for a specific job.\n\n${ctx}\n\n${GROUNDING_RULES}\n\nTHIS JOB — Company: ${company || "?"}, Role: ${role || "?"}\n${jd ? `JD:\n${jd.slice(0, 4000)}\n` : ""}\nHOW YOU WORK:\n- Discuss changes conversationally, but whenever you produce a revised résumé, output the COMPLETE updated résumé as markdown inside a single \`\`\`markdown code fence so the app can preview it. Only reorder/rephrase/emphasise existing facts — never add new claims.\n- Keep the candidate's real employers, dates and metrics intact. Improvements = stronger bullets, JD-aligned wording, better ordering, tighter summary.\n- Outside the fence, briefly say what you changed and why.`,
        },
        ...messages.slice(-10),
      ], { maxTokens: 3000 });
      const draft = (reply.match(/```(?:markdown|md)?\n([\s\S]*?)```/) || [])[1] || null;
      ok(res, { reply, draft });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Address autocomplete — keyless OSM geocoder (Photon), Nominatim fallback.
  // Returns structured components so pincode/state/country populate themselves.
  "GET /api/geocode": async (req, res, url) => {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 3) return ok(res, { suggestions: [] });
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`);
      if (!r.ok) throw new Error(`geocoder ${r.status}`);
      const data = await r.json();
      const suggestions = (data.features || []).map((f) => {
        const p = f.properties || {};
        const line1 = [p.housenumber, p.street || (p.type === "house" ? p.name : "")].filter(Boolean).join(" ") || (p.type !== "city" ? p.name : "");
        return {
          label: [line1, p.city || p.district, [p.state, p.postcode].filter(Boolean).join(" "), p.country].filter(Boolean).join(", "),
          line1: line1 || "",
          city: p.city || p.district || (p.type === "city" ? p.name : "") || "",
          state: p.state || "",
          postcode: p.postcode || "",
          country: p.country || "",
        };
      }).filter((s) => s.label);
      ok(res, { suggestions });
    } catch (e) { fail(res, `Address lookup unavailable (${e.message}) — fill the fields manually.`, 502); }
  },

  // Place autocomplete for LOCATION fields — cities, regions, countries only
  // (not street addresses). Powers the choice-based location pickers so a
  // location is always a selected place, never free text.
  "GET /api/places": async (req, res, url) => {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return ok(res, { places: [] });
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en`);
      if (!r.ok) throw new Error(`geocoder ${r.status}`);
      const data = await r.json();
      const seen = new Set();
      const places = [];
      for (const f of data.features || []) {
        const p = f.properties || {};
        if (!["city", "town", "state", "country", "county", "region", "village", "locality", "district"].includes(p.type)) continue;
        const name = p.name;
        const label = [name, p.state && p.state !== name ? p.state : "", p.country && p.country !== name ? p.country : ""].filter(Boolean).join(", ");
        if (!label || seen.has(label)) continue;
        seen.add(label);
        places.push({ label, name, state: p.state || "", country: p.country || "", type: p.type });
      }
      // Always offer "Remote" for work-preference contexts.
      if (/^rem/i.test(q)) places.unshift({ label: "Remote", name: "Remote", country: "", type: "remote" });
      ok(res, { places });
    } catch (e) { fail(res, `Location lookup unavailable (${e.message})`, 502); }
  },

  // Conversational onboarding interview. The model plays recruiter: it knows
  // the resume, the answers so far, and REAL postings for the user's target
  // role (pulled live from the scanned pipeline), asks one question at a
  // time, and persists facts via <<save {json}>> envelopes.
  "POST /api/interview-chat": async (req, res) => {
    const { messages } = await body(req);
    if (!Array.isArray(messages) || !messages.length) return fail(res, "messages[] required");
    try {
      const profile = loadYaml(P.profile) || {};
      const roles = profile.target_roles?.primary || [];
      const cv = (read(P.cv) || "").slice(0, 2500);

      // Ground the conversation in what THIS role's applications actually ask:
      // sample up to 2 real postings for their top target role from the pipeline.
      let postingCtx = "";
      const topRole = roles[0];
      if (topRole) {
        const words = topRole.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const matches = parsePipeline().filter((i) => words.every((w) => i.title.toLowerCase().includes(w))).slice(0, 2);
        for (const m of matches) {
          const jd = await fetchJdFromUrl(m.url).catch(() => null);
          if (jd?.text) postingCtx += `\n--- Real posting: ${jd.title} @ ${jd.company} (${jd.location}) ---\n${jd.text.slice(0, 1400)}\n`;
        }
      }

      const SAVE_KEYS = "home_location, target_locations (array), remote_preference, work_authorization, needs_sponsorship, salary_expectation, notice_period, relocation, security_clearance, over_18, preferred_name, how_heard, superpower, achievement_story, why_looking, dealbreakers, gender, race_ethnicity, veteran_status, disability_status, pronouns, address_line1, address_city, address_state, address_postcode, address_country";

      const raw = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are a warm, efficient onboarding interviewer inside a job-search companion app. Your job: learn everything application forms will ask this candidate, so the app can fill them later.

CANDIDATE RESUME (excerpt):\n${cv}\n
TARGET ROLES: ${roles.join(", ") || "not chosen yet"}\n
ANSWERS ALREADY ON FILE (don't re-ask unless confirming): ${JSON.stringify(profile.interview || {})}
${postingCtx ? `\nREAL POSTINGS for their target role — mine these for role-specific things applications will ask (requirements, timezone, clearances, client-facing expectations):\n${postingCtx}` : ""}

RULES:
- Ask ONE question per turn. Short, conversational, no bullet lists of questions.
- Prioritize gaps in: what role/level they actually want → location & full address → work authorization & sponsorship → salary → notice/relocation → role-specific requirements you saw in the postings → their lead story → optional self-identification.
- For self-identification (gender, race/ethnicity, veteran, disability, pronouns): explain it's optional, used only to pre-fill the EEO sections they'd fill anyway, and "prefer not to say" is a fine answer.
- Whenever the user gives you a fact, persist it by appending on its own line: <<save {"key":"value"}>> (valid JSON, one line). Allowed keys: ${SAVE_KEYS}. Save aggressively — every concrete fact.
- After ~8-12 exchanges or when coverage is good, summarize what you saved and say they can fine-tune in the form below.`,
        },
        ...messages.slice(-16),
      ], { maxTokens: 900 });

      // Extract and apply save envelopes, hide them from the visible reply.
      const saved = {};
      const reply = raw.replace(/<<save\s+(\{[^\n]*\})\s*>>/g, (_, json) => {
        try { Object.assign(saved, JSON.parse(json)); } catch { /* skip bad json */ }
        return "";
      }).trim();
      if (Object.keys(saved).length && yaml) {
        ensureProfile();
        const p2 = loadYaml(P.profile) || {};
        p2.interview = { ...(p2.interview || {}), ...saved };
        writeFileSync(P.profile, yaml.dump(p2, { lineWidth: 120 }));
      }
      ok(res, { reply, saved: Object.keys(saved) });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Per-job artifact bundle — the apply flow reads this on open (resume where
  // left off) and writes each artifact as it's produced.
  // Cockpit feed: what needs the user's attention, ranked. Combines the
  // per-job artifact store (evaluated/prepared) with the tracker (applied,
  // follow-ups due, interviews upcoming). No model calls — pure aggregation.
  "GET /api/cockpit": async (req, res) => {
    const store = loadJobs();
    const rows = parseTracker();
    const trackedByKey = {};
    for (const r of rows) trackedByKey[`${r.company.toLowerCase()}|${r.role.toLowerCase()}`] = r;

    // "To review": evaluated + (ideally) prepared, not yet applied/skipped.
    const appliedKeys = new Set(rows.filter((r) => ["Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "SKIP"].includes(r.status)).map((r) => `${r.company.toLowerCase()}|${r.role.toLowerCase()}`));
    const review = [];
    for (const [key, j] of Object.entries(store)) {
      if (j.score == null) continue;
      const ck = `${(j.company || "").toLowerCase()}|${(j.role || "").toLowerCase()}`;
      if (appliedKeys.has(ck)) continue;
      review.push({ key, company: j.company, role: j.role, url: /^https?:/.test(key) ? key : null, score: j.score, prepared: !!(j.pdf && j.letter), pdf: j.pdf || null });
    }
    review.sort((a, b) => (b.prepared - a.prepared) || (b.score - a.score));

    // Applied → monitor follow-ups; Interview → upcoming.
    const days = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 86400000));
    const applied = rows.filter((r) => r.status === "Applied").map((r) => ({ ...r, daysSince: days(r.date), followUpDue: days(r.date) >= 7 }));
    const interviewing = rows.filter((r) => r.status === "Interview" || r.status === "Responded").map((r) => {
      const j = store[`${r.company.toLowerCase()}|${r.role.toLowerCase()}`] || {};
      return { ...r, interviewDate: j.interviewDate || "", roadmapFile: j.roadmapFile || "", daysToInterview: j.interviewDate ? Math.round((new Date(j.interviewDate) - Date.now()) / 86400000) : null };
    });

    ok(res, {
      review: review.slice(0, 40),
      counts: { review: review.length, reviewPrepared: review.filter((r) => r.prepared).length, applied: applied.length, followUpsDue: applied.filter((a) => a.followUpDue).length, interviewing: interviewing.length },
      applied, interviewing,
      background: bgState(),
      schedule: schedulerState(),
    });
  },

  "GET /api/job-state": async (req, res, url) => {
    ok(res, { state: loadJobs()[jobKey({ url: url.searchParams.get("url"), company: url.searchParams.get("company"), role: url.searchParams.get("role") })] || null });
  },
  "POST /api/job-state": async (req, res) => {
    const b = await body(req);
    const key = jobKey(b);
    ok(res, { state: saveJobArtifact(key, b.patch || {}) });
  },

  // Lightweight telemetry for future design decisions (local file only).
  "POST /api/telemetry": async (req, res) => {
    const { event, data } = await body(req);
    if (event) logEvent(String(event).slice(0, 60), data || {});
    ok(res, { logged: true });
  },
  "GET /api/telemetry-summary": async (req, res) => {
    const raw = read(TELEMETRY_PATH) || "";
    const counts = {};
    let total = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); counts[e.event] = (counts[e.event] || 0) + 1; total++; } catch { /* skip */ }
    }
    ok(res, { total, counts });
  },

  "POST /api/fetch-jd": async (req, res) => {
    const { url } = await body(req);
    if (!/^https?:\/\//.test(url || "")) return fail(res, "valid url required");
    const jd = await fetchJdFromUrl(url);
    if (!jd) return fail(res, "Couldn't retrieve this posting automatically — it may be JavaScript-rendered. Paste the JD text instead.", 502);
    ok(res, jd);
  },

  "GET /api/followups": async (req, res) => {
    const r = await runNode([join(ROOT, "followup-cadence.mjs")], { timeoutMs: 30_000 });
    let data = null;
    try { data = JSON.parse(r.out.slice(r.out.indexOf("{"))); } catch { /* tolerate */ }
    ok(res, { cadence: data && !data.error ? data : null });
  },

  "POST /api/gmail-pull": async (req, res) => {
    const r = await runNode([join(ROOT, "plugins.mjs"), "run", "gmail"], { timeoutMs: 120_000 });
    ok(res, { code: r.code, output: (r.out + "\n" + r.err).trim().split("\n").slice(-25).join("\n") });
  },

  "GET /api/plugins": async (req, res) => {
    const r = await runNode([join(ROOT, "doctor.mjs"), "--json"], { timeoutMs: 30_000 });
    let plugins = [];
    try { plugins = JSON.parse(r.out.slice(r.out.indexOf("{"))).plugins || []; } catch { /* absent */ }
    ok(res, { plugins });
  },

  // Skill-gap prep plan for an applied job — grounded in the evaluation
  // report (if one exists), the resume, and the interview answers. Saved to
  // interview-prep/ (user layer), where the career-ops interview modes read it.
  "POST /api/prep": async (req, res) => {
    const { company, role } = await body(req);
    if (!company || !role) return fail(res, "company and role required");
    try {
      const ctx = groundingContext();
      const slug = slugify(company);
      const reportFile = existsSync(P.reports)
        ? readdirSync(P.reports).filter((f) => f.includes(slug) && f.endsWith(".md")).sort().pop()
        : null;
      const report = reportFile ? read(join(P.reports, reportFile)) : null;
      const plan = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are an interview-preparation coach.\n\n${ctx}\n\n${GROUNDING_RULES}\n\nProduce a prep document in markdown with exactly these sections:\n## Skill gaps — requirements this candidate is weakest on for THIS role (from the evaluation report if provided, otherwise inferred from the JD/role vs the resume). Honest, specific.\n## Study plan — for each gap: what to review/practice this week, concrete and scoped.\n## Likely interview questions — 8-10 questions this company/role will probably ask.\n## Your stories — for each of 3-4 questions, which REAL experience from the resume to use (STAR pointers, not invented details).`,
        },
        { role: "user", content: `Company: ${company} — Role: ${role}\n${report ? `\nEvaluation report:\n${report.slice(0, 6000)}` : "\n(no evaluation report on file)"}` },
      ], { maxTokens: 3500 });
      mkdirSync(join(ROOT, "interview-prep"), { recursive: true });
      const prepPath = join(ROOT, "interview-prep", `${slug}-${slugify(role)}.md`);
      writeFileSync(prepPath, `# Prep — ${company} · ${role}\n\n_Generated by Studio ${new Date().toISOString().slice(0, 10)}_\n\n${plan}`);
      ok(res, { plan, file: `interview-prep/${basename(prepPath)}` });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Interview prep — step 1: AI suggests topics to prepare, from the JD/eval
  // gap vs. the résumé. The user picks which ones matter to them.
  "POST /api/prep-topics": async (req, res) => {
    const { company, role } = await body(req);
    if (!company || !role) return fail(res, "company and role required");
    try {
      const ctx = groundingContext();
      const slug = slugify(company);
      const reportFile = existsSync(P.reports) ? readdirSync(P.reports).filter((f) => f.includes(slug) && f.endsWith(".md")).sort().pop() : null;
      const report = reportFile ? read(join(P.reports, reportFile)) : null;
      const raw = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are an interview coach. Suggest the concrete things this candidate should prepare for THIS role, ranked by importance. Base it on the gap between the role and their résumé (use the evaluation report if given).\nOutput STRICT JSON only: {"topics":[{"topic":"short name","why":"one line why it matters for this role","priority":"high|medium|low"}]} — 6 to 10 topics, mix of technical and behavioral.`,
        },
        { role: "user", content: `Company: ${company} — Role: ${role}\n${report ? `\nEvaluation report:\n${report.slice(0, 5000)}` : ""}\n\nRésumé + profile:\n${ctx.slice(0, 3000)}` },
      ], { maxTokens: 1500 });
      let topics = [];
      try { topics = JSON.parse((raw.match(/\{[\s\S]*\}/) || [])[0]).topics || []; } catch { /* tolerate */ }
      logEvent("prep_topics", { company, role, n: topics.length });
      ok(res, { topics });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Interview prep — step 2: build a time-blocked roadmap from the user's
  // chosen topics, scheduled between today and the interview date. Saved to
  // interview-prep/ so the career-ops interview modes can read it.
  "POST /api/prep-roadmap": async (req, res) => {
    const { company, role, topics, interviewDate } = await body(req);
    if (!company || !role || !Array.isArray(topics) || !topics.length) return fail(res, "company, role, topics[] required");
    try {
      const ctx = groundingContext();
      const today = new Date().toISOString().slice(0, 10);
      const days = interviewDate ? Math.max(1, Math.round((new Date(interviewDate) - Date.now()) / 86400000)) : null;
      const plan = await chat(loadSettings(), [
        {
          role: "system",
          content: `You are an interview-prep coach. Build a realistic, time-blocked study roadmap from today (${today}) to the interview${interviewDate ? ` on ${interviewDate} (~${days} days)` : " (assume ~10 days)"}. ONLY cover the topics the candidate chose.\nMarkdown with:\n## Roadmap — a day-by-day or phase-by-phase schedule (group days if many). Each block: what to study/practice, a concrete deliverable (e.g. "write out a STAR story for X", "implement Y from scratch"), and est. time.\n## Anchor to your experience — for each topic, which REAL résumé experience to connect it to (STAR pointers, no invented facts).\n## Day before — light review + logistics checklist.\nBe specific and scoped; respect the time available (don't over-schedule a 3-day runway).`,
        },
        { role: "user", content: `Company: ${company} — Role: ${role}\nInterview date: ${interviewDate || "not set"}\nChosen topics:\n${topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nRésumé + profile:\n${ctx.slice(0, 3000)}` },
      ], { maxTokens: 3500 });
      mkdirSync(join(ROOT, "interview-prep"), { recursive: true });
      const prepPath = join(ROOT, "interview-prep", `${slugify(company)}-${slugify(role)}-roadmap.md`);
      writeFileSync(prepPath, `# Interview roadmap — ${company} · ${role}\n\n_Interview: ${interviewDate || "TBD"} · generated ${today}_\n\n**Preparing:** ${topics.join(", ")}\n\n${plan}`);
      // persist date + topics on the job artifact so Track can show a countdown
      saveJobArtifact(jobKey({ company, role }), { interviewDate: interviewDate || "", prepTopics: topics, roadmapFile: `interview-prep/${basename(prepPath)}` });
      logEvent("prep_roadmap", { company, role, topics: topics.length, days });
      ok(res, { plan, file: `interview-prep/${basename(prepPath)}` });
    } catch (e) { fail(res, e.message, 502); }
  },

  // One click: tailor the resume to the JD and render a real ATS-clean PDF
  // through the repo's own template + Playwright pipeline.
  "POST /api/tailored-pdf": async (req, res) => {
    const { jd, company, role, context } = await body(req);
    if (!jd || jd.trim().length < 80) return fail(res, "Paste the job description first.");
    try {
      const ctx = groundingContext();
      const extra = context ? `\n\nUSE THIS FIT ANALYSIS + MARKET INTEL to decide what to surface (emphasise the candidate's real strengths these highlight; do not invent):\n${String(context).slice(0, 3500)}` : "";
      const raw = await chat(loadSettings(), [
        { role: "system", content: `You tailor resumes.\n\n${ctx}\n\n${GROUNDING_RULES}\n\n${TAILOR_JSON_PROMPT}${extra}` },
        { role: "user", content: `Company: ${company || "?"} — Role: ${role || "?"}\n\nJob description:\n${jd.slice(0, 8000)}` },
      ], { maxTokens: 4096 });
      const match = raw.match(/\{[\s\S]*\}/);
      let data;
      try { data = JSON.parse(match ? match[0] : raw); } catch { return fail(res, "The model returned malformed JSON — try again (larger models are more reliable here).", 502); }

      const profile = loadYaml(P.profile) || {};
      const candidate = scrubCandidate(profile.candidate);
      if (!candidate.full_name || !candidate.email) return fail(res, "Missing name/email in your profile — fill Contact details on the Resume step.");

      const slug = slugify(`${candidate.full_name.split(" ")[0]}-${company || role || "tailored"}`);
      const date = new Date().toISOString().slice(0, 10);
      const htmlPath = join(ROOT, "output", `cv-${slug}-${date}.html`);
      const pdfPath = join(ROOT, "output", `cv-${slug}-${date}.pdf`);
      mkdirSync(join(ROOT, "output"), { recursive: true });
      writeFileSync(htmlPath, fillCvTemplate(data, candidate));

      const r = await runNode([join(ROOT, "generate-pdf.mjs"), htmlPath, pdfPath, "--format=letter"], { timeoutMs: 120_000 });
      if (!existsSync(pdfPath)) return fail(res, `PDF render failed: ${(r.err || r.out).slice(-400)}`, 500);
      logEvent("tailored_pdf", { company, role, withContext: !!context });
      ok(res, { pdf: basename(pdfPath), summary: data.summary || "", competencies: data.competencies || [] });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Latest tailored PDF (optionally filtered by company slug) — the browser
  // extension attaches this to Resume/CV upload fields via DataTransfer.
  "GET /api/latest-pdf": async (req, res, url) => {
    const q = slugify(url.searchParams.get("q") || "").slice(0, 30);
    const dir = join(ROOT, "output");
    if (!existsSync(dir)) return fail(res, "no PDFs generated yet", 404);
    const pdfs = readdirSync(dir).filter((f) => f.endsWith(".pdf"))
      .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    const pick = (q && pdfs.find((p) => p.f.includes(q))) || pdfs[0];
    if (!pick) return fail(res, "no PDFs generated yet — use Tailor → Generate PDF first", 404);
    ok(res, { file: pick.f, b64: readFileSync(join(dir, pick.f)).toString("base64") });
  },

  "GET /api/pdf-file": async (req, res, url) => {
    const f = basename(url.searchParams.get("f") || "");
    const p = join(ROOT, "output", f);
    if (!f.endsWith(".pdf") || !existsSync(p)) return fail(res, "not found", 404);
    res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="${f}"` });
    res.end(readFileSync(p));
  },

  // Called by the browser extension: given the form fields found on a job
  // application page, draft values grounded in resume + profile + interview.
  // Unknowns stay empty — the extension never guesses and never submits.
  "POST /api/autofill": async (req, res) => {
    const { fields, url: pageUrl, title, pageText } = await body(req);
    if (!Array.isArray(fields) || !fields.length) return fail(res, "fields[] required");
    try {
      const ctx = groundingContext();
      const fieldList = fields.slice(0, 60).map((f) => ({
        id: f.id, label: (f.label || "").slice(0, 120), type: f.type,
        ...(f.options?.length ? { options: f.options.slice(0, 40) } : {}),
      }));
      const raw = await chat(loadSettings(), [
        {
          role: "system",
          content: `You fill job-application form fields for a candidate.\n\n${ctx}\n\n${GROUNDING_RULES}\n\nRules per field TYPE — respect the type exactly:\n- select / radio: value MUST be copied VERBATIM from that field's options list. Pick the option matching the candidate's profile; if none clearly matches, "".\n- checkbox: return "Yes" ONLY when the profile clearly affirms the labelled statement; otherwise "". Never "Yes" for consent/certification/terms boxes.\n- text / email / tel / url: the exact value from the profile (email as-is, phone as-is).\n- date: ISO format YYYY-MM-DD, only if derivable from the profile; else "".\n- number: digits only.\n- textarea (long answers): 60-140 words, grounded in the resume, specific.\nGeneral:\n- Contact fields come from the profile. Authorization/sponsorship/salary/notice come from the interview block in the profile.\n- Country/state/city fields MAY be derived from the profile's stated locations (a US state as home_location implies country United States) — derivation from stated facts is fine; invention is not.\n- If the resume/profile doesn't contain or imply the needed fact, return "" for that field. NEVER guess or invent.\n- Output STRICT JSON only: [{"id": "<field id>", "value": "<value>"}]`,
        },
        {
          role: "user",
          content: `Application page: ${title || ""} (${pageUrl || ""})\n${pageText ? `Page context:\n${String(pageText).slice(0, 3000)}\n` : ""}\nFields:\n${JSON.stringify(fieldList, null, 1)}`,
        },
      ], { maxTokens: 4096 });
      const match = raw.match(/\[[\s\S]*\]/);
      let values;
      try { values = JSON.parse(match ? match[0] : raw); } catch { return fail(res, "Model returned malformed JSON — try again.", 502); }

      // Deterministic anti-fabrication guard. Models WILL guess on these even
      // when told not to (verified in testing) — so sensitive answers are only
      // allowed through when the user's interview actually provides them, and
      // demographic/EEO questions are never auto-answered at all.
      const interview = (loadYaml(P.profile) || {}).interview || {};
      // Sensitive fields only pass through when the user's own interview
      // answers provide them — including self-identification, which fills
      // ONLY from the explicit optional answers in About You.
      const SENSITIVE = [
        { re: /citizen|authoriz|right to work|work permit/i, key: "work_authorization" },
        { re: /sponsor|visa/i, key: "needs_sponsorship" },
        { re: /salary|compensation|pay expectation|desired pay|expected pay|rate/i, key: "salary_expectation" },
        { re: /notice period|start date|available to start|availability/i, key: "notice_period" },
        { re: /relocat/i, key: "relocation" },
        { re: /clearance/i, key: "security_clearance" },
        { re: /18|age of majority|legal age/i, key: "over_18" },
        { re: /gender|sex\b/i, key: "gender" },
        { re: /race|ethnic/i, key: "race_ethnicity" },
        { re: /veteran/i, key: "veteran_status" },
        { re: /disabilit/i, key: "disability_status" },
        { re: /pronoun/i, key: "pronouns" },
      ];
      const NEVER = /orientation|religio|date of birth|marital|criminal|conviction/i;
      const fieldOf = Object.fromEntries(fields.map((f) => [f.id, f]));
      for (const v of values) {
        const f = fieldOf[v.id] || {};
        const label = f.label || "";
        if (NEVER.test(label)) { v.value = ""; v.blocked = "answer this one yourself"; continue; }
        const s = SENSITIVE.find((x) => x.re.test(label));
        if (!s) continue;
        const answer = String(interview[s.key] || "").trim();
        if (!answer) {
          v.value = "";
          v.blocked = "not in your About You answers — fill it there once or answer manually";
          continue;
        }
        // The user's own answer is AUTHORITATIVE — models reinterpret these
        // (verified: returned "30 days" against a stated "2 weeks").
        const hasOptions = Array.isArray(f.options) && f.options.length;
        if (!hasOptions && !["checkbox", "radio"].includes(f.type)) {
          v.value = answer; // free-text: copy verbatim
        } else if (hasOptions) {
          // Choice field: model's pick must be consistent with the answer;
          // if the answer plainly matches a different option, correct it.
          const norm = (x) => String(x).toLowerCase().trim();
          const direct = f.options.find((o) => norm(o) === norm(answer))
            || f.options.find((o) => norm(o).includes(norm(answer)) || norm(answer).includes(norm(o)));
          const yesNo = /^(yes|no)\b/i.exec(answer);
          const byPolarity = yesNo ? f.options.find((o) => new RegExp(`^${yesNo[1]}\\b`, "i").test(o)) : null;
          const corrected = direct || byPolarity;
          if (corrected && norm(corrected) !== norm(v.value)) v.value = corrected;
        }
      }
      ok(res, { values: values.filter((v) => v && v.id) });
    } catch (e) { fail(res, e.message, 502); }
  },

  // Mark a job Evaluated/Applied/SKIP etc. through the official pipeline.
  "POST /api/track": async (req, res) => {
    const { company, role, status, score, reportPath, note } = await body(req);
    if (!company || !role || !status) return fail(res, "company, role, status required");
    const CANONICAL = ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "SKIP"];
    if (!CANONICAL.includes(status)) return fail(res, `status must be one of: ${CANONICAL.join(", ")}`);
    try {
      logEvent("status_change", { company, role, status });
      ok(res, await trackApplication({ company, role, status, score, reportPath, note }));
    } catch (e) { fail(res, e.message, 500); }
  },

  "POST /api/resume": async (req, res) => {
    const { content } = await body(req);
    if (!content || content.trim().length < 40) return fail(res, "Resume looks empty — paste the full text.");
    writeFileSync(P.cv, content);
    syncContactFromCv(content);
    ok(res, { saved: true, candidate: loadYaml(P.profile)?.candidate || {} });
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
    ok(res, { candidate: scrubCandidate(profile?.candidate), roles: profile?.target_roles?.primary || [] });
  },

  // Background evaluation queue. Evaluates pending inbox postings one at a
  // time (local models are serial anyway); for score ≥ threshold it auto-runs
  // the full prep pipeline (tailor PDF + cover letter). Poll /api/background.
  "GET /api/schedule": async (req, res) => ok(res, { schedule: schedulerState() }),
  "POST /api/schedule": async (req, res) => {
    const b = await body(req);
    const cur = loadSettings();
    saveSettings({ ...cur, scheduleEnabled: !!b.enabled, scheduleHour: Number.isFinite(b.hour) ? b.hour : 12, scheduleAutoEval: !!b.autoEval });
    armScheduler();
    ok(res, { schedule: schedulerState() });
  },
  // Run the daily refresh immediately (manual trigger of the scheduled job).
  "POST /api/schedule-run": async (req, res) => {
    const r = await runNode([join(ROOT, "scan.mjs")], { timeoutMs: 15 * 60 * 1000 });
    sched.lastRun = Date.now();
    sched.lastResult = (r.out + r.err).trim().split("\n").slice(-3).join(" | ");
    ok(res, { schedule: schedulerState(), output: (r.out + r.err).trim().split("\n").slice(-30).join("\n") });
  },

  "POST /api/background": async (req, res) => {
    const { action, threshold = 4, limit = 20 } = await body(req);
    if (action === "stop") { bg.stop = true; return ok(res, { state: bgState() }); }
    if (action === "start") {
      if (bg.running) return ok(res, { state: bgState() });
      runBackground({ threshold, limit }).catch((e) => { bg.error = e.message; bg.running = false; });
      return ok(res, { state: bgState() });
    }
    ok(res, { state: bgState() });
  },
  "GET /api/background": async (req, res) => ok(res, { state: bgState() }),

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
    logEvent("evaluate", { provider: s.provider, model: s.model });
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

    // Serve the extension's content script for the local test harness
    // (public/test-form.html) so the exact shipping code gets exercised.
    if (url.pathname === "/ext/content.js") {
      return send(res, 200, readFileSync(join(STUDIO, "extension", "content.js")), "text/javascript");
    }

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
  armScheduler();
  const sc = schedulerState();
  if (sc.enabled) console.log(`  daily refresh: ${sc.hour}:00 (next ${sc.nextRun})\n`);
});

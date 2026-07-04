/* Career-Ops Studio v2 — the job search as a journey.
 * Vanilla JS state machine (deliberately no framework: zero build step,
 * publishable as-is). Stages advance the three.js background camera.
 */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view");
const bg = () => window.journeyBg || { setStage() {}, setCities() {}, setGlobe() {} };

const state = {
  status: null,
  catalog: null,
  selectedRoles: [],
  interview: {},
  stage: 0,
  maxStage: 0,        // furthest unlocked
  jobs: [],           // apply board rail
  activeJob: null,
  ws: {},             // per-job workspace cache
};

/* ── utilities ─────────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast show${isErr ? " err" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 3800);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function md(src) {
  if (!src) return "";
  const lines = esc(src).split("\n");
  let html = "", inList = false, inCode = false, inTable = false;
  const closeAll = () => { if (inList) { html += "</ul>"; inList = false; } if (inTable) { html += "</table>"; inTable = false; } };
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  for (const line of lines) {
    if (line.startsWith("```")) { inCode = !inCode; html += inCode ? "<pre>" : "</pre>"; continue; }
    if (inCode) { html += line + "\n"; continue; }
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s\-|:]+\|\s*$/.test(line)) continue;
      if (!inTable) { html += "<table>"; inTable = true; }
      html += `<tr>${line.split("|").slice(1, -1).map((c) => `<td>${inline(c.trim())}</td>`).join("")}</tr>`;
      continue;
    } else if (inTable) { html += "</table>"; inTable = false; }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeAll(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (/^(\s*[-*+]\s+)/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`; continue;
    } else if (inList && line.trim() === "") { html += "</ul>"; inList = false; continue; }
    if (/^---+\s*$/.test(line)) { closeAll(); html += "<hr>"; continue; }
    if (line.trim() === "") continue;
    closeAll();
    html += `<p>${inline(line)}</p>`;
  }
  closeAll();
  if (inCode) html += "</pre>";
  return html;
}

const copyText = (t, label = "Copied") => navigator.clipboard.writeText(t).then(() => toast(label));

// Debounced place autocomplete: attaches a suggestion dropdown to an input so
// locations are ALWAYS chosen from real places, never typed free-form.
// onPick(place) fires on selection. If chips=true, the input clears after each
// pick (multi-select); otherwise the label stays in the box (single-select).
function attachPlaces(input, dropdown, { onPick, chips = false } = {}) {
  let timer, active = -1, current = [];
  const close = () => { dropdown.hidden = true; active = -1; };
  const paint = () => {
    dropdown.innerHTML = current.length
      ? current.map((p, i) => `<div class="addr-opt ${i === active ? "hi" : ""}" data-i="${i}">${esc(p.label)}</div>`).join("")
      : `<div class="addr-opt" style="color:var(--faint)">no matches — keep typing</div>`;
    dropdown.hidden = false;
    $$(".addr-opt[data-i]", dropdown).forEach((el) => el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pick(current[+el.dataset.i]);
    }));
  };
  const pick = (p) => {
    onPick(p);
    if (chips) input.value = ""; else input.value = p.label;
    close();
  };
  input.setAttribute("autocomplete", "off");
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      try {
        const { places } = await api(`/api/places?q=${encodeURIComponent(q)}`);
        current = places;
        paint();
      } catch { close(); }
    }, 280);
  });
  input.addEventListener("keydown", (e) => {
    if (dropdown.hidden) return;
    if (e.key === "ArrowDown") { active = Math.min(active + 1, current.length - 1); paint(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { pick(current[active]); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 200));
}
const markAdds = (t) => esc(t).replace(/\[ADD:([^\]]*)\]/g, "<mark>[ADD:$1]</mark>");
const spin = `<span class="spinner"></span>`;

async function loadStatus() { state.status = await api("/api/status"); return state.status; }
async function loadCatalog() {
  if (!state.catalog) {
    state.catalog = await api("/api/roles");
    state.selectedRoles = state.catalog.selected || [];
  }
  return state.catalog;
}

/* ── journey engine ────────────────────────────────────── */
const STAGES = [
  { id: "welcome", label: "Start" },
  { id: "model", label: "Model" },
  { id: "resume", label: "Resume" },
  { id: "interview", label: "You" },
  { id: "roles", label: "Roles" },
  { id: "scan", label: "Discover" },
  { id: "board", label: "Apply" },
  { id: "track", label: "Track" },
];

function renderRail() {
  $("#journey-rail").innerHTML = STAGES.map((s, i) => `
    <div class="j-step ${i < state.stage ? "done" : ""} ${i === state.stage ? "active" : ""}">
      <span class="j-dot" data-stage="${i}" title="${s.label}">${i < state.stage ? "✓" : i + 1}<span class="j-label">${s.label}</span></span>
      ${i < STAGES.length - 1 ? `<span class="j-line"></span>` : ""}
    </div>`).join("");
  $$("#journey-rail [data-stage]").forEach((d) => d.addEventListener("click", () => {
    const i = +d.dataset.stage;
    if (i <= state.maxStage) go(i);
  }));
}

async function go(i) {
  state.stage = i;
  state.maxStage = Math.max(state.maxStage, i);
  bg().setStage(i);
  bg().setGlobe(STAGES[i].id === "interview");
  renderRail();
  view.innerHTML = `<div class="empty">${spin}</div>`;
  try { await stages[STAGES[i].id](); } catch (e) {
    view.innerHTML = `<div class="card stage"><h3>Something went wrong</h3><p class="hint">${esc(e.message)}</p></div>`;
  }
  scrollTo({ top: 0, behavior: "smooth" });
}

function stageNav({ backTo = null, nextLabel = "Continue →", onNext = null, nextDisabled = false } = {}) {
  return `<div class="stage-nav">
    ${backTo !== null ? `<button class="btn" id="nav-back">← Back</button>` : "<span></span>"}
    ${onNext ? `<button class="btn primary" id="nav-next" ${nextDisabled ? "disabled" : ""}>${nextLabel}</button>` : "<span></span>"}
  </div>`;
}
function wireNav(backTo, onNext) {
  $("#nav-back")?.addEventListener("click", () => go(backTo));
  $("#nav-next")?.addEventListener("click", onNext);
}

/* ══════════════════ STAGES ══════════════════ */
const stages = {};

/* 0 — Welcome */
stages.welcome = async () => {
  const s = await loadStatus();
  view.innerHTML = `
    <div class="stage hero">
      <h1>Your AI companion for<br>the job search.</h1>
      <p>Runs on your machine, on a model you choose. It learns your background once, then works beside you on every application — evaluating fit, tailoring your resume, drafting answers. You review everything; you send everything.</p>
      <button class="btn primary" id="begin">${s.cv ? "Continue" : "Get started"}</button>
      <p style="margin-top:26px;font-size:12.5px;color:var(--faint)">Private by default · nothing is ever submitted on your behalf.</p>
    </div>`;
  $("#begin").addEventListener("click", () => go(1));
};

/* 1 — Model */
const PRESETS = [
  { id: "ollama", name: "Ollama (local)", provider: "ollama", baseUrl: "http://localhost:11434", key: false, note: "Free, private, offline. Use a 32B+ model for evaluations you can trust." },
  { id: "lmstudio", name: "LM Studio (local)", provider: "openai", baseUrl: "http://localhost:1234/v1", key: false, note: "Local OpenAI-compatible server." },
  { id: "openai", name: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1", key: true, note: "" },
  { id: "anthropic", name: "Anthropic", provider: "openai", baseUrl: "https://api.anthropic.com/v1", key: true, note: "Via Anthropic's OpenAI-compatible endpoint." },
  { id: "openrouter", name: "OpenRouter", provider: "openai", baseUrl: "https://openrouter.ai/api/v1", key: true, note: "One key, hundreds of models." },
  { id: "groq", name: "Groq", provider: "openai", baseUrl: "https://api.groq.com/openai/v1", key: true, note: "Fast Llama hosting, free tier." },
  { id: "deepseek", name: "DeepSeek", provider: "openai", baseUrl: "https://api.deepseek.com/v1", key: true, note: "Very low cost." },
  { id: "custom", name: "Custom endpoint", provider: "openai", baseUrl: "", key: true, note: "Any OpenAI-compatible /v1 base (vLLM, llama.cpp, Together…)." },
];

async function settingsForm(container, onConnected) {
  const s = await api("/api/settings");
  const active = PRESETS.find((p) => p.baseUrl === s.baseUrl && p.provider === s.provider) || (s.provider === "ollama" ? PRESETS[0] : PRESETS.at(-1));
  container.innerHTML = `
    <label class="field">Provider</label>
    <select id="st-preset">${PRESETS.map((p) => `<option value="${p.id}" ${p.id === active.id ? "selected" : ""}>${p.name}</option>`).join("")}</select>
    <p class="hint" id="st-note" style="margin-top:6px">${esc(active.note)}</p>
    <label class="field">Base URL</label>
    <input type="text" id="st-url" value="${esc(s.baseUrl)}">
    <div id="st-keywrap" style="${active.key ? "" : "display:none"}">
      <label class="field">API key <span style="font-weight:400;color:var(--faint)">— stored only on this machine</span></label>
      <input type="password" id="st-key" value="${esc(s.apiKey)}" placeholder="sk-…">
    </div>
    <label class="field">Model</label>
    <div class="row">
      <select id="st-model" style="flex:1"><option value="${esc(s.model)}">${esc(s.model || "— fetch models →")}</option></select>
      <button class="btn" id="st-fetch">Fetch models</button>
    </div>
    <div class="row end" style="margin-top:16px">
      <span id="st-out" class="hint" style="margin-right:auto"></span>
      <button class="btn primary" id="st-test">Save & test</button>
    </div>`;

  const save = () => api("/api/settings", { method: "POST", body: {
    provider: PRESETS.find((p) => p.id === $("#st-preset", container).value)?.provider || "openai",
    baseUrl: $("#st-url", container).value,
    apiKey: $("#st-key", container)?.value ?? "",
    model: $("#st-model", container).value,
  }}).then(() => (state.status = null));

  $("#st-preset", container).addEventListener("change", () => {
    const p = PRESETS.find((x) => x.id === $("#st-preset", container).value);
    if (p.baseUrl) $("#st-url", container).value = p.baseUrl;
    $("#st-keywrap", container).style.display = p.key ? "" : "none";
    $("#st-note", container).textContent = p.note;
  });
  $("#st-fetch", container).addEventListener("click", async () => {
    try {
      await save();
      const { models } = await api("/api/models");
      const cur = $("#st-model", container).value;
      $("#st-model", container).innerHTML = models.map((m) => `<option ${m === cur ? "selected" : ""}>${esc(m)}</option>`).join("") || `<option value="">none found</option>`;
      toast(`${models.length} model(s) found`);
    } catch (e) { toast(e.message, true); }
  });
  $("#st-test", container).addEventListener("click", async () => {
    $("#st-out", container).innerHTML = spin;
    try {
      await save();
      const r = await api("/api/test-llm", { method: "POST", body: {} });
      $("#st-out", container).innerHTML = `<span class="pill ok">connected — “${esc(r.reply)}”</span>`;
      onConnected?.();
    } catch (e) { $("#st-out", container).innerHTML = `<span class="pill warn">${esc(e.message)}</span>`; }
  });
}

stages.model = async () => {
  view.innerHTML = `
    <div class="stage stage-narrow">
      <div class="page-title">Choose your model</div>
      <p class="page-sub">Everything runs on a model you control — a local Ollama (private, free) or your own API key (faster, sharper). You can switch anytime from the top bar.</p>
      <div class="card" id="settings-slot"></div>
      <div class="note">Local advice: 7–8B models fabricate and miss the evaluation format. Use <b>32B+</b> (qwen2.5:32b, llama3.3:70b) — or a cheap hosted model (DeepSeek, Groq) for cents.</div>
      ${stageNav({ backTo: 0, onNext: true })}
    </div>`;
  await settingsForm($("#settings-slot"), () => toast("Model connected"));
  wireNav(0, async () => {
    const s = await loadStatus();
    if (!s.settings.model) return toast("Fetch models and pick one first", true);
    go(2);
  });
};

/* 2 — Resume (multi-format) */
let pdfjsPromise, mammothPromise;
function loadPdfjs() {
  return (pdfjsPromise ||= import("https://unpkg.com/pdfjs-dist@4.2.67/build/pdf.min.mjs").then((m) => {
    m.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@4.2.67/build/pdf.worker.min.mjs";
    return m;
  }));
}
function loadMammoth() {
  return (mammothPromise ||= new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js";
    sc.onload = () => res(window.mammoth);
    sc.onerror = () => rej(new Error("Couldn't load DOCX converter (offline?)"));
    document.head.appendChild(sc);
  }));
}

async function extractFile(file) {
  const name = file.name.toLowerCase();
  const setBusy = (msg) => ($("#rz-status").innerHTML = `${spin} ${esc(msg)}`);
  if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".markdown")) {
    return { direct: await file.text() };
  }
  if (name.endsWith(".tex")) {
    setBusy("Converting LaTeX with your model…");
    const r = await api("/api/convert-resume", { method: "POST", body: { kind: "latex", content: await file.text() } });
    return { converted: r.markdown };
  }
  if (name.endsWith(".pdf")) {
    setBusy("Reading PDF…");
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      text += content.items.map((i) => i.str).join(" ") + "\n\n";
    }
    if (text.trim().length < 60) throw new Error("This PDF has no extractable text (probably a scan) — export it as PNG and upload that instead.");
    setBusy("Structuring with your model…");
    const r = await api("/api/convert-resume", { method: "POST", body: { kind: "text", content: text } });
    return { converted: r.markdown };
  }
  if (name.endsWith(".docx")) {
    setBusy("Reading DOCX…");
    const mammoth = await loadMammoth();
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    setBusy("Structuring with your model…");
    const r = await api("/api/convert-resume", { method: "POST", body: { kind: "text", content: value } });
    return { converted: r.markdown };
  }
  if (/\.(png|jpe?g|webp)$/.test(name)) {
    setBusy("Transcribing image with your vision model… (needs a vision-capable model, e.g. llama3.2-vision)");
    const b64 = btoa(new Uint8Array(await file.arrayBuffer()).reduce((s, b) => s + String.fromCharCode(b), ""));
    const r = await api("/api/convert-resume", { method: "POST", body: { kind: "image", content: b64, mime: file.type || "image/png" } });
    return { converted: r.markdown };
  }
  throw new Error("Unsupported file type — use PDF, DOCX, PNG/JPG, LaTeX (.tex), Markdown or plain text.");
}

stages.resume = async () => {
  const { content } = await api("/api/resume");
  const prof = await api("/api/profile");
  const c = prof.candidate || {};
  view.innerHTML = `
    <div class="stage stage-narrow">
      <div class="page-title">Your resume</div>
      <p class="page-sub">This becomes the single source of truth — every evaluation, answer, and letter is grounded in it and nothing else. Upload any format; you review the conversion before it's saved.</p>
      <div class="card">
        <div class="dropzone" id="rz">
          <div style="font-size:26px">⤓</div>
          <div><b>Drop your resume</b> or click to browse</div>
          <div class="formats">PDF · DOCX · PNG/JPG · LaTeX (.tex) · Markdown · TXT</div>
          <input type="file" id="rz-input" hidden accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.tex,.md,.txt,.markdown">
        </div>
        <div id="rz-status" class="hint" style="margin-top:10px"></div>
        <label class="field">Resume (markdown — edit freely, this is what gets saved)</label>
        <textarea id="cv-text" style="min-height:300px" placeholder="…or just paste your resume text here">${esc(content)}</textarea>
        <div class="row end" style="margin-top:12px">
          <span class="hint" id="cv-note" style="margin-right:auto"></span>
          <button class="btn primary" id="cv-save">Save resume</button>
        </div>
      </div>
      <div class="card">
        <h3>Contact details</h3>
        <p class="hint">Auto-filled from your resume when you save it — correct anything here. Used on generated PDFs and application forms.</p>
        <div class="iv-grid">
          <div><label class="field">Full name</label><input type="text" id="p-full_name" value="${esc(c.full_name || "")}"></div>
          <div><label class="field">Email</label><input type="email" id="p-email" value="${esc(c.email || "")}"></div>
          <div><label class="field">Phone</label><input type="text" id="p-phone" value="${esc(c.phone || "")}"></div>
          <div><label class="field">Location</label><input type="text" id="p-location" value="${esc(c.location || "")}"></div>
          <div><label class="field">LinkedIn</label><input type="text" id="p-linkedin" value="${esc(c.linkedin || "")}"></div>
          <div><label class="field">GitHub / Portfolio</label><input type="text" id="p-github" value="${esc(c.github || "")}"></div>
        </div>
        <div class="row end" style="margin-top:12px"><button class="btn" id="p-save">Save details</button></div>
      </div>
      ${stageNav({ backTo: 1, onNext: true })}
    </div>`;

  const rz = $("#rz");
  rz.addEventListener("click", () => $("#rz-input").click());
  rz.addEventListener("dragover", (e) => { e.preventDefault(); rz.classList.add("drag"); });
  rz.addEventListener("dragleave", () => rz.classList.remove("drag"));
  const handle = async (file) => {
    if (!file) return;
    try {
      const r = await extractFile(file);
      $("#cv-text").value = r.direct ?? r.converted;
      $("#rz-status").innerHTML = r.converted
        ? `<span class="pill warn">Converted by your model — read it over before saving. It was told to transcribe faithfully, but verify every fact.</span>`
        : `<span class="pill ok">Loaded ${esc(file.name)}</span>`;
    } catch (e) {
      $("#rz-status").innerHTML = "";
      toast(e.message, true);
    }
  };
  rz.addEventListener("drop", (e) => { e.preventDefault(); rz.classList.remove("drag"); handle(e.dataTransfer.files[0]); });
  $("#rz-input").addEventListener("change", (e) => handle(e.target.files[0]));

  const CONTACT_KEYS = ["full_name", "email", "phone", "location", "linkedin", "github"];
  const saveContact = async () => {
    const b = {};
    for (const k of CONTACT_KEYS) b[k] = $(`#p-${k}`).value.trim();
    await api("/api/profile", { method: "POST", body: b });
  };
  $("#cv-save").addEventListener("click", async () => {
    try {
      const r = await api("/api/resume", { method: "POST", body: { content: $("#cv-text").value } });
      // Server extracts contact from the resume header — reflect it in the form
      // without clobbering anything the user already typed.
      for (const k of CONTACT_KEYS) {
        const input = $(`#p-${k}`);
        if (!input.value.trim() && r.candidate?.[k]) input.value = r.candidate[k];
      }
      await saveContact();
      $("#cv-note").innerHTML = `<span class="pill ok">saved</span>`;
      toast("Resume and contact details saved");
      state.status = null;
    } catch (e) { toast(e.message, true); }
  });
  $("#p-save").addEventListener("click", async () => {
    try { await saveContact(); toast("Contact details saved"); } catch (e) { toast(e.message, true); }
  });
  wireNav(1, async () => {
    try { await saveContact(); } catch {}
    const s = await loadStatus();
    if (!s.cv) return toast("Save your resume first", true);
    go(3);
  });
};

/* 3 — Interview (the "you" stage — location-aware) */
const PNTS = "Prefer not to say";
const IV_FIELDS = [
  { section: "Location & eligibility" },
  { k: "home_location", label: "Where are you based?", ph: "Type a city — pick from the list", globe: true, place: true },
  { k: "target_locations", label: "Where would you work? (pick as many as you like)", ph: "Type a city or “Remote” — pick to add", globe: true, places: true, wide: true },
  { k: "address_search", label: "Street address — start typing, pick a suggestion", ph: "e.g. 554 Washington Blvd…", wide: true, addr: true },
  { k: "address_line1", label: "Address line 1" },
  { k: "address_city", label: "City" },
  { k: "address_state", label: "State / region" },
  { k: "address_postcode", label: "ZIP / postal code" },
  { k: "address_country", label: "Country" },
  { k: "work_authorization", label: "Where are you authorized to work? (status too)", ph: "e.g. US — F1 CPT; India citizen" },
  { k: "needs_sponsorship", label: "Will you need visa sponsorship now or in future?", type: "select", opts: ["", "No", "Yes", "Depends on country"] },
  { k: "over_18", label: "Are you 18 or older?", type: "select", opts: ["", "Yes", "No"] },
  { section: "Logistics & compensation" },
  { k: "remote_preference", label: "Work style", type: "select", opts: ["", "Remote only", "Remote preferred, hybrid OK", "Hybrid", "Onsite OK", "Anything"] },
  { k: "relocation", label: "Willing to relocate?", type: "select", opts: ["", "Yes", "No", "For the right role"] },
  { k: "salary_expectation", label: "Salary expectation (range + currency)", ph: "e.g. $140–170k" },
  { k: "notice_period", label: "Notice period / start date", ph: "e.g. 2 weeks" },
  { k: "security_clearance", label: "Security clearance (if any)", ph: "e.g. none / Secret" },
  { k: "preferred_name", label: "Preferred name (if different)", ph: "" },
  { section: "Self-identification — optional. Used ONLY to pre-fill the EEO sections you'd fill anyway; “Prefer not to say” is always fine." },
  { k: "gender", label: "Gender", type: "select", opts: ["", PNTS, "Male", "Female", "Non-binary"] },
  { k: "race_ethnicity", label: "Race / ethnicity", type: "select", opts: ["", PNTS, "Asian", "Black or African American", "Hispanic or Latino", "White", "American Indian or Alaska Native", "Native Hawaiian or Other Pacific Islander", "Two or more races"] },
  { k: "veteran_status", label: "Veteran status (US)", type: "select", opts: ["", PNTS, "I am not a protected veteran", "I identify as one or more of the classifications of a protected veteran"] },
  { k: "disability_status", label: "Disability status", type: "select", opts: ["", PNTS, "No, I do not have a disability", "Yes, I have a disability (or previously had one)"] },
  { k: "pronouns", label: "Pronouns", ph: "e.g. he/him" },
  { section: "Your story" },
  { k: "superpower", label: "What sets you apart? Your professional superpower", ph: "The thing colleagues come to you for", wide: true },
  { k: "achievement_story", label: "Your proudest achievement — the story you'd lead with in an interview", ph: "Situation, what you did, the measurable result", wide: true, area: true },
  { k: "why_looking", label: "Why are you looking right now?", ph: "Your honest exit story — we'll phrase it well", wide: true },
  { k: "dealbreakers", label: "Dealbreakers", ph: "e.g. no on-site, no startups under 20 people", wide: true },
];

stages.interview = async () => {
  const { answers } = await api("/api/interview");
  state.interview = answers || {};
  state.chatMsgs ||= [];
  const joinVal = (v) => (Array.isArray(v) ? v.join(", ") : v || "");

  const fieldHtml = (f) => {
    if (f.section) return `<div style="grid-column:1/-1;margin-top:10px"><h3 style="font-size:14.5px">${esc(f.section)}</h3></div>`;
    const val = joinVal(state.interview[f.k]);
    const relative = f.addr || f.place || f.places;
    let control;
    if (f.type === "select") {
      control = `<select id="iv-${f.k}">${f.opts.map((o) => `<option ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    } else if (f.places) {
      control = `<div id="chips-${f.k}" class="loc-chips"></div>
        <input type="text" id="iv-${f.k}" placeholder="${esc(f.ph || "")}" autocomplete="off">
        <div class="addr-suggest" id="sug-${f.k}" hidden></div>`;
    } else if (f.place) {
      control = `<input type="text" id="iv-${f.k}" placeholder="${esc(f.ph || "")}" value="${esc(val)}" autocomplete="off">
        <div class="addr-suggest" id="sug-${f.k}" hidden></div>`;
    } else if (f.area) {
      control = `<textarea id="iv-${f.k}" style="min-height:90px;font-family:var(--sans);font-size:14px" placeholder="${esc(f.ph || "")}">${esc(val)}</textarea>`;
    } else if (f.addr) {
      control = `<input type="text" id="iv-${f.k}" placeholder="${esc(f.ph || "")}" value="" autocomplete="off"><div class="addr-suggest" id="addr-suggest" hidden></div>`;
    } else {
      control = `<input type="text" id="iv-${f.k}" placeholder="${esc(f.ph || "")}" value="${esc(val)}" autocomplete="off">`;
    }
    return `<div style="${f.wide ? "grid-column:1/-1;" : ""}${relative ? "position:relative;" : ""}">
        <label class="field">${esc(f.label)}</label>${control}</div>`;
  };

  view.innerHTML = `
    <div class="stage stage-narrow">
      <div class="page-title">About you</div>
      <p class="page-sub">Application forms ask the same things over and over — authorization, salary, EEO questions, your story. Answer once, here, and every drafted application pulls from it. Talk it through in chat, or fill the form directly — they stay in sync.</p>

      <div class="card">
        <h3>Interview chat</h3>
        <p class="hint">The companion asks what forms for <i>your</i> target roles actually ask — it reads real postings from your scan to know. Every fact you give is saved into the form below.</p>
        <div id="chat-log" class="chat-log">${state.chatMsgs.map((m) => `<div class="msg ${m.role}">${md(esc(m.content))}</div>`).join("") || `<div class="empty">Say hi, or ask “what do you need from me?”</div>`}</div>
        <div class="row" style="margin-top:8px">
          <input type="text" id="chat-in" placeholder="Type a message…" style="flex:1">
          <button class="btn primary" id="chat-send">Send</button>
        </div>
      </div>

      <div class="card">
        <div class="iv-grid">${IV_FIELDS.map(fieldHtml).join("")}</div>
        <div class="row end" style="margin-top:16px">
          <span class="hint" style="margin-right:auto">Saved to your profile — user-layer, survives updates.</span>
          <button class="btn primary" id="iv-save">Save answers</button>
        </div>
      </div>
      ${stageNav({ backTo: 2, onNext: true })}
    </div>`;

  // Target locations = chips, chosen only from real places.
  let targetLocs = Array.isArray(state.interview.target_locations) ? [...state.interview.target_locations] : [];
  const updateGlobe = () => bg().setCities([$("#iv-home_location").value, ...targetLocs].map((x) => x.trim()).filter(Boolean));
  const paintChips = () => {
    $("#chips-target_locations").innerHTML = targetLocs.map((l, i) => `<span class="chip">${esc(l)} <button data-i="${i}">×</button></span>`).join("");
    $$("#chips-target_locations [data-i]").forEach((b) => b.addEventListener("click", () => { targetLocs.splice(+b.dataset.i, 1); paintChips(); updateGlobe(); }));
  };
  paintChips();
  attachPlaces($("#iv-home_location"), $("#sug-home_location"), { onPick: (p) => { updateGlobe(); } });
  attachPlaces($("#iv-target_locations"), $("#sug-target_locations"), {
    chips: true,
    onPick: (p) => { if (!targetLocs.includes(p.label)) { targetLocs.push(p.label); paintChips(); updateGlobe(); } },
  });
  updateGlobe();

  // ── Address autocomplete (keyless geocoder via the local server) ──
  const addrIn = $("#iv-address_search");
  const sug = $("#addr-suggest");
  let addrTimer;
  addrIn.addEventListener("input", () => {
    clearTimeout(addrTimer);
    const q = addrIn.value.trim();
    if (q.length < 3) { sug.hidden = true; return; }
    addrTimer = setTimeout(async () => {
      try {
        const { suggestions } = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
        sug.innerHTML = suggestions.length
          ? suggestions.map((s, i) => `<div class="addr-opt" data-i="${i}">${esc(s.label)}</div>`).join("")
          : `<div class="addr-opt" style="color:var(--faint)">no matches — keep typing or fill manually</div>`;
        sug.hidden = false;
        $$(".addr-opt[data-i]", sug).forEach((el) => el.addEventListener("mousedown", () => {
          const s = suggestions[+el.dataset.i];
          $("#iv-address_line1").value = s.line1;
          $("#iv-address_city").value = s.city;
          $("#iv-address_state").value = s.state;
          $("#iv-address_postcode").value = s.postcode;
          $("#iv-address_country").value = s.country;
          addrIn.value = s.label;
          sug.hidden = true;
          toast("Address components filled — check the ZIP");
        }));
      } catch { sug.hidden = true; }
    }, 350);
  });
  addrIn.addEventListener("blur", () => setTimeout(() => (sug.hidden = true), 250));

  const collect = () => {
    const a = {};
    for (const f of IV_FIELDS) {
      if (f.section || f.addr || f.places) continue;
      a[f.k] = $(`#iv-${f.k}`).value.trim();
    }
    a.target_locations = targetLocs;
    return a;
  };
  const refreshFromSaved = async () => {
    const { answers: a2 } = await api("/api/interview");
    state.interview = a2 || {};
    for (const f of IV_FIELDS) {
      if (f.section || f.addr || f.places) continue;
      const el = $(`#iv-${f.k}`);
      const v = joinVal(state.interview[f.k]);
      if (v && el.value !== v) el.value = v;
    }
    if (Array.isArray(state.interview.target_locations)) { targetLocs = [...state.interview.target_locations]; paintChips(); }
    updateGlobe();
  };

  // ── Chat ──
  const sendChat = async () => {
    const text = $("#chat-in").value.trim();
    if (!text) return;
    $("#chat-in").value = "";
    state.chatMsgs.push({ role: "user", content: text });
    const log = $("#chat-log");
    log.innerHTML = state.chatMsgs.map((m) => `<div class="msg ${m.role}">${md(esc(m.content))}</div>`).join("") + `<div class="msg assistant">${spin}</div>`;
    log.scrollTop = log.scrollHeight;
    try {
      const r = await api("/api/interview-chat", { method: "POST", body: { messages: state.chatMsgs } });
      state.chatMsgs.push({ role: "assistant", content: r.reply });
      log.innerHTML = state.chatMsgs.map((m) => `<div class="msg ${m.role}">${md(esc(m.content))}</div>`).join("");
      log.scrollTop = log.scrollHeight;
      if (r.saved?.length) { await refreshFromSaved(); toast(`Saved: ${r.saved.join(", ")}`); }
    } catch (e) {
      state.chatMsgs.pop();
      toast(e.message, true);
      log.innerHTML = state.chatMsgs.map((m) => `<div class="msg ${m.role}">${md(esc(m.content))}</div>`).join("");
    }
  };
  $("#chat-send").addEventListener("click", sendChat);
  $("#chat-in").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

  $("#iv-save").addEventListener("click", async () => {
    try {
      await api("/api/interview", { method: "POST", body: { answers: collect() } });
      toast("Saved — the scanner and form-fill now know all of this");
    } catch (e) { toast(e.message, true); }
  });
  wireNav(2, async () => {
    try { await api("/api/interview", { method: "POST", body: { answers: collect() } }); } catch {}
    go(4);
  });
};

/* 4 — Roles */
stages.roles = async () => {
  const cat = await loadCatalog();
  view.innerHTML = `
    <div class="stage stage-narrow">
      <div class="page-title">Target roles</div>
      <p class="page-sub">Search ${cat.roles.length.toLocaleString()} roles across ${Object.keys(cat.categories).length} fields. Your picks seed the scanner's keywords and decide which application questions you'll prep for.</p>
      <div class="card">
        <div id="sel-chips"></div>
        <input type="text" id="role-q" placeholder="Try “machine learning”, “product designer”, “devops”…" style="margin-top:10px">
        <div class="role-results" id="role-results"></div>
      </div>
      ${stageNav({ backTo: 3, onNext: true, nextLabel: "Save & continue →" })}
    </div>`;

  const chips = () => {
    $("#sel-chips").innerHTML = state.selectedRoles.length
      ? state.selectedRoles.map((r) => `<span class="chip">${esc(r)} <button data-rm="${esc(r)}">×</button></span>`).join("")
      : `<span class="hint">Nothing selected — search below, click to add.</span>`;
    $$("#sel-chips [data-rm]").forEach((b) => b.addEventListener("click", () => {
      state.selectedRoles = state.selectedRoles.filter((r) => r !== b.dataset.rm);
      chips(); search();
    }));
  };
  const search = () => {
    const q = $("#role-q").value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = (q
      ? cat.roles.filter((r) => terms.every((t) => r.t.toLowerCase().includes(t) || cat.categories[r.c].label.toLowerCase().includes(t)))
      : cat.roles.filter((r) => state.selectedRoles.includes(r.t))).slice(0, 60);
    $("#role-results").innerHTML = matches.length
      ? matches.map((r) => `<div class="role-line ${state.selectedRoles.includes(r.t) ? "sel" : ""}" data-t="${esc(r.t)}"><span>${esc(r.t)}</span><span class="cat">${esc(cat.categories[r.c].label)}</span></div>`).join("")
      : `<div class="empty">${q ? "No matches" : "Type to search"}</div>`;
    $$("#role-results .role-line").forEach((el) => el.addEventListener("click", () => {
      const t = el.dataset.t;
      state.selectedRoles = state.selectedRoles.includes(t) ? state.selectedRoles.filter((r) => r !== t) : [...state.selectedRoles, t];
      chips(); search();
    }));
  };
  $("#role-q").addEventListener("input", search);
  chips(); search();
  wireNav(3, async () => {
    if (!state.selectedRoles.length) return toast("Pick at least one role", true);
    try {
      const r = await api("/api/roles", { method: "POST", body: { roles: state.selectedRoles } });
      toast(`Scanner seeded with ${r.keywords.length} keywords`);
      state.status = null;
      go(5);
    } catch (e) { toast(e.message, true); }
  });
};

/* 5 — Scan / Discover */
stages.scan = async () => {
  const s = await loadStatus();
  const boards = await api("/api/boards");
  const chosen = { boards: new Set(boards.enabledBoards), companies: new Set(boards.enabledCompanies) };
  let boardFilter = "";
  view.innerHTML = `
    <div class="stage stage-narrow">
      <div class="page-title">Discover openings</div>
      <p class="page-sub">Pick which boards and companies to scan, then Studio queries their public APIs directly with your role keywords and locations — no AI tokens, nothing sent anywhere. Precise keywords (from your target roles) keep false positives down.</p>

      <div class="card">
        <div class="row"><h3 style="margin-right:auto">Remote & aggregator boards</h3><span class="hint" id="board-count"></span></div>
        <div class="board-grid" id="remote-boards">
          ${boards.remoteBoards.map((b) => `
            <label class="board-opt"><input type="checkbox" data-board="${esc(b.id)}" ${chosen.boards.has(b.id) ? "checked" : ""}>
            <span><b>${esc(b.name)}</b><br><span class="hint">${esc(b.desc)}</span></span></label>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="row"><h3 style="margin-right:auto">Direct company career sites</h3>
          <button class="btn small" id="co-all">Select all</button><button class="btn small" id="co-none">Clear</button></div>
        <input type="text" id="co-filter" placeholder="Filter ${boards.companies.length} companies — name or tag (ai, fintech, remote…)" style="margin-bottom:8px">
        <div class="board-grid" id="company-list"></div>
        ${boards.otherEnabledCompanies?.length ? `<p class="hint" style="margin-top:8px">Plus ${boards.otherEnabledCompanies.length} companies already in your portals.yml (kept as-is).</p>` : ""}
        <details style="margin-top:12px"><summary class="hint" style="cursor:pointer">+ Add a company not in the list</summary>
          <div class="row" style="margin-top:8px">
            <input type="text" id="add-url" placeholder="Paste a Greenhouse / Lever / Ashby careers URL" style="flex:2;min-width:220px">
            <input type="text" id="add-name" placeholder="Display name (optional)" style="flex:1;min-width:120px">
            <button class="btn" id="add-co-btn">Add & include</button>
          </div>
          <p class="hint" style="margin-top:6px">e.g. <code>https://job-boards.greenhouse.io/yourcompany</code> — Studio detects the ATS, verifies it responds, and adds it to your scan.</p>
        </details>
      </div>

      <div class="card">
        <div class="row"><h3 style="margin-right:auto">${s.pipeline} in your inbox</h3>
          <button class="btn" id="save-boards">Save selection</button>
          <button class="btn primary" id="scan-btn">Scan now</button></div>
        <div id="scan-out" style="margin-top:12px"></div>
      </div>

      <div class="card">
        <div class="row"><h3 style="margin-right:auto">Background evaluation</h3>
          <span class="hint" id="bg-status"></span></div>
        <p class="hint">Let Studio evaluate your inbox in the background and auto-prepare everything (tailored PDF + cover letter) for strong matches — so when you sit down, high-fit jobs are ready.</p>
        <div class="row">
          <label class="hint" style="margin:0">Auto-prepare at ≥ <select id="bg-threshold" style="width:auto;padding:4px 8px"><option>4</option><option>4.5</option><option>3.5</option></select> /5</label>
          <label class="hint" style="margin:0">Up to <input type="number" id="bg-limit" value="15" min="1" max="100" style="width:70px;padding:4px 8px"> jobs</label>
          <button class="btn primary" id="bg-start">Start</button>
          <button class="btn" id="bg-stop">Stop</button>
        </div>
        <div id="bg-progress" style="margin-top:10px"></div>
      </div>

      <div class="card">
        <div class="row"><h3 style="margin-right:auto">Daily refresh</h3><span class="hint" id="sched-next"></span></div>
        <p class="hint">Keep your inventory current — Studio re-scans your boards automatically every day at a set time. (Runs while Studio is open; for always-on, install the Mac agent below.)</p>
        <div class="row">
          <label class="hint" style="margin:0"><input type="checkbox" id="sched-on" style="width:auto"> Auto-scan daily at
            <select id="sched-hour" style="width:auto;padding:4px 8px">${Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, "0")}:00</option>`).join("")}</select></label>
          <label class="hint" style="margin:0"><input type="checkbox" id="sched-eval" style="width:auto"> then evaluate new jobs</label>
          <button class="btn" id="sched-save">Save</button>
          <button class="btn" id="sched-now">Run now</button>
        </div>
        <div class="note" style="margin-top:10px"><b>Always-on (macOS):</b> to update daily even when Studio isn't open, run <code>bash studio/mac/install.sh</code> once — it installs a launchd agent that keeps Studio running and lets the daily refresh fire on schedule. Remove with <code>--remove</code>.</div>
        <div id="sched-out"></div>
      </div>

      ${stageNav({ backTo: 4, onNext: true, nextLabel: "To the applications →" })}
    </div>`;

  // company list (filterable)
  const renderCompanies = () => {
    const f = boardFilter.toLowerCase();
    const list = boards.companies.filter((c) => !f || c.name.toLowerCase().includes(f) || (c.tags || []).some((t) => t.includes(f)) || c.provider.includes(f));
    $("#company-list").innerHTML = list.map((c) => `
      <label class="board-opt"><input type="checkbox" data-company="${esc(c.name)}" ${chosen.companies.has(c.name) ? "checked" : ""}>
      <span><b>${esc(c.name)}</b> <span class="pill off">${esc(c.provider)}</span><br><span class="hint">${esc((c.tags || []).join(", "))}</span></span></label>`).join("") || `<div class="empty">no matches</div>`;
    $$("#company-list [data-company]").forEach((cb) => cb.addEventListener("change", () => cb.checked ? chosen.companies.add(cb.dataset.company) : chosen.companies.delete(cb.dataset.company)));
    updateCount();
  };
  const updateCount = () => { $("#board-count").textContent = `${chosen.boards.size} boards · ${chosen.companies.size} companies`; };
  $("#co-filter").addEventListener("input", (e) => { boardFilter = e.target.value; renderCompanies(); });
  $("#co-all").addEventListener("click", () => { boards.companies.forEach((c) => chosen.companies.add(c.name)); renderCompanies(); });
  $("#co-none").addEventListener("click", () => { chosen.companies.clear(); renderCompanies(); });
  $$("#remote-boards [data-board]").forEach((cb) => cb.addEventListener("change", () => { cb.checked ? chosen.boards.add(cb.dataset.board) : chosen.boards.delete(cb.dataset.board); updateCount(); }));
  renderCompanies();

  const saveBoards = async () => {
    await api("/api/boards", { method: "POST", body: { boards: [...chosen.boards], companies: [...chosen.companies] } });
    toast(`Saved ${chosen.boards.size} boards + ${chosen.companies.size} companies`);
  };
  $("#save-boards").addEventListener("click", saveBoards);
  $("#scan-btn").addEventListener("click", async () => {
    await saveBoards();
    $("#scan-btn").disabled = true;
    $("#scan-out").innerHTML = `<div class="empty">${spin} Scanning selected boards… a couple of minutes.</div>`;
    try {
      const r = await api("/api/scan", { method: "POST", body: {} });
      $("#scan-out").innerHTML = `<pre class="log">${esc(r.output)}</pre>`;
      toast(`${r.pipeline.length} posting(s) in inbox`);
      state.status = null;
    } catch (e) { $("#scan-out").innerHTML = ""; toast(e.message, true); }
    $("#scan-btn").disabled = false;
  });

  // background eval controls + polling
  let bgTimer;
  const renderBg = (st) => {
    $("#bg-status").textContent = st.running ? `running — ${st.done}/${st.total}` : st.error ? `error: ${st.error}` : st.done ? `done — ${st.prepared} prepared` : "";
    $("#bg-progress").innerHTML = (st.running || st.log?.length)
      ? `${st.running ? `<div class="hint">${spin} ${esc(st.current || "…")}</div>` : ""}
         ${st.log?.length ? `<pre class="log">${esc(st.log.join("\n"))}</pre>` : ""}` : "";
  };
  const poll = async () => { try { const { state: st } = await api("/api/background"); renderBg(st); if (!st.running) { clearInterval(bgTimer); bgTimer = null; state.status = null; } } catch {} };
  api("/api/background").then(({ state: st }) => { renderBg(st); if (st.running && !bgTimer) bgTimer = setInterval(poll, 4000); });
  $("#bg-start").addEventListener("click", async () => {
    try {
      const { state: st } = await api("/api/background", { method: "POST", body: { action: "start", threshold: parseFloat($("#bg-threshold").value), limit: parseInt($("#bg-limit").value) } });
      renderBg(st); toast("Background evaluation started"); if (!bgTimer) bgTimer = setInterval(poll, 4000);
    } catch (e) { toast(e.message, true); }
  });
  $("#bg-stop").addEventListener("click", async () => { const { state: st } = await api("/api/background", { method: "POST", body: { action: "stop" } }); renderBg(st); toast("Stopping after the current job…"); });

  // manual add company
  $("#add-co-btn").addEventListener("click", async () => {
    const url = $("#add-url").value.trim();
    if (!url) return toast("Paste a careers URL", true);
    $("#add-co-btn").disabled = true;
    try {
      const r = await api("/api/add-company", { method: "POST", body: { url, name: $("#add-name").value.trim() } });
      chosen.companies.add(r.name);
      boards.companies.push({ name: r.name, provider: r.provider, slug: r.slug, tags: ["added"] });
      boards.companies.sort((a, b) => a.name.localeCompare(b.name));
      $("#add-url").value = ""; $("#add-name").value = "";
      renderCompanies();
      toast(`Added ${r.name} (${r.provider}) — included in your scan`);
    } catch (e) { toast(e.message, true); }
    $("#add-co-btn").disabled = false;
  });

  // daily refresh schedule
  const renderSched = (sc) => {
    $("#sched-on").checked = sc.enabled;
    $("#sched-hour").value = sc.hour;
    $("#sched-eval").checked = sc.autoEval;
    $("#sched-next").textContent = sc.enabled && sc.nextRun ? `next: ${new Date(sc.nextRun).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "off";
    if (sc.lastResult) $("#sched-out").innerHTML = `<p class="hint" style="margin-top:8px">Last run: ${esc(sc.lastResult)}</p>`;
  };
  api("/api/schedule").then(({ schedule }) => renderSched(schedule));
  $("#sched-save").addEventListener("click", async () => {
    const { schedule } = await api("/api/schedule", { method: "POST", body: { enabled: $("#sched-on").checked, hour: parseInt($("#sched-hour").value), autoEval: $("#sched-eval").checked } });
    renderSched(schedule);
    toast(schedule.enabled ? `Daily refresh at ${String(schedule.hour).padStart(2, "0")}:00` : "Daily refresh off");
  });
  $("#sched-now").addEventListener("click", async () => {
    $("#sched-out").innerHTML = `<div class="empty">${spin} Refreshing now…</div>`;
    try { const r = await api("/api/schedule-run", { method: "POST", body: {} }); $("#sched-out").innerHTML = `<pre class="log">${esc(r.output)}</pre>`; state.status = null; }
    catch (e) { $("#sched-out").innerHTML = ""; toast(e.message, true); }
  });

  wireNav(4, () => go(6));
};

/* 6 — Apply board (LinkedIn-style rail + workspace) */
async function loadJobs() {
  const [{ items }, { rows }] = await Promise.all([api("/api/pipeline"), api("/api/tracker")]);
  const tracked = rows.map((r) => ({
    id: `t-${r.num}`, title: `${r.role} — ${r.company}`, company: r.company, role: r.role,
    url: null, status: r.status, score: r.score, report: (r.report.match(/\(([^)]+)\)/) || [])[1] || null,
  }));
  const inbox = items.map((i, n) => ({ id: `p-${n}`, title: i.title, url: i.url, company: i.company || guessCompany(i), role: i.title, location: i.location || "", status: "Inbox" }));
  state.jobs = [...tracked.filter((t) => !["SKIP", "Discarded", "Rejected"].includes(t.status)), ...inbox];
  if (!state.activeJob || !state.jobs.find((j) => j.id === state.activeJob)) state.activeJob = state.jobs[0]?.id || null;
}
function guessCompany(item) {
  const m = item.url?.match(/(?:greenhouse\.io|lever\.co|ashbyhq\.com)\/([^/?]+)/);
  return m ? m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : (item.title.split(/[—–|@]/)[1] || "").trim();
}
let railFilter = "";
const railState = { loc: "", role: "", tab: "inbox", sort: "default" };
let currentCvCache = null;
const wsFor = (id) => (state.ws[id] ||= { jd: "", tab: "evaluate", company: "", role: "", report: null, reportPath: null, score: null, advice: null, answers: null, letter: null });

stages.board = async () => {
  await Promise.all([loadJobs(), loadCatalog()]);
  view.innerHTML = `
    <div class="stage">
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="page-title">Applications</div>
          <p class="page-sub">The posting loads by itself when you pick a job — evaluate, generate the tailored PDF, draft answers, apply, next. On the form itself, the <b>browser extension</b> fills the fields from here.</p>
        </div>
        <button class="btn" id="to-track">Applied jobs →</button>
      </div>
      <div class="board">
        <aside class="job-rail" id="rail"></aside>
        <section class="workspace" id="ws"></section>
      </div>
    </div>`;
  $("#to-track").addEventListener("click", () => go(7));
  renderRail6();
  renderWorkspace();
};

function roleWords(role) {
  return role.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !/^(senior|junior|staff|principal|lead|associate)$/.test(w));
}

function topLocations(jobs) {
  const counts = {};
  for (const j of jobs) {
    const loc = (j.location || "").trim();
    if (loc) counts[loc] = (counts[loc] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 18);
}

function renderRail6() {
  const rail = $("#rail");
  const CAP = 100;
  const terms = railFilter.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (j) => {
    if (terms.length && !terms.every((t) => `${j.title} ${j.company} ${j.location || ""}`.toLowerCase().includes(t))) return false;
    if (railState.loc) {
      const l = (j.location || "").toLowerCase();
      if (railState.loc === "__remote" ? !/remote/i.test(`${j.location} ${j.title}`) : l !== railState.loc.toLowerCase()) return false;
    }
    if (railState.role && !roleWords(railState.role).every((w) => j.title.toLowerCase().includes(w))) return false;
    return true;
  };
  const byTab = {
    inbox: (j) => j.status === "Inbox",
    progress: (j) => j.status !== "Inbox" && !["Applied", "Responded", "Interview", "Offer"].includes(j.status),
    applied: (j) => ["Applied", "Responded", "Interview", "Offer"].includes(j.status),
    all: () => true,
  };
  let list = state.jobs.filter((j) => match(j) && byTab[railState.tab](j));
  if (railState.sort === "company") list = [...list].sort((a, b) => (a.company || "").localeCompare(b.company || ""));
  if (railState.sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  if (railState.sort === "score") list = [...list].sort((a, b) => (parseFloat(b.score) || 0) - (parseFloat(a.score) || 0));
  const total = list.length;
  list = list.slice(0, CAP);

  const counts = {
    inbox: state.jobs.filter(byTab.inbox).length,
    progress: state.jobs.filter(byTab.progress).length,
    applied: state.jobs.filter(byTab.applied).length,
  };
  const card = (j) => `
    <div class="job-card ${state.activeJob === j.id ? "active" : ""}" data-id="${j.id}">
      <div class="jc-title">${esc(j.title)}</div>
      <div class="jc-meta">
        ${j.status !== "Inbox" ? `<span class="pill ${["Applied", "Interview", "Offer"].includes(j.status) ? "ok" : "off"}">${esc(j.status)}</span>` : ""}
        ${j.score && j.score !== "-" ? `<span>${esc(j.score)}</span>` : ""}
        ${j.company ? `<span>${esc(j.company)}</span>` : ""}
        ${j.location ? `<span>· ${esc(j.location.slice(0, 26))}</span>` : ""}
      </div>
    </div>`;

  rail.innerHTML = `
    <div class="ws-tabs" style="margin:0 0 8px">
      ${[["inbox", `Inbox ${counts.inbox.toLocaleString()}`], ["progress", `Evaluated ${counts.progress}`], ["applied", `Applied ${counts.applied}`], ["all", "All"]]
        .map(([id, l]) => `<button class="ws-tab ${railState.tab === id ? "active" : ""}" data-rtab="${id}">${l}</button>`).join("")}
    </div>
    <input type="text" id="rail-q" placeholder="Search title, company…" value="${esc(railFilter)}" style="margin-bottom:6px">
    <div class="row" style="gap:6px;margin-bottom:8px">
      <select id="rail-loc" style="flex:1;font-size:12.5px;padding:6px 8px">
        <option value="">All locations</option>
        <option value="__remote" ${railState.loc === "__remote" ? "selected" : ""}>Remote</option>
        ${topLocations(state.jobs).map(([l, n]) => `<option value="${esc(l)}" ${railState.loc === l ? "selected" : ""}>${esc(l.slice(0, 28))} (${n})</option>`).join("")}
      </select>
      <select id="rail-role" style="flex:1;font-size:12.5px;padding:6px 8px">
        <option value="">All my roles</option>
        ${state.selectedRoles.map((r) => `<option ${railState.role === r ? "selected" : ""}>${esc(r)}</option>`).join("")}
      </select>
      <select id="rail-sort" style="font-size:12.5px;padding:6px 8px">
        ${[["default", "Sort"], ["company", "Company A–Z"], ["title", "Title A–Z"], ["score", "Score"]]
          .map(([v, l]) => `<option value="${v}" ${railState.sort === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
    <div class="rail-head">${total.toLocaleString()} match${total === 1 ? "" : "es"}${total > CAP ? ` · showing ${CAP}` : ""}</div>
    ${list.map(card).join("") || `<div class="empty">Nothing here — adjust the filters or run a scan.</div>`}
    <button class="btn small" id="add-job" style="width:100%;justify-content:center;margin-top:6px">+ Add a job manually</button>`;

  $$("#rail [data-rtab]").forEach((b) => b.addEventListener("click", () => { railState.tab = b.dataset.rtab; renderRail6(); }));
  const q = $("#rail-q");
  q.addEventListener("input", () => { railFilter = q.value; const pos = q.selectionStart; renderRail6(); const nq = $("#rail-q"); nq.focus(); nq.setSelectionRange(pos, pos); });
  $("#rail-loc").addEventListener("change", (e) => { railState.loc = e.target.value; renderRail6(); });
  $("#rail-role").addEventListener("change", (e) => { railState.role = e.target.value; renderRail6(); });
  $("#rail-sort").addEventListener("change", (e) => { railState.sort = e.target.value; renderRail6(); });
  $$("#rail .job-card").forEach((c) => c.addEventListener("click", () => { state.activeJob = c.dataset.id; renderRail6(); renderWorkspace(); }));
  $("#add-job").addEventListener("click", () => {
    const id = `m-${Date.now()}`;
    state.jobs.unshift({ id, title: "New application", url: null, company: "", role: "", status: "Inbox" });
    state.activeJob = id;
    railState.tab = "inbox";
    renderRail6(); renderWorkspace();
  });
}

function scoreOf(report) { return report ? parseFloat((report.match(/(\d(?:\.\d)?)\s*\/\s*5/) || [])[1]) || null : null; }

// The posting, as close to the original as we can get it — fetched from the
// ATS API (rich HTML) or page text, with manual paste only as a last resort.
function jdBlock(job, w) {
  if (!job.url && !w.jd) {
    return `<label class="field">Job description</label>
      <textarea id="w-jd" style="min-height:120px" placeholder="No posting URL for this one — paste the JD text">${esc(w.jd)}</textarea>`;
  }
  if (w.jdStatus === "loading") {
    return `<div class="posting"><div class="empty"><span class="spinner"></span> Retrieving the posting…</div></div>`;
  }
  if (w.jdStatus === "failed" && !w.jd) {
    return `<div class="note">Couldn't fetch this posting automatically (${esc(w.jdErr || "")}). <button class="btn small" id="jd-retry">Retry</button></div>
      <label class="field">Job description</label>
      <textarea id="w-jd" style="min-height:120px" placeholder="Paste the JD text here">${esc(w.jd)}</textarea>`;
  }
  const body = w.jdHtml
    ? `<div class="posting-body prose">${w.jdHtml}</div>`
    : `<div class="posting-body" style="white-space:pre-wrap">${esc(w.jd)}</div>`;
  return `
    <div class="posting">
      <div class="row" style="margin-bottom:6px">
        <span class="pill ok" style="margin-right:auto">${esc(w.jdSource === "page-text" ? "retrieved from page" : "live from " + (w.jdSource || "posting").replace("-api", ""))}</span>
        ${w.location ? `<span class="pill off">${esc(w.location)}</span>` : ""}
        <button class="btn small" id="jd-retry">↻</button>
      </div>
      ${body}
    </div>
    <details style="margin-top:8px"><summary class="hint" style="cursor:pointer">Edit JD text (what the AI reads)</summary>
      <textarea id="w-jd" style="min-height:120px;margin-top:6px">${esc(w.jd)}</textarea>
    </details>`;
}

function renderWorkspace() {
  const wsEl = $("#ws");
  const job = state.jobs.find((j) => j.id === state.activeJob);
  if (!job) { wsEl.innerHTML = `<div class="card"><div class="empty">Select a job — or scan for some.</div></div>`; return; }
  const w = wsFor(job.id);
  w.company ||= job.company || ""; w.role ||= job.role || "";
  const score = w.score ?? (job.score ? parseFloat(job.score) : null);

  // Restore any previously-produced artifacts for this posting (once).
  if (!w.restored) {
    w.restored = true;
    const qs = new URLSearchParams({ url: job.url || "", company: w.company, role: w.role });
    api(`/api/job-state?${qs}`).then(({ state: s }) => {
      if (!s) return;
      for (const k of ["report", "reportPath", "score", "market", "marketSources", "pdf", "tailorSummary", "letter"]) if (s[k] != null && w[k] == null) w[k] = s[k];
      if (state.activeJob === job.id) renderWorkspace();
    }).catch(() => {});
  }

  // Auto-retrieve the posting — the user should never have to paste a JD.
  if (job.url && w.jdStatus === undefined) {
    w.jdStatus = "loading";
    api("/api/fetch-jd", { method: "POST", body: { url: job.url } })
      .then((r) => {
        w.jdStatus = "ok";
        w.jd = w.jd || r.text;
        w.jdHtml = r.html;
        w.jdSource = r.source;
        if (!w.company && r.company) w.company = r.company.replace(/\b\w/g, (c) => c.toUpperCase());
        if ((!w.role || w.role === job.title) && r.title) w.role = r.title;
        w.location = r.location || job.location || "";
        if (state.activeJob === job.id) renderWorkspace();
      })
      .catch((e) => {
        w.jdStatus = "failed";
        w.jdErr = e.message;
        if (state.activeJob === job.id) renderWorkspace();
      });
  }

  const st = w.step || "idle"; // idle → evaluating → marketing → tailoring → covering → done
  const running = w.running;
  const doneStep = { evaluating: !!w.report, marketing: !!w.market, tailoring: !!w.pdf, covering: !!w.letter };
  const stepLabel = { evaluating: "Evaluating fit (A–G)", marketing: "Reading the current market", tailoring: "Tailoring your résumé → PDF", covering: "Drafting the cover letter" };

  wsEl.innerHTML = `
    <div class="card">
      <div class="row">
        <div style="flex:1;min-width:0">
          <h3 style="margin-bottom:2px">${esc(job.title)}</h3>
          ${job.url ? `<a href="${esc(job.url)}" target="_blank" style="font-size:12.5px">open posting ↗</a>` : ""}
        </div>
        ${score ? `<span class="score-badge ${score >= 4 ? "hi" : "lo"}">${score}/5</span>` : ""}
        <button class="btn small" id="mark-skip">Skip</button>
        <button class="btn small primary" id="mark-applied">I applied ✓</button>
      </div>
      <div class="iv-grid" style="margin-top:8px">
        <div><label class="field">Company</label><input type="text" id="w-company" value="${esc(w.company)}"></div>
        <div><label class="field">Role title</label><input type="text" id="w-role" value="${esc(w.role)}" placeholder="e.g. ${esc(state.selectedRoles[0] || "Machine Learning Engineer")}"></div>
      </div>
      ${jdBlock(job, w)}
      ${!running && !w.report ? `<div class="row" style="margin-top:12px"><button class="btn primary" id="run-pipe">✦ Prepare this application</button><span class="hint" style="margin:0">Evaluates fit, reads the market, tailors your résumé, drafts a cover letter — one pass. A few minutes on local models.</span></div>` : ""}
      ${running || w.report ? pipelineStepper(w, doneStep, stepLabel) : ""}
    </div>
    ${score !== null && score < 4 ? `<div class="note ethics"><b>Below the bar.</b> career-ops recommends against applying under 4/5 — your time and the recruiter's are worth more. Skip unless you have a specific reason.</div>` : ""}
    <div id="pipe-sections"></div>`;

  $("#w-company").addEventListener("input", (e) => (w.company = e.target.value));
  $("#w-role").addEventListener("input", (e) => (w.role = e.target.value));
  $("#w-jd")?.addEventListener("input", (e) => (w.jd = e.target.value));
  $("#jd-retry")?.addEventListener("click", () => { w.jdStatus = undefined; renderWorkspace(); });
  $("#mark-applied").addEventListener("click", () => trackJob(job, w, "Applied"));
  $("#mark-skip").addEventListener("click", () => trackJob(job, w, "SKIP"));
  $("#run-pipe")?.addEventListener("click", () => runPipeline(job, w));

  renderPipeSections(job, w);
}

function pipelineStepper(w, done, labels) {
  const order = ["evaluating", "marketing", "tailoring", "covering"];
  return `<div class="stepper">${order.map((s) => {
    const isDone = done[s], isNow = w.running && w.step === s;
    return `<div class="step ${isDone ? "done" : ""} ${isNow ? "now" : ""}">
      <span class="dot">${isDone ? "✓" : isNow ? "●" : "○"}</span>${esc(labels[s])}${isNow ? ` ${spin}` : ""}</div>`;
  }).join("")}</div>`;
}

// The auto-pipeline: JD → evaluate → market → tailor (with eval+market as
// context) → cover letter. Each artifact persists to the backend job store so
// reopening the job restores everything.
async function runPipeline(job, w) {
  if (w.running) return;
  if ((w.jd || "").trim().length < 80) return toast("The job description hasn't loaded yet", true);
  if (!w.company || !w.role) return toast("Fill in company and role first", true);
  w.running = true;
  const persist = (patch) => api("/api/job-state", { method: "POST", body: { url: job.url, company: w.company, role: w.role, patch } }).catch(() => {});
  api("/api/telemetry", { method: "POST", body: { event: "pipeline_start", data: { company: w.company } } }).catch(() => {});
  try {
    if (!w.report) {
      w.step = "evaluating"; renderWorkspace();
      const r = await api("/api/evaluate", { method: "POST", body: { jd: w.jd } });
      w.report = r.report; w.reportPath = r.reportPath; w.score = scoreOf(r.report);
      await api("/api/track", { method: "POST", body: { company: w.company, role: w.role, status: "Evaluated", score: w.score, reportPath: w.reportPath, note: "via Studio" } }).catch(() => {});
      await persist({ report: w.report, reportPath: w.reportPath, score: w.score });
      renderPipeSections(job, w);
    }
    if (!w.market) {
      w.step = "marketing"; renderWorkspace();
      const r = await api("/api/market-trends", { method: "POST", body: { role: w.role, jd: w.jd } });
      w.market = r.summary; w.marketSources = r.sources;
      await persist({ market: w.market, marketSources: w.marketSources });
      renderPipeSections(job, w);
    }
    if (!w.pdf) {
      w.step = "tailoring"; renderWorkspace();
      // eval + market flow in as tailoring context
      const context = [w.report ? `FIT ANALYSIS:\n${w.report}` : "", w.market ? `MARKET:\n${w.market}` : ""].filter(Boolean).join("\n\n");
      const r = await api("/api/tailored-pdf", { method: "POST", body: { jd: w.jd, company: w.company, role: w.role, context } });
      w.pdf = r.pdf; w.tailorSummary = r.summary;
      await persist({ pdf: w.pdf, tailorSummary: w.tailorSummary });
      renderPipeSections(job, w);
    }
    if (!w.letter) {
      w.step = "covering"; renderWorkspace();
      const r = await api("/api/cover-letter", { method: "POST", body: { jd: w.jd, company: w.company, role: w.role } });
      w.letter = r.letter;
      await persist({ letter: w.letter });
    }
    w.step = "done";
    toast("Application prepared — review each part below");
  } catch (e) { toast(e.message, true); }
  w.running = false;
  renderWorkspace();
}

// The linear result sections (no tabs): Fit → Tailored résumé (+ inline
// collapsible improve chat) → Cover letter → Application answers.
function renderPipeSections(job, w) {
  const host = $("#pipe-sections");
  if (!host) return;
  const sections = [];

  if (w.report) sections.push(`
    <div class="card"><div class="row"><h3 style="margin-right:auto">Fit ${w.score ? `· ${w.score}/5` : ""}</h3>
      <button class="btn small" data-act="re-eval">Re-run</button></div>
      <details><summary class="hint" style="cursor:pointer">Full A–G report</summary><div class="prose">${md(w.report)}</div></details></div>`);

  if (w.market) sections.push(`
    <div class="card"><div class="row"><h3 style="margin-right:auto">Market intel</h3>
      <button class="btn small" data-act="re-market">Refresh</button></div>
      <details><summary class="hint" style="cursor:pointer">What this role needs right now${w.marketSources?.length ? ` · sources ${w.marketSources.map((s, i) => `<a href="${esc(s.url)}" target="_blank">[${i + 1}]</a>`).join(" ")}` : ""}</summary><div class="prose">${md(w.market)}</div></details></div>`);

  if (w.pdf) {
    w.improveMsgs ||= [];
    sections.push(`
      <div class="card">
        <div class="row"><h3 style="margin-right:auto">Tailored résumé</h3>
          <a class="btn small" href="/api/pdf-file?f=${encodeURIComponent(w.pdf)}">Download PDF</a>
          <button class="btn small" data-act="re-tailor">Regenerate</button>
          <button class="btn small" data-act="toggle-improve">${w.improveOpen ? "Close improve chat ✕" : "Improve ✎"}</button>
        </div>
        <p class="hint">Reordered & rephrased for this JD using the fit + market analysis above — same facts, ATS-clean. Saved to <code>output/${esc(w.pdf)}</code>.</p>
        <div class="improve-split ${w.improveOpen ? "open" : ""}">
          <div class="improve-preview">
            <div class="row" style="margin-bottom:6px"><b style="margin-right:auto;font-size:12.5px">Résumé preview</b>
              ${w.improveDraft ? `<button class="btn small primary" data-act="imp-accept">Save to cv.md</button>` : ""}</div>
            <div class="preview-body prose" id="imp-body">${md(w.improveDraft || currentCvCache || "Loading…")}</div>
          </div>
          <div class="improve-chat">
            <div class="chat-log" id="imp-log">${w.improveMsgs.map((m) => `<div class="msg ${m.role}">${md(m.content)}</div>`).join("") || `<div class="empty" style="padding:12px">Ask me to sharpen bullets or align wording — I'll show the new résumé on the left. Same facts, better told.</div>`}</div>
            <div class="row" style="margin-top:8px"><input type="text" id="imp-in" placeholder="e.g. lead the summary with GenAI"><button class="btn primary" data-act="imp-send">Send</button></div>
          </div>
        </div>
      </div>`);
  }

  if (w.letter) sections.push(`
    <div class="card"><div class="row"><h3 style="margin-right:auto">Cover letter</h3>
      <button class="btn small" data-act="cl-copy">Copy</button>
      <button class="btn small" data-act="cl-dl">Download</button>
      <button class="btn small" data-act="re-letter">Rewrite</button></div>
      <div class="prose">${md(w.letter)}</div></div>`);

  // Application answers stay available as a collapsible section
  if (w.report || w.pdf) {
    const qs = questionsForRole(w.role);
    sections.push(`
      <div class="card"><div class="row"><h3 style="margin-right:auto">Application answers</h3>
        <button class="btn small primary" data-act="answers">${w.answers ? "Re-draft" : "Draft answers"}</button></div>
        <p class="hint">${qs.length} questions typically asked, from your résumé + interview facts.</p>
        <div id="answers-body">${(w.answers || []).map((a, i) => `<div class="qa"><div class="q">${esc(qs[i])}</div><div class="a">${a ? markAdds(a) : ""}</div>${a ? `<div class="tools row"><button class="btn small" data-cp="${i}">Copy</button></div>` : ""}</div>`).join("")}</div></div>`);
  }

  host.innerHTML = sections.join("");
  if (!currentCvCache && w.pdf) api("/api/resume").then((r) => { currentCvCache = r.content; if (!w.improveDraft) { const b = $("#imp-body"); if (b) b.innerHTML = md(r.content); } });
  wireSections(job, w);
}

function wireSections(job, w) {
  const reRun = async (fn, msg) => { toast(msg); try { await fn(); } catch (e) { toast(e.message, true); } renderWorkspace(); };
  const on = (act, handler) => $$(`[data-act="${act}"]`).forEach((b) => b.addEventListener("click", handler));

  on("re-eval", () => { w.report = null; w.step = "evaluating"; w.running = false; runPipeline(job, w); });
  on("re-market", () => reRun(async () => { const r = await api("/api/market-trends", { method: "POST", body: { role: w.role, jd: w.jd } }); w.market = r.summary; w.marketSources = r.sources; }, "Refreshing market…"));
  on("re-tailor", () => reRun(async () => { const context = [w.report && `FIT:\n${w.report}`, w.market && `MARKET:\n${w.market}`].filter(Boolean).join("\n\n"); const r = await api("/api/tailored-pdf", { method: "POST", body: { jd: w.jd, company: w.company, role: w.role, context } }); w.pdf = r.pdf; }, "Regenerating résumé…"));
  on("re-letter", () => reRun(async () => { const r = await api("/api/cover-letter", { method: "POST", body: { jd: w.jd, company: w.company, role: w.role } }); w.letter = r.letter; }, "Rewriting letter…"));
  on("toggle-improve", () => { w.improveOpen = !w.improveOpen; renderPipeSections(job, w); });
  on("cl-copy", () => copyText(w.letter));
  on("cl-dl", () => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([w.letter], { type: "text/markdown" })), download: `cover-letter-${(w.company || "draft").toLowerCase().replace(/\s+/g, "-")}.md` }); a.click(); });

  on("answers", async () => {
    const qs = questionsForRole(w.role);
    $("#answers-body").innerHTML = `<div class="empty">${spin} Drafting…</div>`;
    try {
      const r = await api("/api/answers", { method: "POST", body: { questions: qs, jd: w.jd, company: w.company, role: w.role } });
      w.answers = qs.map((q, i) => r.answers[i]?.a || r.answers.find((x) => x.q === q)?.a || "");
      renderPipeSections(job, w);
    } catch (e) { toast(e.message, true); renderPipeSections(job, w); }
  });
  $$("[data-cp]").forEach((b) => b.addEventListener("click", () => copyText(w.answers[+b.dataset.cp])));

  // improve chat
  const impSend = async () => {
    const input = $("#imp-in");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    w.improveMsgs.push({ role: "user", content: text });
    $("#imp-log").innerHTML = w.improveMsgs.map((m) => `<div class="msg ${m.role}">${md(m.content)}</div>`).join("") + `<div class="msg assistant">${spin}</div>`;
    $("#imp-log").scrollTop = 1e9;
    try {
      const r = await api("/api/resume-chat", { method: "POST", body: { messages: w.improveMsgs, jd: w.jd, company: w.company, role: w.role } });
      w.improveMsgs.push({ role: "assistant", content: r.reply.replace(/```(?:markdown|md)?\n[\s\S]*?```/, "_(updated résumé shown in the preview →)_") });
      if (r.draft) w.improveDraft = r.draft;
      renderPipeSections(job, w);
    } catch (e) { w.improveMsgs.pop(); toast(e.message, true); renderPipeSections(job, w); }
  };
  on("imp-send", impSend);
  $("#imp-in")?.addEventListener("keydown", (e) => { if (e.key === "Enter") impSend(); });
  on("imp-accept", async () => {
    if (!confirm("Replace your master résumé (cv.md) with this improved version?")) return;
    try { await api("/api/resume", { method: "POST", body: { content: w.improveDraft } }); currentCvCache = w.improveDraft; toast("Saved to cv.md"); } catch (e) { toast(e.message, true); }
  });
}

function questionsForRole(roleTitle) {
  const cat = state.catalog;
  const uni = cat.universalQuestions;
  const norm = (roleTitle || state.selectedRoles[0] || "").toLowerCase();
  let match = cat.roles.find((r) => r.t.toLowerCase() === norm) || cat.roles.find((r) => norm && r.t.toLowerCase().includes(norm)) ||
              cat.roles.find((r) => norm.split(/\s+/).filter((w) => w.length > 3).every((w) => r.t.toLowerCase().includes(w)));
  return match ? [...uni, ...cat.categories[match.c].questions] : uni;
}

async function trackJob(job, w, status) {
  if (!w.company || !w.role) return toast("Fill in company and role title first", true);
  if (status === "Applied" && w.score !== null && w.score < 4 && !confirm(`This scored ${w.score}/5 — below the apply bar. Mark as applied anyway?`)) return;
  // Feedback loop: capture what happened at submit time while it's fresh —
  // it lands in the tracker notes and future you (and Track) will see it.
  let note = "";
  if (status === "Applied") {
    note = prompt("Applied ✓ — any notes while it's fresh? (fields the form asked that surprised you, referral used, salary you entered… optional)") || "";
    note = note ? `applied via Studio — ${note}` : "applied via Studio (manually submitted)";
  }
  try {
    const r = await api("/api/track", { method: "POST", body: {
      company: w.company, role: w.role, status,
      score: w.score, reportPath: w.reportPath, note,
    }});
    toast(status === "Applied" ? `Tracked as Applied (#${r.num}) — it's now in Track` : "Skipped — onward!");
    const idx = state.jobs.findIndex((j) => j.id === job.id);
    await loadJobs();
    state.activeJob = state.jobs[Math.min(idx, state.jobs.length - 1)]?.id || null;
    renderRail6(); renderWorkspace();
  } catch (e) { toast(e.message, true); }
}

/* 7 — Track: everything after you hit submit */
stages.track = async () => {
  const [{ rows }, { cadence }, { plugins }] = await Promise.all([
    api("/api/tracker"), api("/api/followups"), api("/api/plugins"),
  ]);
  const applied = rows.filter((r) => ["Applied", "Responded", "Interview", "Offer"].includes(r.status));
  const days = (d) => Math.max(0, Math.round((Date.now() - new Date(d)) / 86400000));
  const cadenceFor = (company) => {
    const list = cadence?.followups || cadence?.applications || (Array.isArray(cadence) ? cadence : []);
    return list.find?.((c) => (c.company || "").toLowerCase() === company.toLowerCase());
  };
  const gmail = plugins.find((p) => p.id === "gmail");
  const NEXT = { Applied: "Responded", Responded: "Interview", Interview: "Offer" };

  view.innerHTML = `
    <div class="stage">
      <div class="row">
        <div style="flex:1">
          <div class="page-title">Your applications</div>
          <p class="page-sub">Everything you've applied to, with follow-up timing and interview prep. Update a status the moment you hear back — the whole system learns from it.</p>
        </div>
        <button class="btn" id="back-board">← Apply board</button>
      </div>
      ${applied.length ? applied.map((r) => {
        const c = cadenceFor(r.company);
        const d = days(r.date);
        return `
        <div class="card" data-co="${esc(r.company)}" data-role="${esc(r.role)}">
          <div class="row">
            <div style="flex:1;min-width:0">
              <h3 style="margin-bottom:2px">${esc(r.role)} — ${esc(r.company)}</h3>
              <span class="hint">applied ${esc(r.date)} · ${d} day${d === 1 ? "" : "s"} ago${r.score && r.score !== "-" ? ` · fit ${esc(r.score)}` : ""}</span>
            </div>
            <span class="pill ${r.status === "Applied" ? "off" : "ok"}">${esc(r.status)}</span>
          </div>
          ${c?.next_action || c?.action ? `<div class="note" style="margin:10px 0 4px">Follow-up: ${esc(c.next_action || c.action)}${c.due || c.next_date ? ` · ${esc(c.due || c.next_date)}` : ""}</div>`
            : d >= 7 && r.status === "Applied" ? `<div class="note" style="margin:10px 0 4px">${d} days with no response — a short, polite follow-up is reasonable now.</div>` : ""}
          <div class="row" style="margin-top:10px">
            <button class="btn small primary" data-prep>Prep for interview</button>
            <label class="hint" style="margin:0">Interview date <input type="date" data-ivdate style="width:auto;padding:4px 8px;font-size:12.5px"></label>
            ${NEXT[r.status] ? `<button class="btn small" data-status="${NEXT[r.status]}">Heard back → ${NEXT[r.status]}</button>` : ""}
            ${r.status !== "Offer" ? `<button class="btn small" data-status="Rejected">Rejected</button>` : ""}
          </div>
          <div class="prep-out" style="margin-top:10px"></div>
          ${r.notes ? `<p class="hint" style="margin-top:8px">${esc(r.notes)}</p>` : ""}
        </div>`;
      }).join("") : `<div class="card"><div class="empty">Nothing applied yet — when you hit “I applied” on the board, jobs land here.</div></div>`}
      <div class="card">
        <div class="row"><h3 style="margin-right:auto">Inbox connectors</h3></div>
        <p class="hint">Connect your email so recruiter replies land in your pipeline and statuses stay in sync — nothing leaves your machine except to your own provider.</p>
        <div class="connectors">
          <div class="connector ${gmail?.enabled ? "on" : ""}">
            <div class="row"><b style="margin-right:auto">✉️ Gmail</b><span class="pill ${gmail?.enabled ? "ok" : "off"}">${gmail?.enabled ? "connected" : "not connected"}</span></div>
            ${gmail?.enabled
              ? `<p class="hint">Label recruiter emails in Gmail; Studio pulls them in.</p><button class="btn small" id="gmail-run">Pull from Gmail</button><div id="gmail-out"></div>`
              : `<p class="hint">Read-only via career-ops' Gmail plugin (your own OAuth). Enable <code>gmail</code> in <code>config/plugins.yml</code> + add ${esc((gmail?.missingEnv || ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"]).join(", "))} to <code>.env</code>.</p><a class="btn small" href="https://github.com/santifer/career-ops/blob/main/docs/PLUGINS.md" target="_blank">Setup guide</a>`}
          </div>
          <div class="connector">
            <div class="row"><b style="margin-right:auto">📅 Outlook / Microsoft 365</b><span class="pill off">planned</span></div>
            <p class="hint">Outlook connector is on the roadmap — the same read-only, local-first model. For now, forward recruiter mail to a Gmail label, or add postings manually on the board.</p>
          </div>
        </div>
      </div>
    </div>`;

  $("#back-board").addEventListener("click", () => go(6));
  // Interview prep, two steps: AI suggests topics → you pick → roadmap to date.
  $$("#view [data-prep]").forEach((b) => b.addEventListener("click", async () => {
    const card = b.closest(".card");
    const out = card.querySelector(".prep-out");
    const co = card.dataset.co, role = card.dataset.role;
    b.disabled = true;
    out.innerHTML = `<div class="empty">${spin} Analysing what you should prepare for this role…</div>`;
    try {
      const { topics } = await api("/api/prep-topics", { method: "POST", body: { company: co, role } });
      if (!topics.length) { out.innerHTML = `<div class="note">Couldn't derive topics — try again.</div>`; b.disabled = false; return; }
      out.innerHTML = `
        <div class="note" style="margin-bottom:8px">Pick what <b>you</b> want to focus on — I'll build a roadmap to your interview date.</div>
        <div id="topics-${co.replace(/\W/g, "")}">${topics.map((t, i) => `
          <label class="topic-opt"><input type="checkbox" data-topic="${esc(t.topic)}" ${t.priority === "high" ? "checked" : ""}>
          <span><b>${esc(t.topic)}</b> <span class="pill ${t.priority === "high" ? "warn" : "off"}">${esc(t.priority)}</span><br><span class="hint">${esc(t.why)}</span></span></label>`).join("")}</div>
        <div class="row" style="margin-top:10px"><button class="btn small primary" data-roadmap>Build my roadmap →</button></div>
        <div class="roadmap-out"></div>`;
      out.querySelector("[data-roadmap]").addEventListener("click", async (ev) => {
        const chosen = [...out.querySelectorAll("[data-topic]:checked")].map((c) => c.dataset.topic);
        if (!chosen.length) return toast("Pick at least one topic", true);
        const ivDate = card.querySelector("[data-ivdate]").value;
        const rout = out.querySelector(".roadmap-out");
        ev.target.disabled = true;
        rout.innerHTML = `<div class="empty">${spin} Building a roadmap${ivDate ? ` to ${ivDate}` : ""}…</div>`;
        try {
          const r = await api("/api/prep-roadmap", { method: "POST", body: { company: co, role, topics: chosen, interviewDate: ivDate } });
          rout.innerHTML = `<div class="note">Saved to <code>${esc(r.file)}</code>.</div><div class="prose">${md(r.plan)}</div>`;
        } catch (e) { rout.innerHTML = ""; toast(e.message, true); }
      });
    } catch (e) { out.innerHTML = ""; toast(e.message, true); }
    b.disabled = false;
  }));
  $$("#view [data-status]").forEach((b) => b.addEventListener("click", async () => {
    const card = b.closest(".card");
    try {
      await api("/api/track", { method: "POST", body: { company: card.dataset.co, role: card.dataset.role, status: b.dataset.status } });
      toast(`${card.dataset.co} → ${b.dataset.status}`);
      stages.track();
    } catch (e) { toast(e.message, true); }
  }));
  $("#gmail-run")?.addEventListener("click", async () => {
    const out = $("#gmail-out");
    out.innerHTML = `<div class="empty">${spin} Checking your labelled inbox…</div>`;
    try {
      const r = await api("/api/gmail-pull", { method: "POST", body: {} });
      out.innerHTML = `<pre class="log">${esc(r.output)}</pre>`;
    } catch (e) { out.innerHTML = ""; toast(e.message, true); }
  });
};

/* ── overlays (Reports / Model settings) ───────────────── */
const overlays = {
  settings: async (el) => {
    el.innerHTML = `<div class="page-title" style="font-size:22px">Model & provider</div><div id="ov-settings"></div>`;
    await settingsForm($("#ov-settings"), () => toast("Model connected"));
  },
  reports: async (el) => {
    const { reports } = await api("/api/reports");
    el.innerHTML = `
      <div class="page-title" style="font-size:22px">Reports</div>
      <div id="rep-list">${reports.length ? reports.map((f) => `<div class="role-line" data-f="${esc(f)}"><span>${esc(f)}</span><span class="cat">open →</span></div>`).join("") : `<div class="empty">No reports yet.</div>`}</div>
      <div id="rep-body"></div>`;
    $$("#rep-list [data-f]", el).forEach((r) => r.addEventListener("click", async () => {
      const { content } = await api(`/api/report?f=${encodeURIComponent(r.dataset.f)}`);
      $("#rep-body", el).innerHTML = `<div class="prose" style="margin-top:14px">${md(content)}</div>`;
    }));
  },
};
$$("[data-overlay]").forEach((b) => b.addEventListener("click", async () => {
  $("#overlay").hidden = false;
  $("#overlay-body").innerHTML = `<div class="empty">${spin}</div>`;
  await overlays[b.dataset.overlay]($("#overlay-body"));
}));
$("#overlay-close").addEventListener("click", () => ($("#overlay").hidden = true));
$("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") $("#overlay").hidden = true; });

/* ── Ask Job Studio (global assistant) ─────────────────── */
const askMsgs = [];
function initAsk() {
  const fab = $("#ask-fab"), panel = $("#ask-panel"), log = $("#ask-log"), input = $("#ask-in");
  const paint = (pending) => {
    log.innerHTML = askMsgs.map((m) => `<div class="msg ${m.role}">${md(m.content)}</div>`).join("")
      + (pending ? `<div class="msg assistant">${spin}</div>` : "")
      || `<div class="empty" style="padding:14px">Hi — I know your résumé, your targets, and what you've applied to. Ask me about a role, the job market, or what to do next.</div>`;
    log.scrollTop = log.scrollHeight;
  };
  const toggle = (on) => {
    panel.hidden = on === undefined ? !panel.hidden : !on;
    if (!panel.hidden) { paint(false); input.focus(); }
  };
  fab.addEventListener("click", () => toggle());
  $("#ask-close").addEventListener("click", () => toggle(false));
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    askMsgs.push({ role: "user", content: text });
    paint(true);
    try {
      const pageContext = `${STAGES[state.stage]?.label || ""} stage${state.activeJob ? "; a job is open in the apply workspace" : ""}`;
      const r = await api("/api/ask", { method: "POST", body: { messages: askMsgs, pageContext } });
      askMsgs.push({ role: "assistant", content: r.reply });
    } catch (e) { askMsgs.push({ role: "assistant", content: `⚠️ ${e.message}` }); }
    paint(false);
  };
  $("#ask-send").addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
}
initAsk();

/* ── Server health indicator (fixes silent 'paste the JD' on crash) ── */
function initHealth() {
  const el = $("#health");
  if (!el) return;
  let fails = 0;
  const ping = async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch("/api/status", { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error();
      fails = 0;
      el.className = "health ok";
      el.title = "Studio connected";
    } catch {
      fails++;
      if (fails >= 2) { el.className = "health down"; el.title = "Studio server not responding — restart: node studio/server.mjs"; }
    }
  };
  ping();
  setInterval(ping, 8000);
}
initHealth();

/* ── boot: resume the journey where the user left off ──── */
(async function boot() {
  try {
    const s = await loadStatus();
    const iv = await api("/api/interview").then((r) => r.answers || {}).catch(() => ({}));
    const done = [true, !!s.settings.model, s.cv, Object.keys(iv).some((k) => iv[k]?.length), s.portals && s.profile, s.pipeline > 0 || s.reports > 0];
    let first = done.findIndex((d) => !d);
    const allDone = first === -1;
    if (allDone) first = 6;
    state.maxStage = allDone ? 7 : Math.max(first, 0);
    renderRail();
    go(first <= 1 && !s.cv ? 0 : first);
  } catch (e) {
    view.innerHTML = `<div class="card"><h3>Can't reach the Studio server</h3><p class="hint">${esc(e.message)}</p></div>`;
  }
})();

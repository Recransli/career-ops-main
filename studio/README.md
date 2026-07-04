# ✦ Career-Ops Studio

A **minimal, local-first web UI** for [career-ops](https://github.com/santifer/career-ops) — bring your own model (a free local Ollama, or any API key) and run your whole job search from one clean screen.

Studio is a *wrapper*, not a fork: it drives the career-ops scripts you already have (`scan.mjs`, `ollama-eval.mjs`, `openai-eval.mjs`) and reads/writes the same files the CLI uses. It never modifies career-ops system files, so `update-system.mjs` keeps working untouched.

## What you get

The whole thing is a **journey**, not a portal: Start → Model → Resume → a short interview about you → Roles → Discover → Apply → Track. A WebGL scene (three.js) travels forward with you — and finds your cities on a globe when you tell it where you'd work.

- **Bring your own model** — local Ollama (free, private, offline) or any OpenAI-compatible API: OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, LM Studio, vLLM, llama.cpp. Pick the provider, fetch the model list, select, done. Keys live only in `studio/.local/` on your machine (gitignored).
- **Any-format resume** — PDF, DOCX, PNG/JPG (via your vision model), LaTeX, Markdown, or plain text. PDFs and DOCX are extracted *in your browser* (pdf.js / mammoth); everything is faithfully transcribed to markdown by your model, and **you review the conversion before it's saved** as `cv.md`, the single source of truth.
- **The onboarding interview** — answer everything applications ask, exactly once: authorization, sponsorship, salary, notice, relocation, clearance, your story, and *optional* self-identification (gender, race/ethnicity, veteran, disability — used only to pre-fill the EEO sections you'd fill anyway; "Prefer not to say" is always an answer). Do it as a form, or **talk it through in chat**: the companion reads real postings for your target role from your own scan and asks what those applications will actually want. Your **street address autocompletes** (keyless OSM geocoder) and fills city/state/ZIP/country as validated components.
- **1,300+ searchable job roles** across 16 fields — pick your targets and the portal scanner's keywords and your profile are configured automatically.
- **Pick your boards & companies** — the Discover step is a picker: 13 remote/aggregator boards (RemoteOK, We Work Remotely, Remotive, Himalayas, Arbeitnow, HN Who's Hiring…) and 75+ direct-company career sites (Anthropic, Stripe, Figma, Databricks, Notion…), filterable by name or tag. Your selection is written into `portals.yml` with the right ATS API for each. Precise phrase-level keywords (from your target roles) cut the false positives that bare words like "Engineer" caused.
- **Add any company yourself** — paste a Greenhouse/Lever/Ashby careers URL; Studio detects the ATS, verifies the board responds, and adds it to your scan.
- **Daily refresh** — turn on an automatic daily re-scan at a time you choose (default 12:00), optionally chaining a background evaluation of new jobs. Runs while Studio is open; for always-on (updates even when Studio is closed), one command installs a macOS launchd agent — see below.
- **Background evaluation** — kick off evaluation of your inbox in the background; for strong matches (≥ your threshold, default 4/5) Studio auto-prepares the tailored PDF and cover letter, so high-fit jobs are ready when you sit down. Start/stop with live progress.
- **Zero-token job scanning** — hits Greenhouse/Lever/Ashby and 40+ other job-board APIs directly through career-ops' scanner. No AI cost to find openings.
- **A job board that does the reading for you** — thousands of scanned postings with status tabs (Inbox / Evaluated / Applied), location and role filters, search and sorting. Pick a job and **the full posting loads by itself** from the Greenhouse/Lever/Ashby public APIs (page-text fallback for everything else) — no copy-pasting JDs. The workspace then offers four moves: **Evaluate** (full A–G report, fit score /5), **Tailor resume**, **Answers**, **Cover letter**. *"I applied"* asks for a quick note while it's fresh, tracks the job through career-ops' pipeline, and moves you on.
- **One-pass application prep (no tabs)** — open a job and the posting loads itself; press **Prepare this application** and Studio runs the whole chain automatically: evaluate fit → read the live market → tailor your résumé to a PDF *using the fit + market analysis as context* → draft the cover letter. A stepper shows progress; each result appears as a section you can expand, re-run, or (for the résumé) refine in a collapsible inline chat. Every artifact is saved per-posting, so reopening the job restores everything.
- **Track — after you hit submit** — every applied job with days-since-applied and follow-up timing. Set an **interview date**, get **AI-suggested prep topics** ranked by priority, tick the ones you care about, and Studio builds a **time-blocked roadmap to that date** (saved to `interview-prep/`, where career-ops' interview modes read it). One-click status updates (Responded → Interview → Offer). Optional Gmail plugin keeps recruiter responses flowing in.
- **Local telemetry** — anonymous usage counts (which steps run, how often) are appended to `studio/.local/telemetry.jsonl` on your machine only, to inform future design — never uploaded.
- **One-click tailored PDF** — the Tailor tab reorders and rephrases your resume for the specific JD (same facts, never new ones) and renders it through career-ops' ATS-clean template with Playwright. The generator even verifies the section order matches your own `cv.md`.
- **Live résumé improvement** — the Improve tab is a split view: your résumé preview on one side, a chat on the other. Ask it to sharpen bullets or align to the JD; the rewritten résumé appears in the preview, and you decide whether to save it back to `cv.md`. Reorders and rephrases only — never invents.
- **Market intel from the live web** — the Market tab searches the internet (keyless) for what employers want for the role *right now*, reads the top results, and distills in-demand skills, what's rising this year, and how you stack up — with sources cited.
- **Ask Job Studio** — a floating co-pilot on every screen. It knows your résumé, targets, interview answers, and what you've applied to, and pulls the web when you ask about current trends or salary. Advisory only: it never edits files or submits.
- **Choice-based locations everywhere** — every location field (home, target cities, street address) is a pick-from-real-places autocomplete, so what's stored is always a validated place, never a typo.
- **A browser extension that fills applications** (`studio/extension/`) — on the actual job posting, one click scrapes the form, asks your local Studio for grounded values, fills the fields and highlights them. It never touches the submit button.
- Facts your resume doesn't cover come back as `[ADD: …]` placeholders — the model is instructed to never invent, and you should still read every word.

## The browser extension

```
chrome://extensions → Developer mode → Load unpacked → select studio/extension/
```

Keep Studio running (`node studio/server.mjs`). On any application page, click the ✦ icon → **Fill this form**. Fields are drafted from your resume, profile, and interview answers, then highlighted orange for your review.

The extension is **type-aware**: native selects get an option *selected*, radio groups get the matching option *clicked*, custom comboboxes (Greenhouse/react-select "Select…" widgets — even button-triggered ones) are opened, their real options read, and the match clicked like a human would, then **verified** — if the widget didn't register the choice it retries (type + Enter) and otherwise flags the field instead of leaving loose text. Resume/CV upload fields get your latest **tailored PDF attached automatically**. After filling, anything the page still marks invalid is highlighted for you.

Safety is enforced server-side, not just prompted:
- **Your interview answers are authoritative.** Models reinterpret logistics (we caught one turning "2 weeks" into "30 days") — so authorization, sponsorship, salary, notice, relocation, clearance and self-ID fields are filled *verbatim* from your answers, corrected against them for choice fields, and left blank if you haven't answered.
- Self-identification fills **only** from your explicit optional answers; orientation, religion, DOB, marital and criminal-history questions are never auto-answered at all.
- Consent/certification checkboxes are never ticked for you.
- Nothing is ever clicked or submitted. The extension fills and highlights, you review and send.

A local test harness (`http://localhost:4949/test-form.html`) runs the exact shipping content script against a mock application form — native fields, comboboxes, radios, consent boxes, file upload — so every fill behavior above is verifiable on your machine.

**Auto-tracking on submit:** on Greenhouse/Lever/Ashby/Workday application pages the extension also watches for a real submission (submit click + a "thank you / received" confirmation) and offers — one click, never automatic — to mark that job **Applied** in Studio, so your tracker and monitoring stay in sync without you switching tabs.

## Quick start

```bash
# 1. Get career-ops and install its deps (Node 18+)
git clone https://github.com/santifer/career-ops
cd career-ops && npm install

# 2. Drop the studio/ folder into the checkout (if it isn't already there)

# 3. Run
node studio/server.mjs
# → http://localhost:4949
```

Using a local model? Install [Ollama](https://ollama.com) and pull something with enough headroom:

```bash
ollama pull qwen2.5-coder:32b   # good default if you have ~24GB (V)RAM
```

> **Model size matters.** Per the career-ops docs, 7–8B models are too weak for the structured evaluation format — they miss the schema and, worse, *embellish*. Use **32B+** for evaluations you'll trust. Smaller models are OK for cover-letter first drafts you'll edit heavily. A cheap hosted option (DeepSeek, OpenRouter Llama 3.3 70B) costs cents and beats a small local model.

### Run it like a Mac app (optional)

No Electron, no build — Studio stays a plain local server. On macOS you get two native conveniences:

- **Double-click launcher:** open `studio/mac/launch.command` — it starts the server if needed and opens Studio in your browser. (First run: right-click → Open to clear Gatekeeper.)
- **Always-on + daily refresh:** run `bash studio/mac/install.sh` once. It installs a launchd LaunchAgent so Studio starts at login, restarts if it crashes, and the daily refresh (set in Discover → Daily refresh) fires on schedule even when you haven't opened the app. Uninstall with `bash studio/mac/install.sh --remove`.

Why not a full Mac app? An Electron/Tauri build would add ~150 MB and a build step, breaking the zero-dependency, cross-platform, publish-to-GitHub design. `launchd` is the macOS-native way to get "always running + scheduled" without any of that.

Pointing Studio at a career-ops checkout somewhere else:

```bash
CAREER_OPS_ROOT=/path/to/career-ops node server.mjs
PORT=5050 node server.mjs   # different port
```

## Privacy & data

- Binds to `127.0.0.1` only — nothing is exposed to your network.
- Your resume, reports, and tracker are plain files in your career-ops checkout. No database, no account, no telemetry.
- Your resume and JDs are sent **only** to the model endpoint you configure. Choose Ollama and nothing ever leaves your machine.
- API keys are stored in `studio/.local/settings.json`, which is gitignored.

## The line this tool won't cross

Studio inherits career-ops' ethics rules and enforces them:

- **It never submits an application for you.** It drafts, evaluates, and prepares — the submit button is always yours.
- **Quality over quantity.** Low-fit roles (score < 4/5) are flagged as not worth applying to. Five tailored applications beat fifty generic ones — for you *and* for the humans reading them.
- **No fabrication.** Generated answers and letters are grounded in your resume. Missing facts become `[ADD: …]` placeholders, not inventions. Review everything before you use it — small models especially will try to flatter you.

## Architecture

```
studio/
├── server.mjs           # zero-dependency Node server (stdlib http only)
├── public/              # vanilla HTML/CSS/JS — no framework, no build step
├── data/roles.json      # generated role catalog + question banks
├── scripts/build-roles.mjs  # regenerate the catalog (npm run build:roles)
└── .local/              # your settings & keys (gitignored)
```

The server only ever writes career-ops **user-layer** files (`cv.md`, `config/profile.yml`, `portals.yml`) and delegates evaluation/scanning to career-ops' own scripts — so everything Studio produces is also visible to the career-ops CLI, and vice versa.

## Credits

Built as a community wrapper around [santifer/career-ops](https://github.com/santifer/career-ops). The evaluation logic, scanner, and pipeline are career-ops' own — Studio just gives them a face.

#!/usr/bin/env node
/**
 * smoke.mjs — endpoint smoke tests for Career-Ops Studio.
 *
 * Boots the server on a scratch port and CAREER_OPS_ROOT, hits the read-only
 * and cheap endpoints, and asserts they respond sanely. Does NOT call the LLM
 * (no model assumed in CI); LLM-backed routes are checked only for reachability
 * of their guard responses.
 *
 *   npm test
 */
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const STUDIO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4987;
const BASE = `http://127.0.0.1:${PORT}`;

// scratch career-ops root so we never touch the user's real files
const root = mkdtempSync(join(tmpdir(), "cops-smoke-"));
mkdirSync(join(root, "config"), { recursive: true });
mkdirSync(join(root, "templates"), { recursive: true });
mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "cv.md"), "# Test User\ntest@example.com\n\n## Summary\nSmoke test resume.\n\n## Experience\nThings.");
writeFileSync(join(root, "config", "profile.example.yml"), "candidate:\n  full_name: Jane Smith\n");
writeFileSync(join(root, "templates", "portals.example.yml"), "title_filter:\n  positive: []\n");
// point js-yaml resolution at the real checkout's node_modules
try { mkdirSync(join(root, "node_modules"), { recursive: true }); } catch {}

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  cond ? pass++ : fail++;
}

async function get(p) { const r = await fetch(BASE + p); return { status: r.status, json: await r.json().catch(() => null) }; }
async function post(p, body) { const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; }

const child = spawn(process.execPath, [join(STUDIO, "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), CAREER_OPS_ROOT: root },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverErr = "";
child.stderr.on("data", (d) => (serverErr += d));

async function waitUp(ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(BASE + "/api/status"); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

try {
  if (!(await waitUp())) { console.error("server did not start\n" + serverErr); process.exit(1); }

  const status = await get("/api/status");
  check("GET /api/status 200", status.status === 200);
  check("status has root", !!status.json?.root);

  check("GET / serves html", (await fetch(BASE + "/")).status === 200);
  check("GET /styles.css", (await fetch(BASE + "/styles.css")).status === 200);
  check("GET /app.js", (await fetch(BASE + "/app.js")).status === 200);

  const roles = await get("/api/roles");
  check("GET /api/roles has catalog", Array.isArray(roles.json?.roles) && roles.json.roles.length > 1000);

  const boards = await get("/api/boards");
  check("GET /api/boards remote+companies", boards.json?.remoteBoards?.length > 5 && boards.json?.companies?.length > 20);

  const places = await get("/api/places?q=new%20york");
  check("GET /api/places returns places", Array.isArray(places.json?.places));

  const sched = await get("/api/schedule");
  check("GET /api/schedule", typeof sched.json?.schedule?.enabled === "boolean");

  const bgState = await get("/api/background");
  check("GET /api/background", typeof bgState.json?.state?.running === "boolean");

  const tel = await post("/api/telemetry", { event: "smoke" });
  check("POST /api/telemetry", tel.json?.logged === true);

  // guard responses (no model) — should 4xx/5xx gracefully, not hang/crash
  const evalGuard = await post("/api/evaluate", { jd: "x" });
  check("POST /api/evaluate guards short JD", evalGuard.status >= 400);

  const addBad = await post("/api/add-company", { url: "https://example.com" });
  check("POST /api/add-company rejects non-ATS", addBad.status >= 400);

  const notFound = await get("/api/does-not-exist");
  check("unknown api → 404", notFound.status === 404);

} finally {
  child.kill("SIGKILL");
  try { rmSync(root, { recursive: true, force: true }); } catch {}
}

for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

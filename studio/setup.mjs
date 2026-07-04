#!/usr/bin/env node
/**
 * setup.mjs — first-run doctor + launcher for Career-Ops Studio.
 *
 *   node studio/setup.mjs         # check everything, then start + open browser
 *   node studio/setup.mjs --check # just report, don't start
 *
 * Turns "clone → read README → install → run" into one friendly command:
 * verifies Node, the career-ops deps, onboarding files, a reachable model, and
 * a free port; prints a clear report; then launches Studio and opens it.
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn, spawnSync } from "child_process";

const STUDIO = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CAREER_OPS_ROOT || join(STUDIO, "..");
const PORT = Number(process.env.PORT || 4949);
const checkOnly = process.argv.includes("--check");

const g = (s) => `\x1b[32m${s}\x1b[0m`, y = (s) => `\x1b[33m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const report = [];
let blocking = 0;
function ok(m) { report.push(`  ${g("✓")} ${m}`); }
function warn(m, hint) { report.push(`  ${y("!")} ${m}${hint ? dim("  → " + hint) : ""}`); }
function bad(m, hint) { report.push(`  ${r("✗")} ${m}${hint ? dim("  → " + hint) : ""}`); blocking++; }

console.log("\n  ✦ Career-Ops Studio — setup check\n");

// Node version
const major = Number(process.versions.node.split(".")[0]);
major >= 18 ? ok(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} is too old`, "install Node 18+");

// career-ops deps (js-yaml is the load-bearing one)
if (existsSync(join(ROOT, "node_modules", "js-yaml"))) ok("career-ops dependencies installed");
else {
  warn("career-ops dependencies not installed", checkOnly ? "run: npm install (in the career-ops root)" : "installing now…");
  if (!checkOnly) {
    const res = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit" });
    res.status === 0 ? ok("installed dependencies") : bad("npm install failed", "install manually in the career-ops root");
  }
}

// onboarding files
const files = { "cv.md": "your résumé", "config/profile.yml": "your profile", "portals.yml": "scan config" };
const missing = Object.keys(files).filter((f) => !existsSync(join(ROOT, f)));
if (!missing.length) ok("onboarding files present (cv.md, profile.yml, portals.yml)");
else warn(`first run — ${missing.join(", ")} not set up yet`, "the app's Setup journey will create these");

// a reachable model (Ollama on the default port, or a saved provider)
let modelInfo = "";
try {
  const settingsPath = join(STUDIO, ".local", "settings.json");
  const s = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
  if (s.model) { ok(`model configured: ${s.model} (${s.provider})`); modelInfo = s.model; }
  else {
    const res = await fetch("http://localhost:11434/api/tags").then((x) => x.json()).catch(() => null);
    if (res?.models?.length) ok(`Ollama running — ${res.models.length} model(s) available`);
    else warn("no model configured yet", "install Ollama (ollama.com) or add an API key in Settings");
  }
} catch { warn("couldn't check for a model", "you'll pick one in Settings"); }

// port
const busy = await fetch(`http://localhost:${PORT}/api/status`).then(() => true).catch(() => false);
if (busy) warn(`Studio already running on :${PORT}`, "will just open the browser");
else ok(`port ${PORT} free`);

console.log(report.join("\n"));

if (blocking) { console.log(`\n  ${r("Fix the ✗ items above, then re-run.")}\n`); process.exit(1); }
if (checkOnly) { console.log(`\n  ${g("Ready.")} Start with: ${dim("node studio/server.mjs")}\n`); process.exit(0); }

// launch
if (!busy) {
  console.log(`\n  Starting Studio on http://localhost:${PORT} …`);
  const child = spawn(process.execPath, [join(STUDIO, "server.mjs")], { cwd: STUDIO, env: { ...process.env, PORT: String(PORT) }, stdio: "inherit", detached: false });
  process.on("SIGINT", () => { child.kill(); process.exit(0); });
  // wait until up, then open
  for (let i = 0; i < 30; i++) {
    if (await fetch(`http://localhost:${PORT}/api/status`).then(() => true).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
}
const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
spawnSync(opener, [`http://localhost:${PORT}`], { shell: process.platform === "win32", stdio: "ignore" });
console.log(`\n  ${g("✦ Studio is open")} → http://localhost:${PORT}\n  ${dim("Ctrl-C to stop.")}\n`);

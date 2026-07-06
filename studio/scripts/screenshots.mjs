#!/usr/bin/env node
/**
 * screenshots.mjs — capture the README screenshots from the live app.
 *
 * Assumes Studio is running on http://localhost:4949 (start it first:
 * `node studio/server.mjs`). Uses the Playwright already installed for the CV
 * PDF pipeline. Writes PNGs into studio/docs/img/.
 *
 *   node studio/scripts/screenshots.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "img");
mkdirSync(OUT, { recursive: true });
const BASE = process.env.STUDIO_URL || "http://localhost:4949";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1340, height: 940 }, deviceScaleFactor: 2 });

async function shot(name, { setup, wait = 1400 } = {}) {
  if (setup) await page.evaluate(setup);
  await sleep(wait);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("✓", name);
}

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await sleep(3500); // let three.js + boot settle

// Cockpit (home) — boots here for a set-up user
await shot("cockpit", { setup: "window.go(IDX.cockpit)", wait: 1800 });

// Welcome / hero
await shot("welcome", { setup: "window.go(0)", wait: 1500 });

// About you (interview + globe)
await shot("interview", { setup: "window.go(3)", wait: 1600 });

// Discover — boards + companies picker
await shot("discover", { setup: "window.go(5)", wait: 2200 });

// Apply board — rail + a posting auto-loaded
await page.evaluate("window.go(IDX.board)");
await sleep(1800);
await page.evaluate(() => document.querySelector(".job-card")?.click());
await sleep(2600);
await shot("apply", { wait: 800 });

// Track — three-lane pipeline
await shot("track", { setup: "window.go(IDX.track)", wait: 1600 });

// Assistant canvas — résumé artifact (stubbed content, no model needed)
await page.evaluate("window.go(IDX.cockpit)");
await sleep(1000);
await page.evaluate(() => {
  document.querySelector("#ask-fab")?.click();
  showCanvas("Revised résumé — review, download, or save",
    "# Venkata Hari Abhishek Maruturi\n\n## Summary\nGenerative-AI engineer building LLM systems, RAG pipelines and multi-agent frameworks.\n\n## Experience\n**Barclays** — AVP, Senior Software Developer · Whippany, NJ\n- Increased settlement-failure prediction accuracy by 20% with an ensemble model.\n- Automated manual workflows in Python, cutting incidents to zero for FY24.\n\n**Toyota** — Data Scientist · Dallas, TX\n- Built vehicle-profiling from FFT with a custom smoothness metric.\n\n## Skills\nPython, PySpark, LangChain, LangGraph, AWS (Lambda, S3), MongoDB, Chroma",
    { label: "Save to cv.md", onClick: async () => {} }, { resumeDraft: "# stub" });
});
await shot("assistant", { wait: 900 });

await browser.close();
console.log(`\nWrote screenshots → ${OUT}`);

#!/usr/bin/env node
/**
 * build-boards.mjs — generates studio/data/boards.json
 *
 * Two kinds of source:
 *  - remoteBoards: aggregator job boards backed by a career-ops provider
 *    (no company slug needed — they return many companies' postings).
 *  - companies: direct-company career sites, each on a known ATS
 *    (greenhouse / lever / ashby / smartrecruiters / workable), so the scanner
 *    hits the public API with zero tokens. Slugs are the ATS board id.
 *
 * The Studio "Job boards" picker reads this, and writing a selection updates
 * portals.yml (job_boards + tracked_companies). Re-run: npm run build:boards
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "boards.json");

// Aggregator boards (provider-backed). id must match a providers/*.mjs id.
const remoteBoards = [
  { id: "remoteok", name: "RemoteOK", desc: "Large remote-first tech board", tags: ["remote", "tech"] },
  { id: "weworkremotely", name: "We Work Remotely", desc: "Popular remote board", tags: ["remote"] },
  { id: "remotive", name: "Remotive", desc: "Curated remote jobs", tags: ["remote"] },
  { id: "himalayas", name: "Himalayas", desc: "Remote jobs + company profiles", tags: ["remote"] },
  { id: "jobicy", name: "Jobicy", desc: "Remote jobs board", tags: ["remote"] },
  { id: "workingnomads", name: "Working Nomads", desc: "Curated remote listings", tags: ["remote"] },
  { id: "nodesk", name: "NoDesk", desc: "Remote work board", tags: ["remote"] },
  { id: "jobspresso", name: "Jobspresso", desc: "Curated remote jobs", tags: ["remote"] },
  { id: "4dayweek", name: "4 Day Week", desc: "4-day-week & flexible roles", tags: ["remote", "flexible"] },
  { id: "arbeitnow", name: "Arbeitnow", desc: "EU/Germany jobs, many visa-friendly", tags: ["eu"] },
  { id: "hackernews", name: "Hacker News — Who's Hiring", desc: "Monthly HN hiring thread", tags: ["tech", "startups"] },
  { id: "landingjobs", name: "Landing.jobs", desc: "European tech jobs", tags: ["eu", "tech"] },
  { id: "themuse", name: "The Muse", desc: "General professional roles", tags: ["general"] },
];

// Direct-company ATS boards. Grouped for the picker. Slugs are the ATS board id.
const C = (name, provider, slug, tags = []) => ({ name, provider, slug, tags });
const companies = [
  // ── AI / ML labs & platforms ──
  C("Anthropic", "greenhouse", "anthropic", ["ai"]),
  C("Cohere", "lever", "cohere", ["ai"]),
  C("Hugging Face", "greenhouse", "huggingface", ["ai"]),
  C("Scale AI", "greenhouse", "scaleai", ["ai"]),
  C("Runway", "greenhouse", "runwayml", ["ai"]),
  C("Weights & Biases", "ashby", "wandb", ["ai", "mlops"]),
  C("Together AI", "ashby", "togetherai", ["ai"]),
  C("Perplexity AI", "ashby", "perplexity", ["ai"]),
  C("ElevenLabs", "ashby", "elevenlabs", ["ai"]),
  C("Mistral AI", "lever", "mistral", ["ai"]),
  C("PolyAI", "greenhouse", "polyai", ["ai"]),
  C("Parloa", "greenhouse", "parloa", ["ai"]),
  C("Adept", "greenhouse", "adept", ["ai"]),
  C("Databricks", "greenhouse", "databricks", ["ai", "data"]),
  C("Pinecone", "greenhouse", "pinecone", ["ai", "data"]),
  C("LangChain", "ashby", "langchain", ["ai"]),
  C("Vapi", "ashby", "vapi", ["ai"]),
  C("Glean", "greenhouse", "glean", ["ai"]),
  C("Sierra", "ashby", "sierra", ["ai"]),
  C("Harvey", "ashby", "harvey", ["ai", "legal"]),
  // ── Infra / data / dev tools ──
  C("Snowflake", "greenhouse", "snowflake", ["data"]),
  C("Confluent", "greenhouse", "confluent", ["data"]),
  C("MongoDB", "greenhouse", "mongodb", ["data"]),
  C("HashiCorp", "greenhouse", "hashicorp", ["infra"]),
  C("GitLab", "greenhouse", "gitlab", ["devtools"]),
  C("Vercel", "greenhouse", "vercel", ["devtools"]),
  C("Datadog", "greenhouse", "datadog", ["infra"]),
  C("Cloudflare", "greenhouse", "cloudflare", ["infra"]),
  C("Grafana Labs", "greenhouse", "grafanalabs", ["infra"]),
  C("dbt Labs", "greenhouse", "dbtlabs", ["data"]),
  C("Fivetran", "greenhouse", "fivetran", ["data"]),
  C("CoreWeave", "greenhouse", "coreweave", ["infra", "ai"]),
  C("Supabase", "greenhouse", "supabase", ["devtools"]),
  C("Temporal", "greenhouse", "temporaltechnologies", ["infra"]),
  // ── Fintech ──
  C("Stripe", "greenhouse", "stripe", ["fintech"]),
  C("Plaid", "greenhouse", "plaid", ["fintech"]),
  C("Ramp", "ashby", "ramp", ["fintech"]),
  C("Brex", "greenhouse", "brex", ["fintech"]),
  C("Robinhood", "greenhouse", "robinhood", ["fintech"]),
  C("Chime", "greenhouse", "chime", ["fintech"]),
  C("Wise", "greenhouse", "wise", ["fintech"]),
  C("Mercury", "lever", "mercury", ["fintech"]),
  C("Trade Republic", "greenhouse", "traderepublic", ["fintech", "eu"]),
  C("N26", "greenhouse", "n26", ["fintech", "eu"]),
  C("SumUp", "greenhouse", "sumup", ["fintech", "eu"]),
  // ── Product / SaaS ──
  C("Notion", "greenhouse", "notion", ["saas"]),
  C("Figma", "greenhouse", "figma", ["saas"]),
  C("Linear", "ashby", "linear", ["saas"]),
  C("Airtable", "greenhouse", "airtable", ["saas"]),
  C("Retool", "greenhouse", "retool", ["saas"]),
  C("Intercom", "greenhouse", "intercom", ["saas"]),
  C("Asana", "greenhouse", "asana", ["saas"]),
  C("Miro", "greenhouse", "miro", ["saas"]),
  C("Loom", "greenhouse", "loom", ["saas"]),
  C("Webflow", "greenhouse", "webflow", ["saas"]),
  C("Deel", "greenhouse", "deel", ["saas"]),
  C("Rippling", "rippling", "rippling", ["saas"]),
  C("Gusto", "greenhouse", "gusto", ["saas"]),
  C("Zapier", "greenhouse", "zapier", ["saas", "remote"]),
  // ── Marketplaces / consumer / bigger tech ──
  C("Airbnb", "greenhouse", "airbnb", ["consumer"]),
  C("DoorDash", "greenhouse", "doordash", ["consumer"]),
  C("Instacart", "greenhouse", "instacart", ["consumer"]),
  C("Reddit", "greenhouse", "reddit", ["consumer"]),
  C("Discord", "greenhouse", "discord", ["consumer"]),
  C("Coinbase", "greenhouse", "coinbase", ["fintech", "crypto"]),
  C("Dropbox", "greenhouse", "dropbox", ["saas"]),
  C("Pinterest", "greenhouse", "pinterest", ["consumer"]),
  C("Lyft", "greenhouse", "lyft", ["consumer"]),
  C("HelloFresh", "greenhouse", "hellofresh", ["consumer", "eu"]),
  C("GetYourGuide", "greenhouse", "getyourguide", ["consumer", "eu"]),
  // ── Enterprise / security ──
  C("Wiz", "greenhouse", "wiz", ["security"]),
  C("1Password", "lever", "1password", ["security"]),
  C("Okta", "greenhouse", "okta", ["security"]),
  C("CrowdStrike", "greenhouse", "crowdstrike", ["security"]),
  C("Snyk", "greenhouse", "snyk", ["security"]),
  C("Helsing", "greenhouse", "helsing", ["ai", "eu"]),
  C("Palantir", "lever", "palantir", ["data"]),
];

const byProvider = {};
for (const c of companies) byProvider[c.provider] = (byProvider[c.provider] || 0) + 1;

const out = {
  generated: new Date().toISOString().slice(0, 10),
  remoteBoards,
  companies: companies.sort((a, b) => a.name.localeCompare(b.name)),
  providerCounts: byProvider,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${remoteBoards.length} remote boards + ${companies.length} companies → ${OUT}`);

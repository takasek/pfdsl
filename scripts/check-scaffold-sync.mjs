#!/usr/bin/env node
// CLI wrapper for checkScaffoldSync (#422): warns when this repo's own
// pfd-ops skill copy (.claude/skills/pfd-ops/references/scaffold/, the
// source gen-plugin.mjs mirrors from) has drifted from the generated
// plugin/pfdsl/skills/pfd-ops/references/scaffold/ mirror. Repo-local tool,
// not part of the distributed pfd-ops skill tree (scaffold/ has no --deploy
// step, so there is nothing here to ship downstream).
//
// Usage: node scripts/check-scaffold-sync.mjs

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkScaffoldSync } from "./lib/check-scaffold-sync.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalDir = resolve(root, ".claude/skills/pfd-ops/references/scaffold");
const deployedDir = resolve(root, "plugin/pfdsl/skills/pfd-ops/references/scaffold");

const results = checkScaffoldSync(canonicalDir, deployedDir);
const issues = results.filter((r) => r.status !== "ok");

if (issues.length === 0) {
	console.log("pfd-ops scaffold/ is in sync with plugin/pfdsl/skills/pfd-ops/references/scaffold/.");
	process.exit(0);
}

console.log("pfd-ops scaffold/ is out of sync with plugin/pfdsl/skills/pfd-ops/references/scaffold/:");
for (const r of issues) console.log(`  ${r.status}: ${r.path}`);
console.log("Run: node scripts/gen-plugin.mjs");
process.exit(1);

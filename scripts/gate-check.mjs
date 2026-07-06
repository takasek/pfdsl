#!/usr/bin/env node
// Terminal-gate aggregate checker: runs the 6 mechanically-verifiable items
// from pfd-ops step 3 (check / audit-issues-flow / check-md-linebreaks /
// gen-skill identity / snapshot freshness / output-artifact status update)
// against the diff from <base> to HEAD, then prints the remaining
// judgment-only items as MANUAL: lines.
// Usage: node scripts/gate-check.mjs [--base main]

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MANUAL_ITEMS, matchesTrigger, formatGateTable, hasStatusChange } from "./lib/gate-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const baseFlagIdx = args.indexOf("--base");
const base = baseFlagIdx >= 0 ? args[baseFlagIdx + 1] : "main";

function sh(cmd) {
	return execSync(cmd, { cwd: root, encoding: "utf-8" });
}
function trySh(cmd) {
	try {
		return { ok: true, out: sh(cmd) };
	} catch (e) {
		return { ok: false, out: e.stdout || e.message };
	}
}

// --diff-filter=d excludes deleted paths — a deleted .pfdsl/.md would
// otherwise fail the check/linebreaks gates against a file that no longer exists.
const changedFiles = sh(`git diff --diff-filter=d --name-only ${base}...HEAD`)
	.trim()
	.split("\n")
	.filter(Boolean);
const pfdslFiles = changedFiles.filter((f) => f.endsWith(".pfdsl"));
const mdFiles = changedFiles.filter((f) => f.endsWith(".md"));

const results = [];

// 1. pfdsl check on changed .pfdsl files
if (pfdslFiles.length === 0) {
	results.push({ name: "pfdsl check", status: "SKIP", detail: "no .pfdsl changes" });
} else {
	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	const failed = pfdslFiles.filter((f) => !trySh(`node "${cliPath}" check "${f}"`).ok);
	results.push({
		name: "pfdsl check",
		status: failed.length === 0 ? "PASS" : "FAIL",
		detail: failed.length === 0 ? `${pfdslFiles.length} file(s)` : `failed: ${failed.join(", ")}`,
	});
}

// 2. audit-issues-flow (no --fix: fails if manual findings remain)
{
	const r = trySh("node scripts/audit-issues-flow.mjs");
	results.push({
		name: "audit-issues-flow",
		status: r.ok ? "PASS" : "FAIL",
		detail: r.ok ? undefined : "re-run: node scripts/audit-issues-flow.mjs (findings or gh/network error)",
	});
}

// 3. check-md-linebreaks on changed .md files
if (mdFiles.length === 0) {
	results.push({ name: "check-md-linebreaks", status: "SKIP", detail: "no .md changes" });
} else {
	const r = trySh(`node scripts/check-md-linebreaks.mjs ${mdFiles.map((f) => `"${f}"`).join(" ")}`);
	results.push({ name: "check-md-linebreaks", status: r.ok ? "PASS" : "FAIL" });
}

// 4. gen-skill identity (only when skill-source paths changed)
if (!matchesTrigger(changedFiles, /^(docs\/|scripts\/skill-template\/|scripts\/gen-skill\.mjs)/)) {
	results.push({ name: "gen-skill identity", status: "SKIP", detail: "no skill-source changes" });
} else {
	const r = trySh(
		'node scripts/gen-skill.mjs --out .claude/skills/pfdsl && node scripts/gen-skill.mjs --out skills/pfdsl && diff -rq -x CLAUDE.md .claude/skills/pfdsl skills/pfdsl',
	);
	results.push({ name: "gen-skill identity", status: r.ok ? "PASS" : "FAIL" });
}

// 5. snapshot freshness (only when .pfdsl files changed)
if (pfdslFiles.length === 0) {
	results.push({ name: "snapshot freshness", status: "SKIP", detail: "no .pfdsl changes" });
} else {
	trySh("pnpm --filter @pfdsl/core exec vitest run -u");
	const r = trySh("git diff --quiet -- packages/core/src/__snapshots__/");
	results.push({
		name: "snapshot freshness",
		status: r.ok ? "PASS" : "FAIL",
		detail: r.ok ? undefined : "snapshots stale; re-stage packages/core/src/__snapshots__/",
	});
}

// 6. output artifact status update in .pfdsl/roadmap.pfdsl
// Presence check only (some status: line changed) — it does not verify
// that the changed line belongs to *this* cycle's output artifact.
{
	const diffText = sh(`git diff ${base}...HEAD -- .pfdsl/roadmap.pfdsl`);
	const changed = hasStatusChange(diffText);
	results.push({
		name: "output artifact status update",
		status: changed ? "PASS" : "FAIL",
		detail: changed ? undefined : "no status: line changed in .pfdsl/roadmap.pfdsl",
	});
}

console.log("gate-check:");
console.log(formatGateTable(results));
console.log("\nMANUAL (judge and confirm each):");
for (const item of MANUAL_ITEMS) console.log(`  MANUAL: ${item}`);

const hasFail = results.some((r) => r.status === "FAIL");
if (hasFail) process.exit(1);

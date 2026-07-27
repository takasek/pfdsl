#!/usr/bin/env node
// Terminal-gate aggregate checker: runs the mechanically-verifiable items
// from pfd-ops step 3 (check / audit-issues-flow / check-md-linebreaks /
// gen-plugin identity / snapshot freshness / output-artifact status update)
// against the diff from origin/<base> to HEAD, then prints the remaining
// checklist items (extracted from the work-cycle checklist itself) as
// MANUAL: lines.
// Usage: node scripts/gate-check.mjs [--base main] [--artifact <key>]

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	extractGateChecklist,
	deriveManualItems,
	matchesTrigger,
	formatGateTable,
	hasStatusChange,
	statusChangedForArtifact,
	classifyOutputArtifactStatus,
	GATE_CHECKLIST_SOURCE_PATH,
	VSCODE_EXT_TRIGGER,
	lintCommitSubjects,
	wipTransitionDetected,
	parseAuditTerminals,
	diffNewTerminals,
	diffReadySets,
	classifyAuditIssuesFlowResult,
} from "./lib/gate-check.mjs";
import { GEN_PLUGIN_TRIGGER } from "./lib/gen-plugin-trigger.mjs";
import { GEN_INSTALL_TRIGGER } from "./lib/gen-install-trigger.mjs";
import { tryRun } from "./lib/run-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => {
	const idx = args.indexOf(name);
	return idx >= 0 ? args[idx + 1] : undefined;
};
const base = flag("--base") ?? "main";
const artifactKey = flag("--artifact");

// Every call names the executable and its arguments separately — `base` and
// `artifactKey` come from argv and must never be parsed by a shell (#572).
const exec = (file, execArgs, input) => tryRun(file, execArgs, { cwd: root, ...(input === undefined ? {} : { input }) });
const node = (execArgs, input) => exec(process.execPath, execArgs, input);

// Best-effort — a stale/missing origin ref surfaces as a clear diff failure below.
exec("git", ["fetch", "origin"]);

// --diff-filter=d excludes deleted paths — a deleted .pfdsl/.md would
// otherwise fail the check/linebreaks gates against a file that no longer exists.
const diffFiles = exec("git", ["diff", "--diff-filter=d", "--name-only", `origin/${base}...HEAD`]);
if (!diffFiles.ok) {
	console.error(`gate-check: failed to diff against origin/${base}: ${diffFiles.out.trim()}`);
	process.exit(1);
}
const changedFiles = diffFiles.out.trim().split("\n").filter(Boolean);
const pfdslFiles = changedFiles.filter((f) => f.endsWith(".pfdsl"));
const mdFiles = changedFiles.filter((f) => f.endsWith(".md"));

const results = [];

// 1. pfdsl check on changed .pfdsl files
if (pfdslFiles.length === 0) {
	results.push({ name: "pfdsl check", status: "SKIP", detail: "no .pfdsl changes" });
} else {
	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	if (!existsSync(cliPath)) {
		results.push({
			name: "pfdsl check",
			status: "FAIL",
			detail: "packages/cli/dist/cli.js not built; run 'pnpm -r build' first",
		});
	} else {
		const failed = pfdslFiles.filter((f) => !node([cliPath, "check", f]).ok);
		results.push({
			name: "pfdsl check",
			status: failed.length === 0 ? "PASS" : "FAIL",
			detail: failed.length === 0 ? `${pfdslFiles.length} file(s)` : `failed: ${failed.join(", ")}`,
		});
	}
}

// 2. audit-issues-flow (no --fix: fails if manual findings remain)
{
	const r = node(["scripts/pfdsl/audit-issues-flow.mjs"]);
	results.push({ name: "audit-issues-flow", ...classifyAuditIssuesFlowResult(r.ok, r.status) });
}

// 3. check-md-linebreaks on changed .md files
if (mdFiles.length === 0) {
	results.push({ name: "check-md-linebreaks", status: "SKIP", detail: "no .md changes" });
} else {
	const r = node(["scripts/check-md-linebreaks.mjs", ...mdFiles]);
	results.push({ name: "check-md-linebreaks", status: r.ok ? "PASS" : "FAIL" });
}

// 4. gen-plugin identity (only when skill/plugin/install-source paths changed).
// GEN_INSTALL_TRIGGER is consulted too: install/ is generated from repo-root
// sources (#547) that GEN_PLUGIN_TRIGGER doesn't match, so a PR editing only a
// template source (e.g. scripts/pfdsl/lib/*.mjs) would otherwise report SKIP
// while in fact owing install/ and plugin/ churn. gen-plugin.mjs runs
// gen-install internally, so one regeneration covers both hops — hence both
// output trees are diffed.
if (!matchesTrigger(changedFiles, GEN_PLUGIN_TRIGGER) && !matchesTrigger(changedFiles, GEN_INSTALL_TRIGGER)) {
	results.push({ name: "gen-plugin identity", status: "SKIP", detail: "no skill/plugin/install-source changes" });
} else {
	const regenerated = node(["scripts/gen-plugin.mjs"]);
	const clean = regenerated.ok && exec("git", ["diff", "--exit-code", "--", "plugin", ".claude/skills/pfd-ops/install"]).ok;
	results.push({ name: "gen-plugin identity", status: clean ? "PASS" : "FAIL" });
}

// 5. snapshot freshness (only when .pfdsl files changed)
if (pfdslFiles.length === 0) {
	results.push({ name: "snapshot freshness", status: "SKIP", detail: "no .pfdsl changes" });
} else {
	const vitestRun = exec("pnpm", ["--filter", "@pfdsl/core", "exec", "vitest", "run", "-u"]);
	if (!vitestRun.ok) {
		results.push({
			name: "snapshot freshness",
			status: "FAIL",
			detail: `vitest run failed: ${vitestRun.out.trim().slice(-200)}`,
		});
	} else {
		const r = exec("git", ["diff", "--quiet", "--", "packages/core/src/__snapshots__/"]);
		results.push({
			name: "snapshot freshness",
			status: r.ok ? "PASS" : "FAIL",
			detail: r.ok ? undefined : "snapshots stale; re-stage packages/core/src/__snapshots__/",
		});
	}
}

// 6. output artifact status update in .pfdsl/roadmap.pfdsl
{
	const roadmapChanged = changedFiles.includes(".pfdsl/roadmap.pfdsl");
	if (!artifactKey && !roadmapChanged) {
		results.push({
			name: "output artifact status update",
			...classifyOutputArtifactStatus({ artifactKey, roadmapChanged }),
		});
	} else if (artifactKey) {
		const before = exec("git", ["show", `origin/${base}:.pfdsl/roadmap.pfdsl`]);
		const after = exec("git", ["show", "HEAD:.pfdsl/roadmap.pfdsl"]);
		if (!before.ok || !after.ok) {
			results.push({
				name: "output artifact status update",
				status: "FAIL",
				detail: `could not read .pfdsl/roadmap.pfdsl at origin/${base} or HEAD`,
			});
		} else {
			const changed = statusChangedForArtifact(before.out, after.out, artifactKey);
			results.push({
				name: "output artifact status update",
				...classifyOutputArtifactStatus({ artifactKey, changed }),
			});
		}
	} else {
		const diffResult = exec("git", ["diff", `origin/${base}...HEAD`, "--", ".pfdsl/roadmap.pfdsl"]);
		if (!diffResult.ok) {
			results.push({ name: "output artifact status update", status: "FAIL", detail: diffResult.out.trim() });
		} else {
			const changed = hasStatusChange(diffResult.out);
			results.push({
				name: "output artifact status update",
				...classifyOutputArtifactStatus({ artifactKey, roadmapChanged, changed }),
			});
		}
	}
}

// 7. vscode-extension typecheck (only when packages/vscode-extension/ changed)
if (!matchesTrigger(changedFiles, VSCODE_EXT_TRIGGER)) {
	results.push({ name: "vscode-extension typecheck", status: "SKIP", detail: "no vscode-extension changes" });
} else {
	const r = exec("pnpm", ["--filter", "@pfdsl/vscode-extension", "typecheck"]);
	results.push({
		name: "vscode-extension typecheck",
		status: r.ok ? "PASS" : "FAIL",
		detail: r.ok ? undefined : r.out.trim().slice(-200),
	});
}

// 8. commit subject lint (Conventional Commits message format; granularity stays MANUAL)
{
	const subjectsOut = exec("git", ["log", `origin/${base}..HEAD`, "--format=%s"]);
	if (!subjectsOut.ok) {
		results.push({ name: "commit subject lint", status: "FAIL", detail: subjectsOut.out.trim() });
	} else {
		const subjects = subjectsOut.out.trim().split("\n").filter(Boolean);
		if (subjects.length === 0) {
			results.push({ name: "commit subject lint", status: "SKIP", detail: "no commits in range" });
		} else {
			const linted = lintCommitSubjects(subjects);
			const failed = linted.filter((r) => !r.ok);
			results.push({
				name: "commit subject lint",
				status: failed.length === 0 ? "PASS" : "FAIL",
				detail: failed.length === 0 ? `${subjects.length} commit(s)` : `not Conventional Commits: ${failed.map((r) => r.subject).join(", ")}`,
			});
		}
	}
}

// 9. wip transition verification (todo→wip at start, protocol4) in .pfdsl/roadmap.pfdsl
if (!changedFiles.includes(".pfdsl/roadmap.pfdsl")) {
	results.push({ name: "wip transition", status: "SKIP", detail: "no .pfdsl/roadmap.pfdsl changes" });
} else {
	const shasOut = exec("git", ["log", "--format=%H", `origin/${base}..HEAD`, "--", ".pfdsl/roadmap.pfdsl"]);
	if (!shasOut.ok) {
		results.push({ name: "wip transition", status: "FAIL", detail: shasOut.out.trim() });
	} else {
		const shas = shasOut.out.trim().split("\n").filter(Boolean);
		const snapshots = shas
			.map((sha) => exec("git", ["show", `${sha}:.pfdsl/roadmap.pfdsl`]))
			.filter((r) => r.ok)
			.map((r) => r.out);
		const detected = wipTransitionDetected(snapshots, artifactKey);
		results.push({
			name: "wip transition",
			status: detected ? "PASS" : "FAIL",
			detail: detected
				? artifactKey
					? `wip found for '${artifactKey}'`
					: "presence-only check; pass --artifact <key> to verify the specific output artifact"
				: artifactKey
					? `no status: wip snapshot found for artifact '${artifactKey}'`
					: "no status: wip found in any commit snapshot",
		});
	}
}

const skillMdPath = resolve(root, GATE_CHECKLIST_SOURCE_PATH);
const manualItems = deriveManualItems(extractGateChecklist(readFileSync(skillMdPath, "utf-8")));

console.log("gate-check:");
console.log(formatGateTable(results));

// Report material: new terminal artifacts per changed .pfdsl file (protocol5(b)
// follow-up gatekeeper). Extraction+diff is mechanized; classifying each as
// means vs. deliverable, and registering a todo consumer if missing, stays MANUAL.
{
	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	if (pfdslFiles.length > 0 && existsSync(cliPath)) {
		const newTerminalsByFile = [];
		for (const f of pfdslFiles) {
			const before = exec("git", ["show", `origin/${base}:${f}`]);
			const after = exec("git", ["show", `HEAD:${f}`]);
			if (!after.ok) continue;
			const beforeAudit = before.ok ? node([cliPath, "graph", "io", "-"], before.out) : { ok: true, out: "" };
			const afterAudit = node([cliPath, "graph", "io", "-"], after.out);
			if (!afterAudit.ok) continue;
			const newTerminals = diffNewTerminals(
				beforeAudit.ok ? parseAuditTerminals(beforeAudit.out) : [],
				parseAuditTerminals(afterAudit.out),
			);
			if (newTerminals.length > 0) newTerminalsByFile.push({ file: f, newTerminals });
		}
		if (newTerminalsByFile.length > 0) {
			console.log("\nNew terminal artifacts (classify means vs. deliverable; register todo consumer if missing):");
			for (const { file, newTerminals } of newTerminalsByFile) {
				console.log(`  ${file}: ${newTerminals.join(", ")}`);
			}
		}
	}
}

// Report material: ready-set diff for .pfdsl/roadmap.pfdsl (workcycle step 4's
// "released follow-up processes / updated ready set" report), derived from two
// `status ready --json` runs instead of AI graph traversal.
{
	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	if (changedFiles.includes(".pfdsl/roadmap.pfdsl") && existsSync(cliPath)) {
		const before = exec("git", ["show", `origin/${base}:.pfdsl/roadmap.pfdsl`]);
		const after = exec("git", ["show", "HEAD:.pfdsl/roadmap.pfdsl"]);
		if (before.ok && after.ok) {
			const beforeReady = node([cliPath, "status", "ready", "-", "--json"], before.out);
			const afterReady = node([cliPath, "status", "ready", "-", "--json"], after.out);
			if (beforeReady.ok && afterReady.ok) {
				const beforeIds = JSON.parse(beforeReady.out).ready.map((p) => p.id);
				const afterIds = JSON.parse(afterReady.out).ready.map((p) => p.id);
				const { newlyReady, noLongerReady } = diffReadySets(beforeIds, afterIds);
				console.log(`\nReady-set diff (origin/${base} → HEAD):`);
				console.log(`  newly ready: ${newlyReady.length > 0 ? newlyReady.join(", ") : "(none)"}`);
				console.log(`  no longer ready: ${noLongerReady.length > 0 ? noLongerReady.join(", ") : "(none)"}`);
			}
		}
	}
}

console.log("\nMANUAL (judge and confirm each):");
for (const item of manualItems) console.log(`  MANUAL: ${item}`);

const hasFail = results.some((r) => r.status === "FAIL");
if (hasFail) process.exit(1);

#!/usr/bin/env node
// Terminal-gate aggregate checker: runs the mechanically-verifiable items
// from pfd-ops step 3 (check / audit-issues-flow / check-md-linebreaks /
// gen-plugin identity / snapshot freshness / output-artifact status update)
// against the diff from origin/<base> to HEAD, then prints the remaining
// checklist items (extracted from the work-cycle checklist itself) as
// MANUAL: lines.
// Usage: node scripts/gate-check.mjs [--base main] [--artifact <key> | --no-artifact] [--issue <n> ...]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	buildSiblingConsumedMap,
	classifyAuditIssuesFlowResult,
	classifyChangedFilesByModeling,
	classifyIssueLookupFailure,
	collectModeledLocations,
	deriveManualItems,
	derivePackageLayers,
	diffNewTerminals,
	diffReadySets,
	extractGateChecklist,
	formatGateTable,
	formatRunTreeLine,
	formatSizeDelta,
	GATE_CHECKLIST_SOURCE_PATH,
	hasSizeOverride,
	matchesTrigger,
	parseAuditExternalTerminals,
	parseAuditTerminals,
	parseInputConsumedArtifacts,
	partitionManualItemsByPhase,
	partitionNewTerminals,
	sharesSiblingIdNamespace,
	VSCODE_EXT_TRIGGER,
} from "./lib/gate-check.mjs";
import {
	analyzeAdoptedPfdsl,
	changedFilesSince,
	checkDocsStep,
	collectCycleWindow,
	collectSizeDeltas,
	commitMessagesSince,
	commitSubjectStep,
	deletedFilesSince,
	designRecordStep,
	fetchDesignRecordEditInfo,
	genPluginIdentityStep,
	outputArtifactStatusStep,
	perIssueSteps,
	reviewRecordStep,
	sizeDirectionStep,
	wipTransitionStep,
} from "./lib/gate-check-steps.mjs";
import { parseIssueNumbers } from "./lib/issue-args.mjs";
import { tryRun } from "./lib/run-exec.mjs";
import { execGh } from "./pfdsl/lib/gh-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// strict parsing, not an indexOf sweep: a hand-rolled lookup drops the
// --artifact=key form and any typo'd flag, and this script's response to a
// missing --artifact is to downgrade to a coarse audit and report PASS — the
// caller is told nothing (#648).
let values;
try {
	({ values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			base: { type: "string" },
			artifact: { type: "string" },
			"no-artifact": { type: "boolean" },
			issue: { type: "string", multiple: true },
		},
		strict: true,
		allowPositionals: false,
	}));
} catch (err) {
	console.error(`gate-check: ${err.message}`);
	process.exit(2);
}
const base = values.base ?? "main";
const artifactKey = values.artifact;
// Declared, not inferred: a bookkeeping cycle touches roadmap.pfdsl without
// owning an output artifact, and the diff cannot tell that apart from a cycle
// that forgot its status update (#564).
const noArtifact = values["no-artifact"] === true;
if (noArtifact && artifactKey) {
	console.error(
		"gate-check: --artifact and --no-artifact are mutually exclusive",
	);
	process.exit(2);
}
// Optional and repeatable: powers the design-selection-record and size-direction
// checks (#669), which need the linked issue to read from. Without it those
// checks SKIP rather than guess which issue the cycle belongs to. Every issue
// the cycle closes belongs here — judging one of them and reporting a single
// verdict is what let a cycle turn green on the one issue that happened to have
// a record (#734). A value that is not an issue number is refused here, not
// coerced: NaN reaches gh and comes back as that issue's checks being
// unavailable, which reads as a tool outage rather than a typo (#745).
const parsedIssues = parseIssueNumbers(values.issue);
if (!parsedIssues.ok) {
	console.error(`gate-check: ${parsedIssues.message}`);
	process.exit(2);
}
const issueNumbers = parsedIssues.numbers;

// Every call names the executable and its arguments separately — `base` and
// `artifactKey` come from argv and must never be parsed by a shell (#572).
const exec = (file, execArgs, input) =>
	tryRun(file, execArgs, {
		cwd: root,
		...(input === undefined ? {} : { input }),
	});
const node = (execArgs, input) => exec(process.execPath, execArgs, input);

// Best-effort — a stale/missing origin ref surfaces as a clear diff failure below.
exec("git", ["fetch", "origin"]);

const diff = changedFilesSince({ exec, base });
if (!diff.ok) {
	console.error(
		`gate-check: failed to diff against origin/${base}: ${diff.error}`,
	);
	process.exit(1);
}
const changedFiles = diff.files;
const pfdslFiles = changedFiles.filter((f) => f.endsWith(".pfdsl"));
const mdFiles = changedFiles.filter((f) => f.endsWith(".md"));

const results = [];

// 1. pfdsl check on changed .pfdsl files
if (pfdslFiles.length === 0) {
	results.push({
		name: "pfdsl check",
		status: "SKIP",
		detail: "no .pfdsl changes",
	});
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
			detail:
				failed.length === 0
					? `${pfdslFiles.length} file(s)`
					: `failed: ${failed.join(", ")}`,
		});
	}
}

// 2. audit-issues-flow (no --fix: fails if manual findings remain)
{
	const r = node(["scripts/pfdsl/audit-issues-flow.mjs"]);
	results.push({
		name: "audit-issues-flow",
		...classifyAuditIssuesFlowResult(r.ok, r.status),
	});
}

// 3. check-md-linebreaks on changed .md files
if (mdFiles.length === 0) {
	results.push({
		name: "check-md-linebreaks",
		status: "SKIP",
		detail: "no .md changes",
	});
} else {
	const r = node(["scripts/check-md-linebreaks.mjs", ...mdFiles]);
	results.push({ name: "check-md-linebreaks", status: r.ok ? "PASS" : "FAIL" });
}

// 3b. check-docs: the whole documentation/prose check suite CI runs, as one
// step (#721). Unconditional — it is whole-repo by construction, and at ~4s it
// costs less than the two steps below it.
results.push(checkDocsStep({ exec }));

// 4. gen-plugin identity (only when skill/plugin/install-source paths changed)
results.push(genPluginIdentityStep({ exec, node, changedFiles }));

// 5. snapshot freshness (only when .pfdsl files changed)
if (pfdslFiles.length === 0) {
	results.push({
		name: "snapshot freshness",
		status: "SKIP",
		detail: "no .pfdsl changes",
	});
} else {
	const vitestRun = exec("pnpm", [
		"--filter",
		"@pfdsl/core",
		"exec",
		"vitest",
		"run",
		"-u",
	]);
	if (!vitestRun.ok) {
		results.push({
			name: "snapshot freshness",
			status: "FAIL",
			detail: `vitest run failed: ${vitestRun.out.trim().slice(-200)}`,
		});
	} else {
		const r = exec("git", [
			"diff",
			"--quiet",
			"--",
			"packages/core/src/__snapshots__/",
		]);
		results.push({
			name: "snapshot freshness",
			status: r.ok ? "PASS" : "FAIL",
			detail: r.ok
				? undefined
				: "snapshots stale; re-stage packages/core/src/__snapshots__/",
		});
	}
}

// 6. output artifact status update in .pfdsl/roadmap.pfdsl
results.push(
	outputArtifactStatusStep({
		exec,
		base,
		artifactKey,
		noArtifact,
		changedFiles,
	}),
);

// 7. vscode-extension typecheck (only when packages/vscode-extension/ changed)
if (!matchesTrigger(changedFiles, VSCODE_EXT_TRIGGER)) {
	results.push({
		name: "vscode-extension typecheck",
		status: "SKIP",
		detail: "no vscode-extension changes",
	});
} else {
	const r = exec("pnpm", ["--filter", "@pfdsl/vscode-extension", "typecheck"]);
	results.push({
		name: "vscode-extension typecheck",
		status: r.ok ? "PASS" : "FAIL",
		detail: r.ok ? undefined : r.out.trim().slice(-200),
	});
}

// 8. commit subject lint (Conventional Commits message format and language;
// granularity stays MANUAL)
results.push(commitSubjectStep({ exec, base }));

// Every trailer-borne declaration reads this, so it is fetched once.
const commitMessages = commitMessagesSince({ exec, base });

// The linked issues, fetched once each for the two checks that read them.
// execGh keeps the REST fallback that a bare `gh` call would lose in
// environments without the binary (#489/#492). Only that environment degrades
// the issue's checks to SKIP — every other failure FAILs, because the check did
// not run and a SKIP row is one nobody acts on (#745). Either way the other
// issues stay judged on their own.
const issues = [];
for (const number of issueNumbers) {
	try {
		const issue = JSON.parse(
			await execGh(
				["issue", "view", String(number), "--json", "body,comments,createdAt"],
				{ cwd: root },
			),
		);
		// The edit-history fetch (#737 案2) is a separate lookup from the one
		// above and fails independently: a failure here only costs edit
		// detection, never the row itself — timing still judges on createdAt
		// alone, same as before this check existed.
		const editInfo = await fetchDesignRecordEditInfo({
			exec,
			execGh,
			cwd: root,
			number,
		}).catch(() => null);
		issues.push({ number, issue, editInfo });
	} catch (e) {
		issues.push({
			number,
			issue: null,
			issueFailure: classifyIssueLookupFailure(e),
			editInfo: null,
		});
	}
}

// 8b. Review record: judged before the PR, because the trailer lives in a
// commit message and cannot be added afterwards (#698).
results.push(reviewRecordStep({ commitMessages, changedFiles }));

// 9. wip transition verification (todo→wip at start, protocol4) in .pfdsl/roadmap.pfdsl
results.push(
	wipTransitionStep({ exec, base, artifactKey, noArtifact, changedFiles }),
);

// 10. design-selection record: was the design choice recorded before the first commit,
// with the required structure (#669)? One row per issue the cycle closes (#734).
results.push(...perIssueSteps(designRecordStep, issues, { exec, base }));

// 11. knowledge-artifact size direction: did tracked knowledge artifacts grow
// without an explicit override, on a cycle whose linked issue declares one (#669)?
// The deltas are collected regardless — they are printed as report material below,
// so a cycle that never declared an intent still shows its numbers. Collected here
// rather than inside the step because two consumers need the same measurement; the
// roadmap-based blocks below still read the file per block, which is the older
// convention and stays until something needs them shared too.
const sizeDeltas = collectSizeDeltas({ exec, base, changedFiles });

// Size-Override rides in a commit trailer (#775). The branch's own messages
// are always readable here, which is what the PR body never was: the gate runs
// before the PR exists, so the lookup it replaced spent most of its life
// reporting that it could not run.
const overrideDeclared = hasSizeOverride(commitMessages.text);
results.push(
	...perIssueSteps(sizeDirectionStep, issues, {
		deltas: sizeDeltas,
		overrideDeclared,
	}),
);

const skillMdPath = resolve(root, GATE_CHECKLIST_SOURCE_PATH);
const manualItems = deriveManualItems(
	extractGateChecklist(readFileSync(skillMdPath, "utf-8")),
);

// `root` here is this script's own location (resolved from import.meta.url
// above), not the shell's cwd. gate-check's PreToolUse guard
// (verification-tree-guard.mjs) already stops most cwd-drifted runs before
// they start, but a run that slips past it (e.g. inside a subagent) still
// needs to be checkable after the fact — and it is only checkable if the
// tree named here is the one gate-check actually inspected, not wherever the
// invoking shell happened to be sitting (#840).
const mainRootLookup = exec("git", ["rev-parse", "--git-common-dir"]);
const branchLookup = exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
// Either lookup failing (e.g. no git on PATH) must not stop the gate itself
// — only this report line degrades, to a null-branch/root-as-mainRoot line
// via formatRunTreeLine, same as verification-tree-guard.mjs's own read of a
// failed git call as "cannot tell".
const mainRoot = mainRootLookup.ok
	? dirname(resolve(root, mainRootLookup.out.trim()))
	: root;
const resolvedBranch = branchLookup.ok ? branchLookup.out.trim() : null;
// A detached HEAD prints the literal string "HEAD" here, which is not a
// branch name.
const branch =
	resolvedBranch && resolvedBranch !== "HEAD" ? resolvedBranch : null;
console.log(formatRunTreeLine({ root, mainRoot, branch }));

console.log("gate-check:");
console.log(formatGateTable(results));

// Report material: new terminal artifacts per changed .pfdsl file (protocol5(b)
// follow-up gatekeeper). Extraction+diff is mechanized; classifying each as
// means vs. deliverable, and registering a todo consumer if missing, stays MANUAL.
{
	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	if (pfdslFiles.length > 0 && existsSync(cliPath)) {
		// Artifacts consumed by the *other* .pfdsl files sitting in the same
		// directory, at HEAD (#671). ADR-0035 split the graphs by judgment axis,
		// which leaves a generation source declared in one file and consumed in
		// its sibling; `graph io` runs per file and cannot see across. Composing
		// the sets here rather than in the CLI is deliberate — spec §2.9.1 keeps
		// ids file-local and forbids a flattened cross-file view, so "same id
		// means the same artifact" is a local convention of this repo's .pfdsl/,
		// which runtime-pipeline.md already declares out of modeling scope. Which
		// directories that convention covers is SIBLING_ID_NAMESPACE_DIRS' job;
		// this function only does the git + CLI I/O around it.
		const siblingConsumedByDir = new Map();
		const siblingConsumedFor = (file) => {
			const dir = dirname(file);
			if (!sharesSiblingIdNamespace(dir)) return [];
			const cached = siblingConsumedByDir.get(dir);
			if (cached) return cached.get(file) ?? [];
			const listing = exec("git", [
				"ls-tree",
				"--name-only",
				"HEAD",
				"--",
				`${dir}/`,
			]);
			const dirFiles = listing.ok
				? listing.out
						.split("\n")
						.map((l) => l.trim())
						.filter((l) => l.endsWith(".pfdsl"))
				: [];
			const perFile = new Map();
			for (const sib of dirFiles) {
				const src = exec("git", ["show", `HEAD:${sib}`]);
				if (!src.ok) continue;
				const edges = node([cliPath, "graph", "edges", "-", "--json"], src.out);
				if (!edges.ok) continue;
				perFile.set(sib, parseInputConsumedArtifacts(edges.out));
			}
			const byTarget = buildSiblingConsumedMap(perFile);
			siblingConsumedByDir.set(dir, byTarget);
			return byTarget.get(file) ?? [];
		};

		// One entry per audit category `graph io` reports. Adding a third is a row
		// in `parsedReports`, not a further copy of the collect-and-print pair.
		const terminalsReport = {
			parse: parseAuditTerminals,
			heading:
				"New terminal artifacts (classify means vs. deliverable; register todo consumer if missing)",
			byFile: [],
		};
		const externalTerminalsReport = {
			parse: parseAuditExternalTerminals,
			heading:
				"New external-stakeholder terminal artifacts (verify each has a genuine external consumer, not a mistakenly-tagged means artifact)",
			byFile: [],
		};
		const parsedReports = [terminalsReport, externalTerminalsReport];
		// Not an audit category of its own: `graph io` never reports it. The
		// terminals split fills it, so it is kept out of the collect loop and
		// only joins for printing.
		const siblingConsumedReport = {
			heading:
				"New terminal artifacts consumed in a sibling graph (confirm the sibling's input edge exists, then record N/A — do NOT add a todo consumer, that recreates the double modeling ADR-0035 removed)",
			byFile: [],
		};
		for (const f of pfdslFiles) {
			const before = exec("git", ["show", `origin/${base}:${f}`]);
			const after = exec("git", ["show", `HEAD:${f}`]);
			if (!after.ok) continue;
			const beforeAudit = before.ok
				? node([cliPath, "graph", "io", "-"], before.out)
				: { ok: true, out: "" };
			const afterAudit = node([cliPath, "graph", "io", "-"], after.out);
			if (!afterAudit.ok) continue;
			for (const report of parsedReports) {
				const added = diffNewTerminals(
					beforeAudit.ok ? report.parse(beforeAudit.out) : [],
					report.parse(afterAudit.out),
				);
				if (added.length === 0) continue;
				if (report !== terminalsReport) {
					report.byFile.push({ file: f, added });
					continue;
				}
				const split = partitionNewTerminals(added, siblingConsumedFor(f));
				if (split.terminal.length > 0) {
					report.byFile.push({ file: f, added: split.terminal });
				}
				if (split.consumedInSibling.length > 0) {
					siblingConsumedReport.byFile.push({
						file: f,
						added: split.consumedInSibling,
					});
				}
			}
		}
		for (const { heading, byFile } of [
			terminalsReport,
			siblingConsumedReport,
			externalTerminalsReport,
		]) {
			if (byFile.length === 0) continue;
			console.log(`\n${heading}:`);
			for (const { file, added } of byFile) {
				console.log(`  ${file}: ${added.join(", ")}`);
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
			const beforeReady = node(
				[cliPath, "status", "ready", "-", "--json"],
				before.out,
			);
			const afterReady = node(
				[cliPath, "status", "ready", "-", "--json"],
				after.out,
			);
			if (beforeReady.ok && afterReady.ok) {
				const beforeIds = JSON.parse(beforeReady.out).ready.map((p) => p.id);
				const afterIds = JSON.parse(afterReady.out).ready.map((p) => p.id);
				const { newlyReady, noLongerReady } = diffReadySets(
					beforeIds,
					afterIds,
				);
				console.log(`\nReady-set diff (origin/${base} → HEAD):`);
				console.log(
					`  newly ready: ${newlyReady.length > 0 ? newlyReady.join(", ") : "(none)"}`,
				);
				console.log(
					`  no longer ready: ${noLongerReady.length > 0 ? noLongerReady.join(", ") : "(none)"}`,
				);
			}
		}
	}
}

// Report material: the size of every tracked knowledge artifact this branch
// touched. Printed whether or not the linked issue declared a shrink intent —
// the verdict is gated on the declaration, the numbers are not, so the cycle
// that forgot the token still has something to put in the PR body.
if (sizeDeltas.length > 0) {
	console.log(`\nKnowledge-artifact size (origin/${base} → HEAD):`);
	for (const d of sizeDeltas) console.log(`  ${formatSizeDelta(d)}`);
}

// Report material: the cycle window (#834), which collectCycleWindow's own doc
// comment defines and motivates. Not a verdict — it hands the runner a starting
// point for re-reading what the cycle wrote outside the repo (issue bodies,
// comments, PR bodies) against conventions base may have retired since, and
// `git rebase` fixes the tree, not those.
//
// Printed unconditionally, including the empty case: an empty window is itself
// the record work-cycle.md's terminal-gate step asks for ("窓が空だったなら1行
// そう記録する"). A failed measurement says so out loud, unlike the report
// blocks above that fall silent — silence here is indistinguishable from the
// empty window, which is the reading #834 exists to stop.
{
	const window = collectCycleWindow({ exec, base });
	console.log(
		"\nCycle window (base commits this tree lacked, or that landed after its first commit):",
	);
	if (!window.ok) {
		console.log(`  could not be measured: ${window.error}`);
	} else if (window.entries.length === 0) {
		console.log("  (none)");
	} else {
		for (const { sha, subject } of window.entries) {
			console.log(`  ${sha} ${subject}`);
		}
	}
	if (window.note) console.log(`  (${window.note})`);
}

// Report material: the package layers the diff touched, for the PR body. Not a
// verdict — the diff already is the answer, so there is nothing for the runner
// to get wrong and nothing for a gate to catch (#801).
{
	const layers = derivePackageLayers(changedFiles);
	if (layers.length > 0) {
		console.log(`\nPackage layers touched: ${layers.join(", ")}`);
	}
}

// Report material: which of this cycle's changed files any adopted PFD claims
// to model — see collectModeledLocations in lib/gate-check.mjs for why (#778).
// Which side a given path belongs on, and whether an unmodeled one should have
// been in a PFD at all, both stay the reader's call.
{
	const corePath = resolve(root, "packages/core/dist/index.js");
	console.log("\nChanged files vs. the adopted PFDs' `location:` fields:");
	if (!existsSync(corePath)) {
		console.log(
			"  could not be measured: packages/core/dist not built (run 'pnpm -r build')",
		);
	} else {
		// The same pair the CLI applies to a `location:` element (spec §15.8),
		// so this report and `meta get` cannot disagree about where a node lives.
		const { analyze, isUrlLike, resolveLocationFsPath } = await import(
			corePath
		);
		const { analyzed, unreadable } = analyzeAdoptedPfdsl({
			readdirSync: (dir) => readdirSync(resolve(root, dir)),
			readFile: (file) => readFileSync(resolve(root, file), "utf-8"),
			analyze,
		});
		const resolveLocation = (file, location, basePath) =>
			isUrlLike(location)
				? null
				: relative(
						root,
						resolveLocationFsPath(resolve(root, file), location, basePath),
					);
		// Deletions are in scope here even though every other gate excludes
		// them: the item asks about additions, changes and deletions alike, and
		// a deleted file is the case where the PFD modeling it is likeliest to
		// be left describing something gone.
		const deletedFiles = deletedFilesSince({ exec, base });
		const wasDeleted = new Set(deletedFiles);
		const { modeled, unmodeled } = classifyChangedFilesByModeling(
			[...changedFiles, ...deletedFiles],
			collectModeledLocations(analyzed, resolveLocation),
		);
		const mark = (path) => (wasDeleted.has(path) ? `${path} (deleted)` : path);
		console.log("  modeled (confirm the PFD reflects the change):");
		if (modeled.length === 0) console.log("    (none)");
		for (const { path, models } of modeled) {
			const by = models.map((m) => `${m.file}:${m.id}`).join(", ");
			console.log(`    ${mark(path)} ← ${by}`);
		}
		console.log(
			"  not modeled by any adopted PFD (an N/A here is out-of-scope, not a judgment):",
		);
		if (unmodeled.length === 0) console.log("    (none)");
		for (const path of unmodeled) console.log(`    ${mark(path)}`);
		for (const reason of unreadable) console.log(`  could not read ${reason}`);
	}
}

{
	const { beforePr, afterPr } = partitionManualItemsByPhase(manualItems);
	console.log("\nMANUAL (judge and confirm each):");
	for (const item of beforePr) console.log(`  MANUAL: ${item}`);
	if (afterPr.length > 0) {
		console.log("\nMANUAL, after the PR exists (its body is the destination):");
		for (const item of afterPr) console.log(`  MANUAL: ${item}`);
	}
}

const hasFail = results.some((r) => r.status === "FAIL");
if (hasFail) process.exit(1);

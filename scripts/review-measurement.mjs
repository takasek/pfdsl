#!/usr/bin/env node
// Aggregates the /code-review value measurement (#561) from commit trailers.
//
// Read-only and network-free: records live in commit messages, so this works
// without gh/REST and without a per-cycle write step that could be forgotten.
//
// Usage:
//   node scripts/review-measurement.mjs [--since <ref>]
//
// --since additionally audits every merge that landed on the base branch since
// the ref: a missing record, a `sample=` that contradicts the merge's own diff,
// or two records in one cycle. All three shrink or pad the denominator the rate
// depends on, so they are reported rather than passed over. A merge that cannot
// be read is listed separately and sets a non-zero exit — an unread cycle is not
// a clean one.

import {
	classifyCycle,
	FIELD_SEP,
	mergeCycleRecords,
	parseMeasurementRecords,
	parseSinceArg,
	RECORD_SEP,
	summarize,
	TARGET_SAMPLE_COUNT,
} from "./lib/review-measurement.mjs";
import {
	tryGit as sharedTryGit,
	splitNulSeparated,
	tryRun,
} from "./lib/run-exec.mjs";

// The repository being aggregated is the one the command runs in, not the one
// this file happens to live in — the tool reads history, and a checkout other
// than its own is a legitimate target (the tests build one).
const toplevel = tryRun("git", ["rev-parse", "--show-toplevel"], {
	cwd: process.cwd(),
	captureStderr: true,
});
if (!toplevel.ok) {
	console.error("review-measurement: not inside a git repository");
	process.exit(1);
}
const root = toplevel.out.trim();
const argv = parseSinceArg(process.argv.slice(2));
if (argv.error) {
	console.error(`review-measurement: ${argv.error}`);
	process.exit(2);
}
const since = argv.since;

// argv form, never a shell string: a ref is user input and reaches git verbatim.
const tryGit = (args) => sharedTryGit(args, { cwd: root });

const range = since ? `${since}..HEAD` : "HEAD";

// One cycle = one first-parent step: a merge (whose branch side carries the
// work) or a commit that landed directly. Reading records commit-wise counted
// a cycle once per review pass it recorded, which inflated the denominator the
// rate divides by — a cycle that reviewed twice is still one cycle (#561).
const stepsResult = tryGit([
	"log",
	"--first-parent",
	`--format=%H${FIELD_SEP}%P${FIELD_SEP}%s`,
	range,
]);
if (!stepsResult.ok) {
	console.error(
		`review-measurement: failed to read git log for ${range}: ${stepsResult.out.trim()}`,
	);
	process.exit(1);
}

/** @type {Array<{sha: string, subject: string, secondParent: string|undefined, records: object[]}>} */
const cycles = [];
for (const line of stepsResult.out.trim().split("\n").filter(Boolean)) {
	const [sha, parents = "", subject = ""] = line.split(FIELD_SEP);
	const secondParent = parents.trim().split(/\s+/)[1];
	// A merge's records live on its branch side; a direct commit carries its own.
	const bodies = secondParent
		? tryGit(["log", `--format=%B${RECORD_SEP}`, `${sha}^1..${sha}^2`])
		: tryGit(["log", "-1", `--format=%B${RECORD_SEP}`, sha]);
	if (!bodies.ok) continue;
	const records = parseMeasurementRecords(bodies.out);
	cycles.push({ sha, subject: subject.trim(), secondParent, records });
}

const recorded = cycles.filter((c) => c.records.length > 0);
const summary = summarize(recorded);

console.log("review-measurement:");
if (recorded.length === 0) {
	console.log("  no records yet");
} else {
	for (const c of recorded) {
		const merged = mergeCycleRecords(c.records);
		const sha = c.sha.slice(0, 7);
		const passes = c.records.length > 1 ? ` (${c.records.length} passes)` : "";
		if (merged.error) {
			console.log(`  ! ${sha} malformed — ${merged.error}`);
		} else if (merged.sample === "out") {
			console.log(`  - ${sha} out of sample${passes}`);
		} else {
			const tools =
				merged.tools.length > 0 ? ` [${merged.tools.join(", ")}]` : "";
			console.log(
				`  ${merged.new > 0 ? "*" : "·"} ${sha} new=${merged.new} adopted=${merged.adopted}${tools}${passes}`,
			);
		}
	}
}

const rate =
	summary.findingRate === null
		? "n/a (no in-sample cycles yet)"
		: `${(summary.findingRate * 100).toFixed(0)}%`;
console.log("");
console.log(
	`  in-sample cycles      ${summary.sampled} / ${TARGET_SAMPLE_COUNT} (${summary.remaining} to go)`,
);
console.log(`  out of sample         ${summary.outOfSample}`);
console.log(
	`  cycles with findings  ${summary.cyclesWithFindings}  (rate ${rate})`,
);
console.log(
	`  findings new/adopted  ${summary.totalNew} / ${summary.totalAdopted}`,
);
if (summary.malformed > 0) {
	console.log(
		`  malformed records     ${summary.malformed}  — fix these; they are not zero-finding cycles`,
	);
}

// Per review pass, not per cycle: a pooled rate measures which tool ran rather
// than what review is worth, and one cycle can run more than one tool.
const tools = Object.entries(summary.byTool);
if (tools.length > 0) {
	console.log("");
	console.log("  by review pass:");
	for (const [tool, b] of tools) {
		const toolRate =
			b.passes === 0
				? "n/a"
				: `${((b.withFindings / b.passes) * 100).toFixed(0)}%`;
		console.log(
			`    ${tool.padEnd(20)} ${b.passes} pass(es), ${b.withFindings} with findings (${toolRate}), new/adopted ${b.totalNew}/${b.totalAdopted}`,
		);
	}
}

// Missing-sample detection. Only meaningful from the point the rule took effect,
// so it needs an explicit starting ref rather than a guess.
if (!since) {
	console.log("");
	console.log(
		"  (pass --since <ref> to also report code-changing merges that carry no record)",
	);
	process.exit(0);
}

const issues = [];
// A cycle we could not read is not a clean cycle. Collected rather than skipped
// so a shallow clone cannot produce an all-green report from zero evidence.
const unreadable = [];

// The same first-parent walk the summary used, so the two views cannot disagree
// about what a cycle is or which records belong to it. Only merges carry a diff
// worth classifying; a commit that landed directly is its own trivial cycle.
for (const cycle of cycles.filter((c) => c.secondParent)) {
	const label = `${cycle.sha.slice(0, 7)} ${cycle.subject}`.trim();

	const files = tryGit([
		"diff",
		"-z",
		"--name-only",
		`${cycle.sha}^1`,
		cycle.sha,
	]);
	if (!files.ok) {
		unreadable.push(`${label} — ${files.out.trim().split("\n")[0]}`);
		continue;
	}

	const merged = mergeCycleRecords(cycle.records);
	const { issues: cycleIssues } = classifyCycle({
		changedFiles: splitNulSeparated(files.out).join("\n"),
		trailerCount: cycle.records.length,
		sample: merged?.sample,
	});
	for (const issue of cycleIssues) issues.push(`${label} — ${issue.detail}`);
}

console.log("");
if (issues.length === 0 && unreadable.length === 0) {
	console.log("  every merge since the ref carries a consistent record");
}
if (issues.length > 0) {
	console.log(`  record problems (${issues.length}):`);
	for (const i of issues) console.log(`    ${i}`);
}
if (unreadable.length > 0) {
	console.log(
		`  could not read (${unreadable.length}) — these were not checked:`,
	);
	for (const u of unreadable) console.log(`    ${u}`);
	process.exitCode = 1;
}

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

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
	RECORD_SEP,
	FIELD_SEP,
	extractMeasurements,
	summarize,
	parseMeasurementTrailer,
	TARGET_SAMPLE_COUNT,
	TRAILER_GREP,
	IN_SAMPLE_PATH,
	parseSinceArg,
	countMeasurementTrailers,
	classifyCycle,
} from "./lib/review-measurement.mjs";
import { tryGit as sharedTryGit } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = parseSinceArg(process.argv.slice(2));
if (argv.error) {
	console.error(`review-measurement: ${argv.error}`);
	process.exit(2);
}
const since = argv.since;

// argv form, never a shell string: a ref is user input and reaches git verbatim.
const tryGit = (args) => sharedTryGit(args, { cwd: root });

const range = since ? `${since}..HEAD` : "HEAD";
const logFormat = `--format=%H${FIELD_SEP}%B${RECORD_SEP}`;
// --grep lets git skip non-record commits instead of us reading all of history.
const logResult = tryGit(["log", `--grep=${TRAILER_GREP}`, logFormat, range]);
if (!logResult.ok) {
	console.error(`review-measurement: failed to read git log for ${range}: ${logResult.out.trim()}`);
	process.exit(1);
}

const records = extractMeasurements(logResult.out);
const summary = summarize(records);

console.log("review-measurement:");
if (records.length === 0) {
	console.log("  no records yet");
} else {
	for (const r of records) {
		const sha = r.sha.slice(0, 7);
		if (r.error) {
			console.log(`  ! ${sha} malformed — ${r.error}`);
		} else if (r.sample === "out") {
			console.log(`  - ${sha} out of sample${r.angles ? ` — ${r.angles}` : ""}`);
		} else {
			const angles = r.angles ? ` — ${r.angles}` : "";
			console.log(`  ${r.new > 0 ? "*" : "·"} ${sha} new=${r.new} adopted=${r.adopted}${angles}`);
		}
	}
}

const rate = summary.findingRate === null ? "n/a (no in-sample cycles yet)" : `${(summary.findingRate * 100).toFixed(0)}%`;
console.log("");
console.log(`  in-sample cycles      ${summary.sampled} / ${TARGET_SAMPLE_COUNT} (${summary.remaining} to go)`);
console.log(`  out of sample         ${summary.outOfSample}`);
console.log(`  cycles with findings  ${summary.cyclesWithFindings}  (rate ${rate})`);
console.log(`  findings new/adopted  ${summary.totalNew} / ${summary.totalAdopted}`);
if (summary.malformed > 0) {
	console.log(`  malformed records     ${summary.malformed}  — fix these; they are not zero-finding cycles`);
}

// Per tool, because a pooled rate measures which tool ran rather than what
// review is worth.
const tools = Object.entries(summary.byTool);
if (tools.length > 0) {
	console.log("");
	console.log("  by tool:");
	for (const [tool, b] of tools) {
		const toolRate = b.sampled === 0 ? "n/a" : `${((b.withFindings / b.sampled) * 100).toFixed(0)}%`;
		console.log(`    ${tool.padEnd(20)} ${b.sampled} cycle(s), ${b.withFindings} with findings (${toolRate}), new/adopted ${b.totalNew}/${b.totalAdopted}`);
	}
}

// Missing-sample detection. Only meaningful from the point the rule took effect,
// so it needs an explicit starting ref rather than a guess.
if (!since) {
	console.log("");
	console.log("  (pass --since <ref> to also report code-changing merges that carry no record)");
	process.exit(0);
}

// --first-parent keeps this to merges that landed on the base branch. Without
// it a back-merge of main into a feature branch is scanned too, and there ^1 is
// the branch tip and ^2 is main — the diff reads as main's changes and ^1..^2
// as commits already merged, so it is reported as a cycle that never existed.
const mergesResult = tryGit(["log", "--merges", "--first-parent", `--format=%H${FIELD_SEP}%s`, `${since}..HEAD`]);
if (!mergesResult.ok) {
	console.error(`review-measurement: failed to list merges since ${since}: ${mergesResult.out.trim()}`);
	process.exit(1);
}
// Subject comes from the same listing rather than a git call per merge.
const merges = mergesResult.out
	.trim()
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const [sha, subject = ""] = line.split(FIELD_SEP);
		return { sha, subject };
	});

const issues = [];
// A cycle we could not read is not a clean cycle. Collected rather than skipped
// so a shallow clone cannot produce an all-green report from zero evidence.
const unreadable = [];

for (const { sha, subject } of merges) {
	const label = `${sha.slice(0, 7)} ${subject}`.trim();

	const files = tryGit(["diff", "--name-only", `${sha}^1`, sha]);
	const bodies = tryGit(["log", "--format=%B", `${sha}^1..${sha}^2`]);
	if (!files.ok || !bodies.ok) {
		unreadable.push(`${label} — ${(files.ok ? bodies.out : files.out).trim().split("\n")[0]}`);
		continue;
	}

	const record = parseMeasurementTrailer(bodies.out);
	const { issues: cycleIssues } = classifyCycle({
		changedFiles: files.out,
		trailerCount: countMeasurementTrailers(bodies.out),
		sample: record?.sample,
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
	console.log(`  could not read (${unreadable.length}) — these were not checked:`);
	for (const u of unreadable) console.log(`    ${u}`);
	process.exitCode = 1;
}

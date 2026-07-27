#!/usr/bin/env node
// Aggregates the /code-review value measurement (#561) from commit trailers.
//
// Read-only and network-free: records live in commit messages, so this works
// without gh/REST and without a per-cycle write step that could be forgotten.
//
// Usage:
//   node scripts/review-measurement.mjs [--since <ref>]
//
// --since additionally reports merges that changed packages/ or scripts/ but
// carry no record. Those are missing samples, not zero-finding cycles, and
// silently dropping them would shrink the denominator the rate depends on.

import { execFileSync } from "node:child_process";
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
} from "./lib/review-measurement.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : undefined;

// argv form, never a shell string: a ref is user input and reaches git verbatim.
function tryGit(args) {
	try {
		return { ok: true, out: execFileSync("git", args, { cwd: root, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 }) };
	} catch (e) {
		return { ok: false, out: e.stdout || e.message };
	}
}

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

// Missing-sample detection. Only meaningful from the point the rule took effect,
// so it needs an explicit starting ref rather than a guess.
if (!since) {
	console.log("");
	console.log("  (pass --since <ref> to also report code-changing merges that carry no record)");
	process.exit(0);
}

const mergesResult = tryGit(["log", "--merges", "--format=%H", `${since}..HEAD`]);
const merges = mergesResult.ok ? mergesResult.out.trim().split("\n").filter(Boolean) : [];
const missing = [];
for (const merge of merges) {
	const files = tryGit(["diff", "--name-only", `${merge}^1`, merge]);
	if (!files.ok || !IN_SAMPLE_PATH.test(files.out)) continue;
	const bodies = tryGit(["log", "--format=%B", `${merge}^1..${merge}^2`]);
	if (bodies.ok && parseMeasurementTrailer(bodies.out)) continue;
	const subject = tryGit(["log", "-1", "--format=%s", merge]);
	missing.push(`${merge.slice(0, 7)} ${subject.ok ? subject.out.trim() : ""}`);
}

console.log("");
if (missing.length === 0) {
	console.log("  no code-changing merges are missing a record");
} else {
	console.log(`  missing records (${missing.length}) — code-changing merges with no Review-Measurement trailer:`);
	for (const m of missing) console.log(`    ${m}`);
}

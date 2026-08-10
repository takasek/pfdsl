/**
 * The gate-check steps that need to run other commands.
 *
 * gate-check.mjs itself is a top-level script: it reads argv, runs git, and
 * prints a table, so nothing inside it could be tested and its branch wiring
 * — which decides what CI accepts — was unverified (#612). Each step here
 * takes its subprocess runner as an argument, so a test supplies fake command
 * output and asserts the row that comes out. The predicates the steps call
 * (classifyOutputArtifactStatus, wipTransitionDetected, …) stay in
 * gate-check.mjs beside the rest of the pure logic.
 *
 * `exec`/`node` have the shape of lib/run-exec.mjs' tryRun: they never throw,
 * and report failure as `{ ok: false, out }`.
 */

import { RECORD_SEP } from "./commit-trailers.mjs";
import { detectEnumeratedOptions } from "./cycle-status.mjs";
import {
	classifyDesignRecordContent,
	classifyDesignRecordTiming,
	classifyOutputArtifactStatus,
	classifySizeDirection,
	hasNoImplementationDisposition,
	hasStatusChange,
	lintCommitSubjects,
	matchesTrigger,
	NO_ARTIFACT_DETAIL,
	NO_ISSUE_DETAIL,
	SIZE_TRACKED_PATTERNS,
	selectDesignRecord,
	statusChangedForArtifact,
	toDesignRecordEntries,
	wipTransitionDetected,
} from "./gate-check.mjs";
import { GEN_INSTALL_TRIGGER } from "./gen-install-trigger.mjs";
import { GEN_PLUGIN_TRIGGER } from "./gen-plugin-trigger.mjs";
import { classifyCycle, parseReviewRecords } from "./review-record.mjs";

const ROADMAP_PATH = ".pfdsl/roadmap.pfdsl";

/**
 * The branch's changed paths, three-dot against the base.
 *
 * --diff-filter=d excludes deleted paths — a deleted .pfdsl/.md would otherwise
 * fail the check/linebreaks gates against a file that no longer exists.
 * @param {{exec: Function, base: string}} params
 * @returns {{ok: boolean, files: string[], error?: string}}
 */
export function changedFilesSince({ exec, base }) {
	const r = exec("git", [
		"diff",
		"--diff-filter=d",
		"--name-only",
		`origin/${base}...HEAD`,
	]);
	if (!r.ok) return { ok: false, files: [], error: r.out.trim() };
	return { ok: true, files: r.out.trim().split("\n").filter(Boolean) };
}

/**
 * The branch's commit messages, RECORD_SEP between them — the input every
 * trailer-borne declaration is read from. Two checks want it (the review
 * record and the size override), and they have to agree about the range and
 * the separator, so the invocation lives here rather than in each of them.
 * Callers run it once and hand the result to both, rather than each step
 * spawning its own git.
 * @param {{exec: Function, base: string}} params
 * @returns {{ok: boolean, text: string, error?: string}}
 */
export function commitMessagesSince({ exec, base }) {
	const r = exec("git", [
		"log",
		"--no-merges",
		`origin/${base}..HEAD`,
		`--format=%B${RECORD_SEP}`,
	]);
	if (!r.ok) return { ok: false, text: "", error: r.out.trim() };
	return { ok: true, text: r.out };
}

/**
 * gen-plugin identity: regenerate the distributed trees and require no diff.
 *
 * GEN_INSTALL_TRIGGER is consulted too: install/ is generated from repo-root
 * sources (#547) that GEN_PLUGIN_TRIGGER doesn't match, so a PR editing only a
 * template source would otherwise report SKIP while in fact owing install/ and
 * plugin/ churn. gen-plugin.mjs runs gen-install internally, so one
 * regeneration covers both hops — hence both output trees are diffed.
 */
export function genPluginIdentityStep({ exec, node, changedFiles }) {
	const name = "gen-plugin identity";
	if (
		!matchesTrigger(changedFiles, GEN_PLUGIN_TRIGGER) &&
		!matchesTrigger(changedFiles, GEN_INSTALL_TRIGGER)
	) {
		return {
			name,
			status: "SKIP",
			detail: "no skill/plugin/install-source changes",
		};
	}
	const regenerated = node(["scripts/gen-plugin.mjs"]);
	const clean =
		regenerated.ok &&
		exec("git", [
			"diff",
			"--exit-code",
			"--",
			"plugin",
			".claude/skills/pfd-ops/install",
		]).ok;
	return { name, status: clean ? "PASS" : "FAIL" };
}

/**
 * Output artifact status update: did this cycle move its artifact's status?
 * Three ways in, and which one applies is the point of the step: a declared
 * --no-artifact cycle skips, a named artifact is checked strictly against the
 * two roadmap snapshots, and everything else falls back to "some status: line
 * moved", which is all the diff can honestly say.
 */
export function outputArtifactStatusStep({
	exec,
	base,
	artifactKey,
	noArtifact,
	changedFiles,
}) {
	const name = "output artifact status update";
	const roadmapChanged = changedFiles.includes(ROADMAP_PATH);

	if (noArtifact || (!artifactKey && !roadmapChanged)) {
		return {
			name,
			...classifyOutputArtifactStatus({
				artifactKey,
				noArtifact,
				roadmapChanged,
			}),
		};
	}

	if (artifactKey) {
		const before = exec("git", ["show", `origin/${base}:${ROADMAP_PATH}`]);
		const after = exec("git", ["show", `HEAD:${ROADMAP_PATH}`]);
		if (!before.ok || !after.ok) {
			return {
				name,
				status: "FAIL",
				detail: `could not read ${ROADMAP_PATH} at origin/${base} or HEAD`,
			};
		}
		const changed = statusChangedForArtifact(
			before.out,
			after.out,
			artifactKey,
		);
		return { name, ...classifyOutputArtifactStatus({ artifactKey, changed }) };
	}

	const diffResult = exec("git", [
		"diff",
		`origin/${base}...HEAD`,
		"--",
		ROADMAP_PATH,
	]);
	if (!diffResult.ok)
		return { name, status: "FAIL", detail: diffResult.out.trim() };
	const changed = hasStatusChange(diffResult.out);
	return {
		name,
		...classifyOutputArtifactStatus({ artifactKey, roadmapChanged, changed }),
	};
}

/**
 * wip transition: protocol 4 wants the artifact marked wip when work starts,
 * not only done at the end. Only the commits' own snapshots can show that, so
 * this walks the roadmap as each commit in the range left it.
 */
export function wipTransitionStep({
	exec,
	base,
	artifactKey,
	noArtifact,
	changedFiles,
}) {
	const name = "wip transition";
	if (noArtifact) return { name, status: "SKIP", detail: NO_ARTIFACT_DETAIL };
	if (!changedFiles.includes(ROADMAP_PATH)) {
		return { name, status: "SKIP", detail: `no ${ROADMAP_PATH} changes` };
	}

	const shasOut = exec("git", [
		"log",
		"--format=%H",
		`origin/${base}..HEAD`,
		"--",
		ROADMAP_PATH,
	]);
	if (!shasOut.ok) return { name, status: "FAIL", detail: shasOut.out.trim() };

	const snapshots = shasOut.out
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((sha) => exec("git", ["show", `${sha}:${ROADMAP_PATH}`]))
		.filter((r) => r.ok)
		.map((r) => r.out);

	const detected = wipTransitionDetected(snapshots, artifactKey);
	return {
		name,
		status: detected ? "PASS" : "FAIL",
		detail: detected
			? artifactKey
				? `wip found for '${artifactKey}'`
				: "presence-only check; pass --artifact <key> to verify the specific output artifact"
			: artifactKey
				? `no status: wip snapshot found for artifact '${artifactKey}'`
				: "no status: wip found in any commit snapshot",
	};
}

/**
 * The row for an issue the gate could not read, shared by both checks that read
 * one so they cannot disagree about what a failed lookup costs. No failure means
 * no `--issue` was given at all, which is a reasoned SKIP; a failure carries its
 * own verdict from classifyIssueLookupFailure (#745).
 * @param {{status: 'SKIP'|'FAIL', detail: string} | null | undefined} issueFailure
 * @returns {{status: 'SKIP'|'FAIL', detail: string}}
 */
function missingIssueRow(issueFailure) {
	return issueFailure ?? { status: "SKIP", detail: NO_ISSUE_DETAIL };
}

/**
 * design-selection record: was the design choice recorded before work
 * started, with the required structure (issue #669's protection against
 * "the record is written after the fact, or is unstructured prose")?
 */
export function designRecordStep({ exec, base, issue, issueFailure }) {
	const name = "design-selection record";
	if (!issue) return { name, ...missingIssueRow(issueFailure) };

	const body = issue.body ?? "";
	const optionCount = detectEnumeratedOptions(body).count;

	// The issue body is one entry among the comments, not a special case that
	// bypasses the checks: a record written into the body is judged for timing
	// and structure the same way (its createdAt is the issue's, so it passes
	// timing on its own merits rather than by exemption).
	const record = selectDesignRecord(toDesignRecordEntries(issue));

	if (!record) {
		return { name, ...classifyDesignRecordTiming(undefined, null) };
	}

	const firstCommitOut = exec("git", [
		"log",
		"--format=%aI",
		"--reverse",
		`origin/${base}..HEAD`,
	]);
	const firstCommitIso = firstCommitOut.ok
		? firstCommitOut.out.trim().split("\n")[0] || null
		: null;

	const noImplementation = hasNoImplementationDisposition(record.body);
	const timing = classifyDesignRecordTiming(record.createdAt, firstCommitIso, {
		noImplementation,
	});
	// #737 案1: content structure (required line heads, disposition-token
	// coverage) is report material, not a judge — only timing decides the row.
	// Real repro over this repo's history: 0 true positives, 3 false positives
	// for content, against timing's 3 true / 0 false. classifyDesignRecordContent
	// still runs every time and its finding still prints, prefixed WARN so a
	// reader can tell it apart from a timing detail sharing the same line.
	const content = classifyDesignRecordContent(record.body, optionCount);
	const contentDetail =
		content.status === "FAIL" ? `WARN: ${content.detail}` : undefined;
	const detail =
		[timing.detail, contentDetail].filter(Boolean).join("; ") || undefined;
	return { name, status: timing.status, detail };
}

/**
 * Fan a single-issue step out over every issue the cycle closes (#734).
 *
 * The two issue-scoped checks used to see one issue per run, so a cycle closing
 * several of them turned green as soon as the one issue that was passed had a
 * record — the other issues were never looked at. One row per issue keeps the
 * verdicts separate; the row name carries the number so a FAIL says which issue
 * it belongs to. An empty list is the no-`--issue` case and keeps the step's own
 * unlabelled SKIP row.
 *
 * @param {(args: object) => import("./gate-check.mjs").GateResult} step
 * @param {{number: number, issue?: object|null,
 *          issueFailure?: {status: 'SKIP'|'FAIL', detail: string}|null}[]} issues
 * @param {object} [args] arguments shared by every call (exec, base, deltas, …)
 */
export function perIssueSteps(step, issues, args = {}) {
	if (issues.length === 0) return [step(args)];
	return issues.map(({ number, issue, issueFailure }) => {
		const result = step({ ...args, issue, issueFailure });
		return { ...result, name: `${result.name} (#${number})` };
	});
}

/**
 * Byte/line deltas for the tracked knowledge artifacts this branch touched.
 * Measured whether or not the issue declares a shrink intent: the numbers are
 * report material in their own right, and gating their collection on the
 * declaration would leave a cycle that forgot the token with nothing to read.
 * @returns {import("./gate-check.mjs").SizeDelta[]}
 */
export function collectSizeDeltas({ exec, base, changedFiles }) {
	return changedFiles
		.filter((f) => SIZE_TRACKED_PATTERNS.some((p) => p.test(f)))
		.map((path) => {
			const before = exec("git", ["show", `origin/${base}:${path}`]);
			const after = exec("git", ["show", `HEAD:${path}`]);
			const beforeText = before.ok ? before.out : "";
			const afterText = after.ok ? after.out : "";
			return {
				path,
				beforeBytes: before.ok ? Buffer.byteLength(beforeText, "utf-8") : 0,
				afterBytes: Buffer.byteLength(afterText, "utf-8"),
				beforeLines: before.ok ? beforeText.split("\n").length : 0,
				afterLines: afterText.split("\n").length,
			};
		});
}

/**
 * knowledge-artifact size direction: did tracked knowledge artifacts
 * (bindings, ADRs, SKILL.md) grow without an explicit override, on a cycle
 * whose linked issue declares `Size-Intent: shrink` (issue #669's protection
 * against "the countermeasure's effect on size is never measured")?
 */
export function sizeDirectionStep({
	issue,
	issueFailure,
	deltas,
	overrideDeclared,
}) {
	const name = "knowledge-artifact size direction";
	if (!issue) return { name, ...missingIssueRow(issueFailure) };

	// The override is read from the branch's commit trailers by the caller, once
	// for every linked issue. Local git, so unlike the PR body it left (#775)
	// there is no lookup that can fail and no verdict that means "unreadable".
	const issueBody = issue.body ?? "";
	return {
		name,
		...classifySizeDirection({ issueBody, deltas, overrideDeclared }),
	};
}

/**
 * commit subject lint: Conventional Commits format plus the English-language
 * rule. Granularity stays MANUAL.
 *
 * --no-merges is not an optimisation. Taking base into a branch is a step this
 * repo's own procedure prescribes, and git writes those subjects itself
 * ("Merge remote-tracking branch 'origin/main' into …"), which can never be
 * Conventional Commits. Without the exclusion the gate fails on every branch
 * that followed the procedure, and a FAIL the runner is told to ignore is a
 * FAIL they stop reading (#690).
 */
export function commitSubjectStep({ exec, base }) {
	const name = "commit subject lint";
	const subjectsOut = exec("git", [
		"log",
		"--no-merges",
		`origin/${base}..HEAD`,
		"--format=%s",
	]);
	if (!subjectsOut.ok)
		return { name, status: "FAIL", detail: subjectsOut.out.trim() };

	const subjects = subjectsOut.out.trim().split("\n").filter(Boolean);
	if (subjects.length === 0)
		return { name, status: "SKIP", detail: "no commits in range" };

	const failed = lintCommitSubjects(subjects).filter((r) => !r.ok);
	return {
		name,
		status: failed.length === 0 ? "PASS" : "FAIL",
		detail:
			failed.length === 0
				? `${subjects.length} commit(s)`
				: failed.map((r) => `${r.reason}: ${r.subject}`).join("; "),
	};
}

/**
 * check-docs: the documentation and distributed-prose checks CI runs.
 *
 * The whole `make check-docs` target rather than one check lifted out of it.
 * Seven checks sit behind that target and none of them was on the gate, so
 * migrating one — the one whose absence happened to be noticed — would leave
 * six with the same gap and the same issue waiting to be filed. Whole-repo
 * scope is not a problem in practice: CI runs this same target on every push,
 * so the tree the branch starts from is already clean (the argument
 * md-write-check.mjs makes for reading whole files rather than diffs).
 */
export function checkDocsStep({ exec }) {
	const name = "check-docs";
	const r = exec("make", ["check-docs"]);
	return {
		name,
		status: r.ok ? "PASS" : "FAIL",
		detail: r.ok ? undefined : r.out.trim().slice(-400),
	};
}

/**
 * Review record: does this branch carry a trailer for the code it changed?
 * The rule says the trailer cannot be added after the fact — it is part of a
 * commit message — yet every detector for it used to sit after the merge,
 * where the only fix left is rewriting history.
 *
 * The verdict is classifyCycle's, called on `origin/<base>...HEAD`. A
 * malformed record is reported because parseReviewTrailer already judged it,
 * not as an extra rule.
 */
export function reviewRecordStep({ commitMessages, changedFiles }) {
	const name = "Review record";
	if (!commitMessages.ok)
		return { name, status: "FAIL", detail: commitMessages.error };

	const records = parseReviewRecords(commitMessages.text);
	const problems = classifyCycle({
		changedFiles,
		recordCount: records.length,
	});
	for (const r of records.filter((r) => r.error))
		problems.push(`malformed record: ${r.error}`);
	if (problems.length > 0)
		return { name, status: "FAIL", detail: problems.join("; ") };
	return {
		name,
		status: "PASS",
		detail:
			records.length === 0
				? "prose-only branch, no record owed"
				: `${records.length} record(s)`,
	};
}

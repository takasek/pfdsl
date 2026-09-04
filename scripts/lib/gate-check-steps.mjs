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
	classifyDesignRecordRequiredFormat,
	classifyDesignRecordTiming,
	classifyOutputArtifactStatus,
	classifySizeDirection,
	hasStatusChange,
	lintCommitSubjects,
	matchesTrigger,
	NO_ARTIFACT_DETAIL,
	NO_ISSUE_DETAIL,
	parseCommitLogLines,
	parseFormat3DesignRecord,
	resolveDesignRecord,
	resolveRecordEditedAt,
	SIZE_TRACKED_PATTERNS,
	statusChangedForArtifact,
	toDesignRecordEntries,
	unionCommitLogEntries,
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
 * The branch's deleted paths, the half changedFilesSince drops (#778).
 *
 * The gate item this feeds names deletion as one of the changes a PFD has to
 * reflect, so a deletion that no report mentions leaves the item with nothing
 * to judge — and a deleted file is precisely the case where the PFD modeling
 * it is most likely to be left describing something gone. Kept separate from
 * changedFilesSince rather than folded into it: the gates that call that one
 * would run `pfdsl check` against a path that no longer exists.
 *
 * A git failure yields an empty list rather than an error. The consumer is
 * report material, and losing the deleted half of it is cheaper than losing
 * the block.
 * @param {{exec: Function, base: string}} params
 * @returns {string[]}
 */
export function deletedFilesSince({ exec, base }) {
	const r = exec("git", [
		"diff",
		"--diff-filter=D",
		"--name-only",
		`origin/${base}...HEAD`,
	]);
	return r.ok ? r.out.trim().split("\n").filter(Boolean) : [];
}

/**
 * When this cycle started: the author date of the branch's oldest commit.
 *
 * Author dates, not committer dates. A rebase rewrites every committer date on
 * the branch to the moment of the rebase, so a %cI anchor jumps forward to
 * "now" — measured on #834's own branch, where that collapsed the cycle window
 * to empty on the re-run the window exists for.
 *
 * Two checks anchor here (the design-selection record's timing and the cycle
 * window), and a disagreement between them about when the cycle started would
 * show up as one of them silently judging a different span, so they share the
 * one query. `ok: false` is a failed lookup, distinct from `iso: null` on a
 * branch that has no commits yet — callers report those differently.
 * @param {{exec: Function, base: string}} params
 * @returns {{ok: boolean, iso: string | null}}
 */
export function firstCommitAuthorDate({ exec, base }) {
	const r = exec("git", [
		"log",
		"--format=%aI",
		"--reverse",
		`origin/${base}..HEAD`,
	]);
	if (!r.ok) return { ok: false, iso: null };
	return { ok: true, iso: r.out.trim().split("\n")[0] || null };
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
export function genPluginIdentityStep({ node, changedFiles }) {
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
		node([
			"scripts/check-generated-drift.mjs",
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
 * The GraphQL edit-history fetch for one issue's design-selection record
 * candidates (#737 案2). Owner/repo resolution and the query itself are
 * github-ops.mjs's responsibility now (designRecordEditInfo).
 * @param {{githubOps: {designRecordEditInfo: (params: {number: number}) => Promise<any>}, number: number}} params
 * @returns {Promise<{issueLastEditedAt: string | null, comments: {totalCount: number, nodes: Array<{id: string, lastEditedAt: string | null}>}}>}
 */
export async function fetchDesignRecordEditInfo({ githubOps, number }) {
	return await githubOps.designRecordEditInfo({ number });
}

/**
 * design-selection record: was the design choice recorded before work
 * started, with the required structure (issue #669's protection against
 * "the record is written after the fact, or is unstructured prose")?
 */
export function designRecordStep({
	exec,
	base,
	issue,
	issueFailure,
	editInfo,
}) {
	const name = "design-selection record";
	if (!issue) return { name, ...missingIssueRow(issueFailure) };

	const body = issue.body ?? "";
	const optionCount = detectEnumeratedOptions(body).count;

	// Comments only (#927). The body used to be an entry too, on the reading
	// that a record written there was judged the same way — but its createdAt is
	// the issue's, which predates every commit on the branch that closes it, so
	// the timing check passed by construction for anything the body won. What
	// looked like one entry among the rest was the one entry the check could not
	// fail.
	const resolution = resolveDesignRecord(toDesignRecordEntries(issue));

	if (resolution.status === "none") {
		return { name, ...classifyDesignRecordTiming(undefined, null) };
	}
	if (resolution.status === "ambiguous")
		return { name, status: "FAIL", detail: resolution.detail };
	if (resolution.status === "invalid")
		return {
			name,
			status: "FAIL",
			detail: resolution.problems.join("; "),
		};
	const record = resolution.record;

	const firstCommitIso = firstCommitAuthorDate({ exec, base }).iso;

	// #737 案2: the record's own edit history (editInfo is undefined/null
	// whenever the GraphQL fetch failed or was unavailable — resolveRecordEditedAt
	// reports that as a note rather than silently treating it as "unedited").
	const { editedAtIso, note: editNote } = resolveRecordEditedAt(
		record,
		editInfo ?? null,
	);

	const parsedFormat3 = parseFormat3DesignRecord(record.body);
	const noImplementation =
		parsedFormat3.status === "PASS" && parsedFormat3.allNoImplementation;
	const timing = classifyDesignRecordTiming(record.createdAt, firstCommitIso, {
		editedAtIso,
		noImplementation,
		recordPresent: true,
	});
	const requiredFormat = classifyDesignRecordRequiredFormat(
		record.body,
		record.createdAt,
	);
	// Format 3's parser owns a structural verdict. Earlier generations retain
	// their advisory disposition-content detail for migration compatibility.
	const content = classifyDesignRecordContent(
		record.body,
		optionCount,
		record.createdAt,
	);
	const contentDetail =
		requiredFormat.status === "PASS" && content.status === "FAIL"
			? `WARN: ${content.detail}`
			: undefined;
	// The edit note is only worth printing once timing actually reached the
	// stage where an edit could have mattered — a SKIP already means nothing
	// was compared, so noting missing edit history there would read as a
	// second reason for a verdict that has only one.
	const detail =
		[
			timing.detail,
			timing.status === "SKIP" ? undefined : editNote,
			requiredFormat.status === "FAIL" ? requiredFormat.detail : undefined,
			contentDetail,
		]
			.filter(Boolean)
			.join("; ") || undefined;
	return {
		name,
		status:
			requiredFormat.status === "FAIL" ||
			(parsedFormat3.status === "FAIL" &&
				record.body
					.split("\n")
					.some((line) => line.includes("設計記録形式: 3")))
				? "FAIL"
				: timing.status,
		detail,
	};
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
 *          issueFailure?: {status: 'SKIP'|'FAIL', detail: string}|null,
 *          editInfo?: object|null}[]} issues
 * @param {object} [args] arguments shared by every call (exec, base, deltas, …)
 */
export function perIssueSteps(step, issues, args = {}) {
	if (issues.length === 0) return [step(args)];
	return issues.map(({ number, issue, issueFailure, editInfo }) => {
		const result = step({ ...args, issue, issueFailure, editInfo });
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

// #834: a failure past the base-commits-this-tree-lacks query costs only the
// rebase-invariant half — collectCycleWindow still has part (1) to hand back,
// and silently narrowing the window to it would read as "the window is
// empty" rather than "half of it could not be measured".
const CYCLE_WINDOW_INCOMPLETE_NOTE =
	"could not determine which base commits landed since the branch started; showing only the commits this tree currently lacks";

/**
 * The cycle window (#834): report material for the terminal gate, not a
 * verdict — union of two things a runner re-reading issue bodies, comments
 * and PR bodies against base's current conventions needs to know landed
 * without them.
 *
 * (1) base commits this tree currently lacks (`HEAD..origin/<base>`) covers
 * a branch cut from an already-stale base. (2) base commits that landed
 * at/after the branch's first commit covers the shape a rebase does not
 * clear: afterwards those commits are ancestors of HEAD, but the same shas
 * stay reachable from `origin/<base>` with a landing date past the branch's
 * start, so a plain `HEAD..origin/<base>` diff (which shows 0 once rebased)
 * misses them while this still finds them. This is exactly the gap #834
 * named: every option the issue enumerated fires on `behindBase > 0`, i.e.
 * assumes the tree is *still* behind when the gate runs, but the measured
 * sequence is notice→rebase→re-run, at which point behindBase is 0 and none
 * of them print anything.
 *
 * The one stretch neither half covers after a rebase is between the branch's
 * creation and its first commit — part (2) has no earlier anchor to measure
 * from, and part (1) is empty by then. Before a rebase part (1) still covers
 * it, so the gap only opens on a re-run.
 *
 * "Landed" in part (2) means the commit's own date, not the moment it reached
 * base. A merge brings commits older than the anchor along with it, and only
 * the merge commit itself carries the landing time — so what part (2) names
 * for those is the PR's merge, not each commit inside it.
 * @param {{exec: Function, base: string}} params
 * @returns {{ok: boolean, entries?: {sha: string, subject: string}[], error?: string, note?: string}}
 */
export function collectCycleWindow({ exec, base }) {
	const laggedOut = exec("git", [
		"log",
		"--format=%h%x09%s",
		`HEAD..origin/${base}`,
	]);
	if (!laggedOut.ok) return { ok: false, error: laggedOut.out.trim() };
	const lagged = parseCommitLogLines(laggedOut.out);

	const incomplete = () => ({
		ok: true,
		entries: lagged,
		note: CYCLE_WINDOW_INCOMPLETE_NOTE,
	});

	// Where part (2) measures from, shared with the design-record timing check
	// so the two cannot disagree about when this cycle started.
	const start = firstCommitAuthorDate({ exec, base });
	if (!start.ok) return incomplete();
	// No commits yet leaves part (2) with nothing to measure from, which is a
	// reasoned skip rather than a gap in the window.
	if (start.iso === null) return { ok: true, entries: lagged };
	const since = start.iso;

	const laterOut = exec("git", [
		"log",
		"--format=%h%x09%s",
		`--since=${since}`,
		`origin/${base}`,
	]);
	if (!laterOut.ok) return incomplete();
	const later = parseCommitLogLines(laterOut.out);

	return { ok: true, entries: unionCommitLogEntries(lagged, later) };
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
 *
 * Issue-body enumeration remains design-settlement guidance and does not add a
 * review trailer requirement. Code-path changes still owe correctness or design.
 */
export function reviewRecordStep({ commitMessages, changedFiles }) {
	const name = "Review record";
	if (!commitMessages.ok)
		return {
			name,
			status: "FAIL",
			detail: commitMessages.error,
		};

	const records = parseReviewRecords(commitMessages.text);
	const problems = classifyCycle({ changedFiles, records });
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

/**
 * Parse every adopted .pfdsl file, for the report material that says which of
 * a cycle's changed files any PFD models (#778). One owner for the directory
 * read and for what a single unparsable file costs — the same reason
 * loadPatternCatalog exists in retro-patterns.mjs rather than at its callers.
 *
 * A failing file is named and skipped rather than aborting: the block this
 * feeds is material, and a partial reading whose gap is stated is worth more
 * than none. Paths are repo-relative, so `readdirSync`/`readFile` are expected
 * to be root-bound by the caller.
 * @param {{
 *   readdirSync: (dir: string) => string[],
 *   readFile: (file: string) => string,
 *   analyze: (text: string) => {frontmatter: object},
 *   dir?: string,
 * }} deps
 * @returns {{analyzed: Array<{file: string, frontmatter: object}>, unreadable: string[]}}
 */
export function analyzeAdoptedPfdsl({
	readdirSync,
	readFile,
	analyze,
	dir = ".pfdsl",
}) {
	const analyzed = [];
	const unreadable = [];
	const names = readdirSync(dir)
		.filter((name) => name.endsWith(".pfdsl"))
		.sort();
	for (const name of names) {
		const file = `${dir}/${name}`;
		try {
			analyzed.push({ file, frontmatter: analyze(readFile(file)).frontmatter });
		} catch (e) {
			unreadable.push(`${file}: ${e.message}`);
		}
	}
	return { analyzed, unreadable };
}

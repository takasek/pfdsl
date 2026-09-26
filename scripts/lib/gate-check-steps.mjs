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

import { checkCommitSubjects } from "./commit-subjects.mjs";
import {
	classifyOutputArtifactStatus,
	hasStatusChange,
	matchesTrigger,
	NO_ARTIFACT_DETAIL,
	parseCommitLogLines,
	SIZE_TRACKED_PATTERNS,
	statusChangedForArtifact,
	unionCommitLogEntries,
	wipTransitionDetected,
} from "./gate-check.mjs";
import { GEN_INSTALL_TRIGGER } from "./gen-install-trigger.mjs";
import { genPluginDriftPathspecs } from "./gen-plugin-outputs.mjs";
import { GEN_PLUGIN_TRIGGER } from "./gen-plugin-trigger.mjs";

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
 * The cycle window uses this date for reporting only. It does not establish
 * when a design was approved. `ok: false` is a failed lookup, distinct from
 * `iso: null` on a branch with no commits yet.
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
 * gen-plugin identity: regenerate the distributed trees and require no diff.
 *
 * GEN_INSTALL_TRIGGER is consulted too: install/ is generated from repo-root
 * sources (#547) that GEN_PLUGIN_TRIGGER doesn't match, so a PR editing only a
 * template source would otherwise report SKIP while in fact owing install/ and
 * plugin/ churn. gen-plugin.mjs runs gen-install internally, so one
 * regeneration covers both hops. Unlike pre-commit and CI, no earlier step
 * here owns install/ or SKILL.md, so the whole output contract is diffed.
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
			...genPluginDriftPathspecs("terminal"),
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
 * Byte/line deltas for the tracked knowledge artifacts this branch touched.
 * The measured deltas are unconditional report material for human review.
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

	// Where part (2) measures from; used for this report, not a timing gate.
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
 * Format the cycle window without presenting a stale origin ref as current.
 * The fetch is report material, not a verdict: its failure changes how the window is labelled but does not make the terminal gate fail.
 * @param {{fetchResult: {ok: boolean, out: string}, window: {ok: boolean, entries?: {sha: string, subject: string}[], error?: string, note?: string}}} params
 * @returns {string[]}
 */
export function formatCycleWindowReport({ fetchResult, window }) {
	if (!fetchResult.ok) {
		const lines = [
			`origin freshness could not be established: ${fetchResult.out.trim()}`,
		];
		if (!window.ok) {
			lines.push(
				`unverified cycle window could not be measured: ${window.error}`,
			);
		} else if (window.entries.length > 0) {
			lines.push("unverified entries from the existing origin ref:");
			for (const { sha, subject } of window.entries) {
				lines.push(`  ${sha} ${subject}`);
			}
		}
		if (window.note) lines.push(`(${window.note})`);
		return lines;
	}

	if (!window.ok) return [`could not be measured: ${window.error}`];
	const lines =
		window.entries.length === 0
			? ["(none)"]
			: window.entries.map(({ sha, subject }) => `${sha} ${subject}`);
	if (window.note) lines.push(`(${window.note})`);
	return lines;
}

/**
 * Commit subject lint: Conventional Commits format only.
 * Language and granularity remain review guidance.
 *
 * --no-merges is not an optimisation. Taking base into a branch is a step this
 * repo's own procedure prescribes, and git writes those subjects itself
 * ("Merge remote-tracking branch 'origin/main' into …"), which can never be
 * Conventional Commits. Without the exclusion the gate fails on every branch
 * that followed the procedure, and a FAIL the runner is told to ignore is a
 * FAIL they stop reading (#690).
 *
 * The verdict itself is checkCommitSubjects', shared with the CI entry point so
 * the two cannot judge the same commits differently (#1174). `check` is
 * injected the way `exec` is, and for the same reason a test needs it: without
 * a seam, an inlined copy of today's logic satisfies every assertion here, and
 * a later fix to the shared checker would reach CI while the gate kept the
 * stale copy.
 */
export function commitSubjectStep({ exec, base, check = checkCommitSubjects }) {
	return check({
		exec,
		baseRef: `origin/${base}`,
		headRef: "HEAD",
	});
}

/**
 * check-docs: the documentation and distributed-prose checks CI runs.
 *
 * The whole `make check-docs` target rather than one check lifted out of it.
 * Keeping the target intact also covers checks added to it later. Whole-repo
 * scope is not a problem in practice: CI runs this same target on every push,
 * so the tree the branch starts from is already clean.
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
 * Parse every adopted .pfdsl file, for the report material that says which of
 * a cycle's changed files any PFD models (#778). One owner for the directory
 * read and for what a single unparsable file costs, shared by every consumer.
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

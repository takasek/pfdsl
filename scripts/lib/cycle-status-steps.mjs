/**
 * cycle-status orchestration: the try/catch sequencing that turns four
 * independent I/O calls (git fetch, git log, gh pr list, the built CLI's
 * `status ready`, and a conditional gh issue lookup) into one JSON payload.
 * None of this branch wiring was covered — only the pure helpers in
 * cycle-status.mjs were (#645). `sh`/`execGh`/`existsSync`/`readFileSync` are
 * injected so a test can supply canned I/O and assert which error field gets
 * set for which failure, without a real git/gh/filesystem in play.
 *
 * `sh` has the shape of lib/run-exec.mjs' `run`: it throws on failure (unlike
 * `tryRun`), matching how the top-level script already calls it. `shTry` is
 * `tryRun` itself, for the one call whose non-zero exit is a reading rather
 * than a breakage (release-status, #814).
 */

import { relative, resolve } from "node:path";
import {
	buildDesignRecordTemplate,
	buildGateCheckCommand,
	buildPreArtifactReminders,
	buildReviewRecordTemplate,
	classifyDesignSettlement,
	classifyPRs,
	countBehind,
	detectEnumeratedOptions,
	findIssueNumberForProcess,
	findProcessIdForIssueNumber,
	parsePorcelainPaths,
	parseReadyOutput,
	summarizeReleasePending,
} from "./cycle-status.mjs";
import { loadPatternCatalog, PATTERN_DIR_RELATIVE } from "./retro-patterns.mjs";

/**
 * @param {{
 *   sh: (file: string, args: string[]) => string,
 *   shTry: (file: string, args: string[]) => {ok: boolean, out: string, status: number|null},
 *   execGh: (args: string[]) => Promise<string>,
 *   existsSync: (path: string) => boolean,
 *   readFileSync: (path: string, encoding: string) => string,
 *   readdirSync: (path: string) => string[],
 *   root: string,
 *   base: string,
 *   issueNumbers?: number[],
 * }} deps
 */
export async function runCycleStatus({
	sh,
	shTry,
	execGh,
	existsSync,
	readFileSync,
	readdirSync,
	root,
	base,
	issueNumbers = [],
}) {
	let fetched = true;
	try {
		sh("git", ["fetch", "origin"]);
	} catch {
		fetched = false;
	}

	let behindBase = null;
	let behindBaseError = null;
	try {
		behindBase = countBehind(
			sh("git", ["log", "--oneline", `HEAD..origin/${base}`]),
		);
	} catch (e) {
		behindBaseError = e.message;
	}

	// A tree behind base serves this script's own older version, so the output
	// would describe which checks that version has — and a check absent there is
	// indistinguishable from one that ran and found nothing (#716). Withhold
	// every judgment rather than annotate them: annotation leaves the reader the
	// same interpretation that already failed once.
	if (behindBase > 0) {
		return {
			fetched,
			behindBase,
			staleTree: {
				base,
				message:
					`This tree is ${behindBase} commits behind origin/${base}, so this preflight ran from that older version of itself. ` +
					"Its judgments — including which checks exist at all — would describe the old tree, not this cycle. " +
					`Start the cycle's branch from origin/${base} (git switch -c <branch> origin/${base}) and re-run.`,
			},
		};
	}

	// The same accident as behindBase, arriving through the working tree instead
	// of through commits (#744). Switching branches carries uncommitted edits
	// along, so the previous cycle's changes are still sitting there to be swept
	// into this cycle's first commit — and neither gate-check (which reads
	// committed diffs) nor the pre-commit hook (which sees a file only once it
	// is staged, by which time it is already in) is positioned to say so.
	//
	// Refused rather than reported, unlike commitsAheadOfBase: a cycle is
	// expected to start from a clean tree, and `git worktree add` produces one,
	// so the refusal is answered by making a worktree rather than by weighing it.
	let uncommittedFiles = null;
	let dirtyTreeError = null;
	try {
		uncommittedFiles = parsePorcelainPaths(
			sh("git", ["status", "--porcelain"]),
		);
	} catch (e) {
		dirtyTreeError = e.message;
	}

	if (uncommittedFiles && uncommittedFiles.length > 0) {
		return {
			fetched,
			behindBase,
			uncommittedFiles,
			dirtyTree: {
				message:
					`This tree has ${uncommittedFiles.length} uncommitted change(s), so work started here would mix them into this cycle's commits. ` +
					"Commit or stash them, or start the cycle in a fresh worktree (git worktree add), and re-run.",
			},
		};
	}

	// Where HEAD sits, for the "second cycle in one session lands on the previous
	// cycle's branch" accident (#629). Reported, not refused: continuing an
	// existing branch is sometimes deliberate, so the judgement stays with the
	// reader — but at selection time, not at the terminal gate where the commits
	// are already stacked.
	let currentBranch = null;
	let commitsAheadOfBase = null;
	let headStateError = null;
	try {
		currentBranch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
		commitsAheadOfBase = countBehind(
			sh("git", ["log", "--oneline", `origin/${base}..HEAD`]),
		);
	} catch (e) {
		headStateError = e.message;
	}

	let openFlowSyncPRs = [];
	let otherOpenPRs = [];
	let prError = null;
	try {
		const prJson = JSON.parse(
			await execGh([
				"pr",
				"list",
				"--state",
				"open",
				"--json",
				"number,title,headRefName,statusCheckRollup",
			]),
		);
		({ openFlowSyncPRs, otherOpenPRs } = classifyPRs(prJson));
	} catch (e) {
		prError = e.message;
	}

	// The publishing backlog, re-derived here every cycle instead of written
	// down (#814). `.pfdsl/roadmap.md` used to ask a cycle that saw a pending
	// release to note it as the next cycle's first task, without naming a place
	// to note it in: the only surface that existed at that moment was the PR
	// body, which the next cycle's executor never reads. Since the backlog is a
	// fact the registries and git already hold, it is taken from there and no
	// ledger of it can go stale.
	//
	// shTry rather than sh: release-status exits 1 whenever anything is
	// unpublished, which is the ordinary state between releases, so a non-zero
	// exit here is the reading itself and not a failed run.
	let releasePending = null;
	let releasePendingError = null;
	try {
		releasePending = summarizeReleasePending(
			shTry(process.execPath, [resolve(root, "scripts/release-status.mjs")]),
		);
	} catch (e) {
		releasePendingError = e.message;
	}

	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	let ready = [];
	let best = null;
	let readyError = null;
	if (existsSync(cliPath)) {
		try {
			const readyJson = JSON.parse(
				sh(process.execPath, [
					cliPath,
					"status",
					"ready",
					".pfdsl/roadmap.pfdsl",
					"--best",
					"--json",
				]),
			);
			({ ready, best } = parseReadyOutput(readyJson));
		} catch (e) {
			readyError = e.message;
		}
	} else {
		readyError =
			"packages/cli/dist/cli.js not built; run 'pnpm -r build' first";
	}

	// Target issue resolution order: explicit --issue flags win; otherwise
	// fall back to the best process's roadmap-declared issue. Neither present
	// means the design-settlement check has nothing to look at (#669). The flag
	// is repeatable because a cycle can close several issues, and judging one of
	// them is what let the terminal gate turn green on the one issue that had a
	// record (#734).
	//
	// Each verdict carries the issue and the source it was resolved from, rather
	// than the single top-level `designUnsettled` field this replaced: that field
	// left the reader unable to tell which issue had been judged, so a cycle
	// working on a roadmap-unmanaged issue could take an unrelated verdict as its
	// own evidence of settlement (#669).
	const designUnsettledFor = [];
	let designUnsettledError = null;
	let targetIssues = [];
	let targetSource = null;
	// Read once and reused below for the gate-check artifact resolution — same
	// file, whichever branch below (or that step) needs it first.
	let roadmapText = null;
	if (issueNumbers.length > 0) {
		targetIssues = issueNumbers;
		targetSource = "flag";
	} else if (best) {
		try {
			roadmapText = readFileSync(
				resolve(root, ".pfdsl/roadmap.pfdsl"),
				"utf-8",
			);
			const found = findIssueNumberForProcess(roadmapText, best);
			if (found) {
				targetIssues = [found];
				targetSource = "best-process";
			} else {
				designUnsettledError = `no issue number found for process '${best}' in .pfdsl/roadmap.pfdsl`;
			}
		} catch (e) {
			designUnsettledError = e.message;
		}
	}

	// The record's option count comes from the issue when one is resolvable, and
	// is 0 otherwise. The template itself is emitted either way: a cycle whose
	// issue lookup failed still owes a record, and printing nothing is what left
	// the format invisible at writing time in the first place (#720).
	// The count shown is the largest across the cycle's issues: a record is owed
	// on each one separately, and the template is written once.
	let recordOptionCount = 0;

	if (targetIssues.length > 0) {
		for (const targetIssue of targetIssues) {
			try {
				const issueJson = JSON.parse(
					await execGh([
						"issue",
						"view",
						String(targetIssue),
						"--json",
						"body,comments,createdAt",
					]),
				);
				recordOptionCount = Math.max(
					recordOptionCount,
					detectEnumeratedOptions(issueJson.body).count,
				);
				const classification = classifyDesignSettlement({
					body: issueJson.body,
					createdAt: issueJson.createdAt,
					comments: issueJson.comments,
				});
				designUnsettledFor.push({
					issue: targetIssue,
					source: targetSource,
					unsettled: classification.unsettled,
					reason: classification.reason,
					matchedLines: classification.matchedLines ?? [],
					optionCount: classification.optionCount ?? 0,
					// #927: record-incomplete's whole value to the runner is which
					// line to add. Dropping it here would leave a reason value with
					// nothing to act on.
					missingPrefixes: classification.missingPrefixes ?? [],
					record: classification.record ?? null,
					recordRequired: classification.recordRequired,
				});
			} catch (e) {
				designUnsettledError = e.message;
			}
		}
	} else if (!designUnsettledError) {
		designUnsettledError =
			"no --issue given and no best process to resolve an issue number from";
	}

	// The artifact comes from the process each target issue maps to in
	// roadmap.pfdsl, not from bestOutputs: an --issue may name an issue that has
	// nothing to do with the best process, or one exempt from roadmap management
	// entirely (the case for #800/#772/#794 themselves, all flow:exempt) — using
	// bestOutputs there would silently attach an unrelated artifact (#794).
	// No resolvable process, or issues split across different processes, falls
	// back to null rather than guessing; buildGateCheckCommand turns that into
	// the --no-artifact equivalent.
	let artifactKey = null;
	if (targetIssues.length > 0) {
		if (roadmapText === null) {
			try {
				roadmapText = readFileSync(
					resolve(root, ".pfdsl/roadmap.pfdsl"),
					"utf-8",
				);
			} catch {
				roadmapText = null;
			}
		}
		if (roadmapText !== null) {
			const resolvedProcessIds = new Set(
				targetIssues
					.map((issue) => findProcessIdForIssueNumber(roadmapText, issue))
					.filter((id) => id !== null),
			);
			if (resolvedProcessIds.size === 1 && existsSync(cliPath)) {
				const [processId] = resolvedProcessIds;
				try {
					const neighborsJson = JSON.parse(
						sh(process.execPath, [
							cliPath,
							"graph",
							"neighbors",
							".pfdsl/roadmap.pfdsl",
							processId,
							"--json",
						]),
					);
					// `neighbors` tags each element since #828, and the artifact
					// under gate is the process's output, so name the kind rather
					// than taking [0]. It selects rather than rejects: feedback
					// edges only run artifact -> process (computeNeighbors in
					// packages/core/src/graph-analysis.ts, and N001/N002 keep an id
					// from being both), so a process has no feedback successor to
					// drop.
					artifactKey =
						neighborsJson?.successors?.find((n) => n?.kind === "primary")?.id ??
						null;
				} catch {
					artifactKey = null;
				}
			}
		}
	}
	const gateCheckCommand = buildGateCheckCommand(
		artifactKey,
		base,
		targetIssues,
	);

	// The catalog's own reminder that referencing it at retro is too late for
	// patterns whose countermeasure has to land before this cycle's commit
	// messages / issue comments / PR body / delegation briefs exist
	// (`catalog-consulted-after-the-artifact`, #822). Loaded independently of
	// every branch above — it names nothing about this cycle's git state, so a
	// failure here (a malformed pattern file) is reported and does not
	// withhold the rest of the preflight.
	const PATTERN_DIR = resolve(root, PATTERN_DIR_RELATIVE);
	let preArtifactPatterns = [];
	let preArtifactPatternsError = null;
	try {
		const { patterns, errors } = loadPatternCatalog(PATTERN_DIR, {
			readdirSync,
			readFileSync,
			displayPath: (path) => relative(root, path),
		});
		preArtifactPatterns = buildPreArtifactReminders(patterns);
		if (errors.length > 0) preArtifactPatternsError = errors.join("; ");
	} catch (e) {
		// The directory itself is missing or unreadable: no catalog to remind
		// from. Per-file failures never reach here — loadPatternCatalog keeps
		// them off the patterns that did parse.
		preArtifactPatternsError = e.message;
	}

	const result = {
		fetched,
		behindBase,
		currentBranch,
		commitsAheadOfBase,
		openFlowSyncPRs,
		otherOpenPRs,
		releasePending,
		ready,
		best,
		designUnsettledFor,
		designRecordTemplate: buildDesignRecordTemplate({
			optionCount: recordOptionCount,
		}),
		reviewRecordTemplate: buildReviewRecordTemplate(),
		gateCheckCommand,
		preArtifactPatterns,
	};
	if (behindBaseError) result.behindBaseError = behindBaseError;
	if (dirtyTreeError) result.dirtyTreeError = dirtyTreeError;
	if (headStateError) result.headStateError = headStateError;
	if (prError) result.prError = prError;
	if (releasePendingError) result.releasePendingError = releasePendingError;
	if (readyError) result.readyError = readyError;
	if (designUnsettledError) result.designUnsettledError = designUnsettledError;
	if (preArtifactPatternsError)
		result.preArtifactPatternsError = preArtifactPatternsError;
	return result;
}

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
 * `tryRun`), matching how the top-level script already calls it.
 */

import { resolve } from "node:path";
import {
	buildDesignRecordTemplate,
	buildGateCheckCommand,
	classifyDesignSettlement,
	classifyPRs,
	countBehind,
	detectEnumeratedOptions,
	findIssueNumberForProcess,
	parseReadyOutput,
} from "./cycle-status.mjs";

/**
 * @param {{
 *   sh: (file: string, args: string[]) => string,
 *   execGh: (args: string[]) => Promise<string>,
 *   existsSync: (path: string) => boolean,
 *   readFileSync: (path: string, encoding: string) => string,
 *   root: string,
 *   base: string,
 *   issueNumber?: number | null,
 * }} deps
 */
export async function runCycleStatus({
	sh,
	execGh,
	existsSync,
	readFileSync,
	root,
	base,
	issueNumber = null,
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

	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	let ready = [];
	let best = null;
	let bestOutputs = [];
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
			({ ready, best, bestOutputs } = parseReadyOutput(readyJson));
		} catch (e) {
			readyError = e.message;
		}
	} else {
		readyError =
			"packages/cli/dist/cli.js not built; run 'pnpm -r build' first";
	}

	// Target issue resolution order: an explicit --issue flag wins; otherwise
	// fall back to the best process's roadmap-declared issue. Neither present
	// means the design-settlement check has nothing to look at (#669).
	let designUnsettledFor = null;
	let designUnsettledError = null;
	let targetIssue = null;
	let targetSource = null;
	if (issueNumber != null) {
		targetIssue = issueNumber;
		targetSource = "flag";
	} else if (best) {
		try {
			const roadmapText = readFileSync(
				resolve(root, ".pfdsl/roadmap.pfdsl"),
				"utf-8",
			);
			const found = findIssueNumberForProcess(roadmapText, best);
			if (found) {
				targetIssue = found;
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
	let recordOptionCount = 0;

	if (targetIssue != null) {
		try {
			const issueJson = JSON.parse(
				await execGh([
					"issue",
					"view",
					String(targetIssue),
					"--json",
					"author,body,comments",
				]),
			);
			recordOptionCount = detectEnumeratedOptions(issueJson.body).count;
			const ownerLogin = issueJson.author?.login;
			const comments = (issueJson.comments ?? []).map((c) => ({
				author: c.author?.login,
				body: c.body,
				createdAt: c.createdAt,
			}));
			const classification = classifyDesignSettlement({
				body: issueJson.body,
				ownerLogin,
				comments,
			});
			designUnsettledFor = {
				issue: targetIssue,
				source: targetSource,
				unsettled: classification.unsettled,
				reason: classification.reason,
				matchedLines: classification.matchedLines ?? [],
				optionCount: classification.optionCount ?? 0,
				decision: classification.decision ?? null,
			};
		} catch (e) {
			designUnsettledError = e.message;
		}
	} else if (!designUnsettledError) {
		designUnsettledError =
			"no --issue given and no best process to resolve an issue number from";
	}

	// bestOutputs[0] のみ使う。複数出力プロセス（例: 1プロセスが複数 artifact を生成する edge）は
	// 最初の出力のみを gate-check の対象にする単純化。
	const gateCheckCommand = buildGateCheckCommand(
		bestOutputs[0] ?? null,
		base,
		targetIssue,
	);

	const result = {
		fetched,
		behindBase,
		currentBranch,
		commitsAheadOfBase,
		openFlowSyncPRs,
		otherOpenPRs,
		ready,
		best,
		designUnsettledFor,
		designRecordTemplate: buildDesignRecordTemplate({
			optionCount: recordOptionCount,
		}),
		gateCheckCommand,
	};
	if (behindBaseError) result.behindBaseError = behindBaseError;
	if (headStateError) result.headStateError = headStateError;
	if (prError) result.prError = prError;
	if (readyError) result.readyError = readyError;
	if (designUnsettledError) result.designUnsettledError = designUnsettledError;
	return result;
}

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
	buildGateCheckCommand,
	classifyPRs,
	countBehind,
	detectDesignUnsettled,
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
 * }} deps
 */
export async function runCycleStatus({ sh, execGh, existsSync, readFileSync, root, base }) {
	let fetched = true;
	try {
		sh("git", ["fetch", "origin"]);
	} catch {
		fetched = false;
	}

	let behindBase = null;
	let behindBaseError = null;
	try {
		behindBase = countBehind(sh("git", ["log", "--oneline", `HEAD..origin/${base}`]));
	} catch (e) {
		behindBaseError = e.message;
	}

	let openFlowSyncPRs = [];
	let otherOpenPRs = [];
	let prError = null;
	try {
		const prJson = JSON.parse(
			await execGh(["pr", "list", "--state", "open", "--json", "number,title,headRefName,statusCheckRollup"]),
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
			const readyJson = JSON.parse(sh(process.execPath, [cliPath, "status", "ready", ".pfdsl/roadmap.pfdsl", "--best", "--json"]));
			({ ready, best, bestOutputs } = parseReadyOutput(readyJson));
		} catch (e) {
			readyError = e.message;
		}
	} else {
		readyError = "packages/cli/dist/cli.js not built; run 'pnpm -r build' first";
	}

	let designUnsettled = null;
	let designUnsettledLines = [];
	let designUnsettledError = null;
	if (best) {
		try {
			const roadmapText = readFileSync(resolve(root, ".pfdsl/roadmap.pfdsl"), "utf-8");
			const issueNumber = findIssueNumberForProcess(roadmapText, best);
			if (issueNumber) {
				const body = await execGh(["issue", "view", String(issueNumber), "--json", "body", "--jq", ".body"]);
				({ designUnsettled, matchedLines: designUnsettledLines } = detectDesignUnsettled(body));
			} else {
				designUnsettledError = `no issue number found for process '${best}' in .pfdsl/roadmap.pfdsl`;
			}
		} catch (e) {
			designUnsettledError = e.message;
		}
	}

	// bestOutputs[0] のみ使う。複数出力プロセス（例: 1プロセスが複数 artifact を生成する edge）は
	// 最初の出力のみを gate-check の対象にする単純化。
	const gateCheckCommand = buildGateCheckCommand(bestOutputs[0] ?? null, base);

	const result = {
		fetched,
		behindBase,
		openFlowSyncPRs,
		otherOpenPRs,
		ready,
		best,
		designUnsettled,
		designUnsettledLines,
		gateCheckCommand,
	};
	if (behindBaseError) result.behindBaseError = behindBaseError;
	if (prError) result.prError = prError;
	if (readyError) result.readyError = readyError;
	if (designUnsettledError) result.designUnsettledError = designUnsettledError;
	return result;
}

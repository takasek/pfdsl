#!/usr/bin/env node
// Cycle preflight: bundles step-1 mechanical operations (fetch, rebase-behind
// check, flow-sync PR check, ready listing) into one compact JSON payload.
// Usage: node scripts/cycle-status.mjs [--base main]

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
	classifyPRs,
	parseReadyOutput,
	countBehind,
	findIssueNumberForProcess,
	detectDesignUnsettled,
	buildGateCheckCommand,
} from "./lib/cycle-status.mjs";
import { execGh } from "./lib/gh-exec.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const baseFlagIdx = args.indexOf("--base");
const base = baseFlagIdx >= 0 ? args[baseFlagIdx + 1] : "main";

function sh(cmd) {
	return execSync(cmd, { cwd: root, encoding: "utf-8" });
}

let fetched = true;
try {
	sh("git fetch origin");
} catch {
	fetched = false;
}

let behindBase = null;
let behindBaseError = null;
try {
	behindBase = countBehind(sh(`git log --oneline HEAD..origin/${base}`));
} catch (e) {
	behindBaseError = e.message;
}

let openFlowSyncPRs = [];
let otherOpenPRs = [];
let prError = null;
try {
	const prJson = JSON.parse(
		await execGh(["pr", "list", "--state", "open", "--json", "number,title,headRefName,statusCheckRollup"], { cwd: root }),
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
		const readyJson = JSON.parse(sh(`node "${cliPath}" status ready .pfdsl/roadmap.pfdsl --best --json`));
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
			const body = await execGh(["issue", "view", String(issueNumber), "--json", "body", "--jq", ".body"], { cwd: root });
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

console.log(JSON.stringify(result, null, 2));

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
	findOutputArtifactForProcess,
	buildGateCheckCommand,
} from "./lib/cycle-status.mjs";

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
	const prJson = JSON.parse(sh("gh pr list --state open --json number,title,headRefName,statusCheckRollup"));
	({ openFlowSyncPRs, otherOpenPRs } = classifyPRs(prJson));
} catch (e) {
	prError = e.message;
}

const cliPath = resolve(root, "packages/cli/dist/cli.js");
let ready = [];
let best = null;
let readyError = null;
if (existsSync(cliPath)) {
	try {
		const readyJson = JSON.parse(sh(`node "${cliPath}" ready .pfdsl/roadmap.pfdsl --best --json`));
		({ ready, best } = parseReadyOutput(readyJson));
	} catch (e) {
		readyError = e.message;
	}
} else {
	readyError = "packages/cli/dist/cli.js not built; run 'pnpm -r build' first";
}

let designUnsettled = null;
let designUnsettledLines = [];
let designUnsettledError = null;
let gateCheckCommand = null;
let gateCheckCommandError = null;
if (best) {
	const roadmapText = readFileSync(resolve(root, ".pfdsl/roadmap.pfdsl"), "utf-8");

	try {
		const issueNumber = findIssueNumberForProcess(roadmapText, best);
		if (issueNumber) {
			const body = sh(`gh issue view ${issueNumber} --json body --jq .body`);
			({ designUnsettled, matchedLines: designUnsettledLines } = detectDesignUnsettled(body));
		} else {
			designUnsettledError = `no issue number found for process '${best}' in .pfdsl/roadmap.pfdsl`;
		}
	} catch (e) {
		designUnsettledError = e.message;
	}

	const artifactKey = findOutputArtifactForProcess(roadmapText, best);
	if (artifactKey) {
		gateCheckCommand = buildGateCheckCommand(artifactKey, base);
	} else {
		gateCheckCommandError = `no output artifact edge found for process '${best}' in .pfdsl/roadmap.pfdsl`;
	}
}

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
if (gateCheckCommandError) result.gateCheckCommandError = gateCheckCommandError;

console.log(JSON.stringify(result, null, 2));

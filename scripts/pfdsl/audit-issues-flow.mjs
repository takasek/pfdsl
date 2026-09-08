#!/usr/bin/env node
// Audits sync between GitHub issues and .pfdsl/roadmap.pfdsl.
// Usage: node scripts/pfdsl/audit-issues-flow.mjs [--enforce-issue <n> ...]

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	GH_UNAVAILABLE_EXIT_CODE,
	isGhUnavailableError,
} from "./lib/gh-compat.mjs";
import { createGitHubOps } from "./lib/github-ops.mjs";
import {
	buildProcessOutputs,
	computeFindings,
	computeLabelFindings,
	FLOW_LABELS,
	parseIssueProcesses,
	partitionFindings,
} from "./lib/issues-flow-audit.mjs";
import { parseDocument } from "./lib/yaml-require.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const githubOps = createGitHubOps({ cwd: root });

// node:util rather than a shared helper because this file is mirrored into
// .claude/skills/pfd-ops/install/ and runs in adopting repos, which have no
// scripts/lib/. Strict parsing keeps removed mutation modes rejected.
/** @type {number[]} issues whose missing_process must fail rather than advise */
let enforcedIssues = [];
try {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			"enforce-issue": { type: "string", multiple: true },
		},
		strict: true,
		allowPositionals: false,
	});
	enforcedIssues = (values["enforce-issue"] ?? []).map((value) => {
		const n = Number(value);
		if (!Number.isInteger(n) || n <= 0) {
			throw new TypeError(
				`--enforce-issue expects an issue number, got '${value}'`,
			);
		}
		return n;
	});
} catch (err) {
	console.error(`audit-issues-flow: ${err.message}`);
	process.exit(2);
}

// --- Read and split roadmap.pfdsl ---

const raw = readFileSync(resolve(root, ".pfdsl/roadmap.pfdsl"), "utf-8");

// File starts with "---\n"; frontmatter ends at the next line where trimEnd()==="---"
const lines = raw.split("\n");
let fmEnd = -1;
for (let i = 1; i < lines.length; i++) {
	if (lines[i].trimEnd() === "---") {
		fmEnd = i;
		break;
	}
}
if (fmEnd === -1) throw new Error("No closing --- found in roadmap.pfdsl");

const fmText = `${lines.slice(1, fmEnd).join("\n")}\n`;
const body = lines.slice(fmEnd + 1).join("\n");

// --- Fetch labels from GitHub ---

async function fetchLabels() {
	return await githubOps.listLabels();
}

// --- Fetch issues from GitHub ---

async function fetchIssues() {
	return (await githubOps.listIssues()).map(normalizeIssue);
}

function normalizeIssue(i) {
	return {
		number: i.number,
		state: i.state,
		labels: i.labels.map((l) => l.name),
		updatedAt: i.updatedAt,
	};
}

// --- Parse frontmatter ---

const fm = parseDocument(fmText).toJS();
const processes = parseIssueProcesses(fm);
const outputsByProcess = buildProcessOutputs(body);

// Expand each tracked process into one entry per (issueNumber, output artifact) pair.
const entries = [];
for (const proc of processes) {
	const outputs = outputsByProcess.get(proc.id) ?? [];
	for (const issueNumber of proc.issueNumbers) {
		for (const artifactId of outputs) {
			entries.push({
				processId: proc.id,
				issueNumber,
				artifactId,
				updatedAt: proc.updatedAt,
				priorities: proc.priorities,
			});
		}
	}
}

// --- Check labels ---

function exitGhUnavailable() {
	console.log(
		"gh unavailable: skipping GitHub-dependent checks (label sync, issue sync)",
	);
	process.exit(GH_UNAVAILABLE_EXIT_CODE);
}

let labels;
try {
	labels = await fetchLabels();
} catch (e) {
	if (isGhUnavailableError(e)) exitGhUnavailable();
	throw e;
}
const labelFindings = computeLabelFindings(FLOW_LABELS, labels);

if (labelFindings.length > 0) {
	console.log("label:");
	for (const f of labelFindings) {
		console.log(`  ${f.type} [${f.name}] ${f.detail}`);
	}
	process.exit(1);
}

// --- Compute and print findings ---

let issues;
try {
	issues = await fetchIssues();
} catch (e) {
	if (isGhUnavailableError(e)) exitGhUnavailable();
	throw e;
}
const findings = computeFindings(entries, issues);

function printFindings(findings) {
	const parts = partitionFindings(findings, { enforcedIssues });
	const { blocking, advisory } = parts;

	function fmtFinding(f) {
		const pid = f.processId ? ` [${f.processId}]` : "";
		const aid = f.artifactId ? ` -> ${f.artifactId}` : "";
		return `  #${f.issueNumber} ${f.type}${pid}${aid} ${f.detail}`;
	}

	if (blocking.length > 0) {
		console.log("blocking:");
		for (const f of blocking) console.log(fmtFinding(f));
	}
	if (advisory.length > 0) {
		console.log("advisory (does not fail this audit):");
		for (const f of advisory) console.log(fmtFinding(f));
	}
	return parts;
}

const { blocking } = printFindings(findings);
if (blocking.length === 0) {
	console.log("roadmap.pfdsl is in sync");
	process.exit(0);
}
process.exit(1);

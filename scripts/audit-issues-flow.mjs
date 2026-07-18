#!/usr/bin/env node
// Audits sync between GitHub issues and .pfdsl/roadmap.pfdsl.
// Usage: node scripts/audit-issues-flow.mjs [--fix]

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseIssueProcesses, buildProcessOutputs, computeFindings, applyFixes, applyClosedInFlowFixes, computeLabelFindings, FLOW_LABELS, isGhUnavailableError, GH_UNAVAILABLE_EXIT_CODE } from "./lib/issues-flow-audit.mjs";
import { parseDocument } from "./lib/yaml-require.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const fix = process.argv.includes("--fix");

// --- Read and split roadmap.pfdsl ---

const flowPath = resolve(root, ".pfdsl/roadmap.pfdsl");
const raw = readFileSync(flowPath, "utf-8");

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

const fmText = lines.slice(1, fmEnd).join("\n") + "\n";
const body = lines.slice(fmEnd + 1).join("\n");

// --- Fetch labels from GitHub ---

function fetchLabels() {
	const out = execFileSync("gh", ["label", "list", "--json", "name,description", "--limit", "100"]);
	return JSON.parse(out).map((l) => ({ name: l.name, description: l.description ?? "" }));
}

// --- Fetch issues from GitHub ---

function fetchIssues() {
	const out = execFileSync("gh", [
		"issue", "list",
		"--state", "all",
		"--json", "number,state,stateReason,labels,updatedAt",
		"--limit", "500",
	]);
	return JSON.parse(out).map((i) => ({
		number: i.number,
		state: i.state,
		stateReason: i.stateReason ?? null,
		labels: i.labels.map((l) => l.name),
		updatedAt: i.updatedAt,
	}));
}

// --- Parse frontmatter ---

const doc = parseDocument(fmText);
const fm = doc.toJS();
const processes = parseIssueProcesses(fm);
const outputsByProcess = buildProcessOutputs(body);

// Mark artifacts that are consumed (have downstream) in the flow body
function getConsumedArtifactIds(body) {
	const consumed = new Set();
	for (const line of body.split('\n')) {
		const idx = line.indexOf('>>');
		if (idx < 0) continue;
		const left = line.slice(0, idx);
		for (const m of left.matchAll(/\b([a-z][a-z0-9_]*)\b/g)) {
			consumed.add(m[1]);
		}
	}
	return consumed;
}

const consumedIds = getConsumedArtifactIds(body);

// Expand each tracked process into one entry per (issueNumber, output artifact) pair.
// NOTE: if a single process ever has both multiple issueNumbers AND multiple outputs,
// this cross-product can pair an issue with an output it doesn't actually track (e.g.
// issue #5 closing could act on an output really tracked by issue #6). This is a known,
// accepted limitation — see docs/superpowers/specs/2026-07-04-issue-tracking-id-on-process-design.md
// ("1 processが複数出力artifactを持つ場合"). Not present in current roadmap.pfdsl data.
// Separately, applyClosedInFlowFixes guards against fully deleting a shared sole-output
// process until every one of its tracking issues is closed, so a still-open sibling issue
// never loses its tracked process out from under it.
const entries = [];
for (const proc of processes) {
	const outputs = outputsByProcess.get(proc.id) ?? [];
	for (const issueNumber of proc.issueNumbers) {
		for (const artifactId of outputs) {
			entries.push({
				processId: proc.id,
				issueNumber,
				artifactId,
				status: fm.artifact?.[artifactId]?.status,
				hasDownstream: consumedIds.has(artifactId),
				updatedAt: proc.updatedAt,
				priorities: proc.priorities,
			});
		}
	}
}

// --- Check labels ---

function exitGhUnavailable() {
	console.log("gh unavailable: skipping GitHub-dependent checks (label sync, issue sync)");
	process.exit(GH_UNAVAILABLE_EXIT_CODE);
}

let labels;
try {
	labels = fetchLabels();
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
	if (fix) {
		for (const f of labelFindings) {
			if (f.type === "label_missing") {
				execFileSync("gh", ["label", "create", f.name, "--description", f.description, "--color", "ededed"]);
			} else if (f.type === "label_description_mismatch") {
				execFileSync("gh", ["label", "edit", f.name, "--description", f.description]);
			}
		}
		console.log("fixed label findings");
	} else {
		process.exit(1);
	}
}

// --- First pass: compute and print findings ---

let issues;
try {
	issues = fetchIssues();
} catch (e) {
	if (isGhUnavailableError(e)) exitGhUnavailable();
	throw e;
}
let findings = computeFindings(entries, issues);

function printFindings(findings) {
	const fixable = findings.filter((f) => f.fixVia);
	const manual = findings.filter((f) => !f.fixVia);

	function fmtFinding(f) {
		const pid = f.processId ? ` [${f.processId}]` : "";
		const aid = f.artifactId ? ` -> ${f.artifactId}` : "";
		return `  #${f.issueNumber} ${f.type}${pid}${aid} ${f.detail}`;
	}

	if (fixable.length > 0) {
		console.log("fixable:");
		for (const f of fixable) console.log(fmtFinding(f));
	}
	if (manual.length > 0) {
		console.log("manual:");
		for (const f of manual) console.log(fmtFinding(f));
	}
}

if (findings.length === 0) {
	console.log("roadmap.pfdsl is in sync");
	process.exit(0);
}

printFindings(findings);

if (!fix) {
	process.exit(1);
}

// --- Apply fixes ---

// 1. Add flow:managed label to issues missing it
const missingLabel = findings.filter((f) => f.fixVia === "github");
for (const f of missingLabel) {
	execFileSync("gh", ["issue", "edit", String(f.issueNumber), "--add-label", "flow:managed"]);
}

// 2. Re-fetch issues (labeling changes updatedAt), recompute
issues = fetchIssues();
findings = computeFindings(entries, issues);

// 3. Apply document and body fixes
const issuesByNumber = new Map(issues.map((i) => [i.number, i]));
const docBefore = doc.toString({ lineWidth: 0 });
applyFixes(doc, findings, issuesByNumber);
const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
const docAfter = doc.toString({ lineWidth: 0 });

if (docAfter !== docBefore || newBody !== body) {
	const newRaw = "---\n" + docAfter + "---\n" + newBody;
	writeFileSync(flowPath, newRaw, "utf-8");
	console.log("updated .pfdsl/roadmap.pfdsl");
}

// 4. Report remaining manual findings
const remaining = findings.filter((f) => !f.fixVia);
if (remaining.length > 0) {
	console.log("remaining manual findings:");
	printFindings(remaining);
	process.exit(1);
}
process.exit(0);

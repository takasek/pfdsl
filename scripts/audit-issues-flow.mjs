#!/usr/bin/env node
// Audits sync between GitHub issues and .pfdsl/plan.pfdsl.
// Usage: node scripts/audit-issues-flow.mjs [--fix]

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseIssueArtifacts, computeFindings, applyFixes, applyClosedInFlowFixes, computeLabelFindings, FLOW_LABELS } from "../.claude/skills/pfd-ops/lib/issues-flow-audit.mjs";
import { parseDocument } from "./lib/yaml-require.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const fix = process.argv.includes("--fix");

// --- Read and split plan.pfdsl ---

const flowPath = resolve(root, ".pfdsl/plan.pfdsl");
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
if (fmEnd === -1) throw new Error("No closing --- found in plan.pfdsl");

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
		"--json", "number,state,labels,updatedAt",
		"--limit", "500",
	]);
	return JSON.parse(out).map((i) => ({
		number: i.number,
		state: i.state,
		labels: i.labels.map((l) => l.name),
		updatedAt: i.updatedAt,
	}));
}

// --- Parse frontmatter ---

const doc = parseDocument(fmText);
const fm = doc.toJS();
const artifacts = parseIssueArtifacts(fm);

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
for (const art of artifacts) {
	art.hasDownstream = consumedIds.has(art.id);
}

// --- Check labels ---

const labels = fetchLabels();
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

let issues = fetchIssues();
let findings = computeFindings(artifacts, issues);

function printFindings(findings) {
	const fixable = findings.filter((f) => f.fixVia);
	const manual = findings.filter((f) => !f.fixVia);

	if (fixable.length > 0) {
		console.log("fixable:");
		for (const f of fixable) {
			const aid = f.artifactId ? ` [${f.artifactId}]` : "";
			console.log(`  #${f.issueNumber} ${f.type}${aid} ${f.detail}`);
		}
	}
	if (manual.length > 0) {
		console.log("manual:");
		for (const f of manual) {
			const aid = f.artifactId ? ` [${f.artifactId}]` : "";
			console.log(`  #${f.issueNumber} ${f.type}${aid} ${f.detail}`);
		}
	}
}

if (findings.length === 0) {
	console.log("plan.pfdsl is in sync");
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
findings = computeFindings(artifacts, issues);

// 3. Apply document and body fixes
const issuesByNumber = new Map(issues.map((i) => [i.number, i]));
const docBefore = doc.toString();
applyFixes(doc, findings, issuesByNumber);
const newBody = applyClosedInFlowFixes(doc, body, findings);
const docAfter = doc.toString();

if (docAfter !== docBefore || newBody !== body) {
	const newRaw = "---\n" + docAfter + "---\n" + newBody;
	writeFileSync(flowPath, newRaw, "utf-8");
	console.log("updated .pfdsl/plan.pfdsl");
}

// 4. Report remaining manual findings
const remaining = findings.filter((f) => !f.fixVia);
if (remaining.length > 0) {
	console.log("remaining manual findings:");
	printFindings(remaining);
	process.exit(1);
}
process.exit(0);

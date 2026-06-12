#!/usr/bin/env node
// Audits sync between GitHub issues and docs/issues_flow.pfdsl.
// Usage: node scripts/audit-issues-flow.mjs [--fix]

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseIssueArtifacts, computeFindings, applyFixes } from "./lib/issues-flow-audit.mjs";
import { parseDocument } from "./lib/yaml-require.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const fix = process.argv.includes("--fix");

// --- Read and split issues_flow.pfdsl ---

const flowPath = resolve(root, "docs/issues_flow.pfdsl");
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
if (fmEnd === -1) throw new Error("No closing --- found in issues_flow.pfdsl");

const fmText = lines.slice(1, fmEnd).join("\n") + "\n";
const body = lines.slice(fmEnd + 1).join("\n");

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
	console.log("issues_flow is in sync");
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

// 3. Apply document fixes
const issuesByNumber = new Map(issues.map((i) => [i.number, i]));
const docBefore = doc.toString();
applyFixes(doc, findings, issuesByNumber);
const docAfter = doc.toString();

if (docAfter !== docBefore) {
	const newRaw = "---\n" + docAfter + "---\n" + body;
	writeFileSync(flowPath, newRaw, "utf-8");
	console.log("updated docs/issues_flow.pfdsl");
}

// 4. Report remaining manual findings
const remaining = findings.filter((f) => !f.fixVia);
if (remaining.length > 0) {
	console.log("remaining manual findings:");
	printFindings(remaining);
	process.exit(1);
}
process.exit(0);

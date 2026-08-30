#!/usr/bin/env node
// DO NOT EDIT. Authoritative source: .claude/skills/pfd-ops/install/scripts/pfdsl/audit-issues-flow.mjs.
// Audits sync between GitHub issues and .pfdsl/roadmap.pfdsl.
// Usage: node scripts/pfdsl/audit-issues-flow.mjs [--fix] [--enforce-issue <n> ...] [--check-closed-registration <n>]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
	GH_UNAVAILABLE_EXIT_CODE,
	isGhUnavailableError,
} from "./lib/gh-compat.mjs";
import { createGitHubOps } from "./lib/github-ops.mjs";
import {
	applyClosedInFlowFixes,
	applyFixes,
	buildProcessOutputs,
	classifyClosedIssueRegistration,
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

// strict parsing, not includes("--fix"): --fix is the one irreversible thing
// this script does, and includes() answers false for --fix=true — the audit
// then runs read-only while the caller believes the roadmap was repaired
// (#648). node:util rather than a shared helper because this file is mirrored
// into .claude/skills/pfd-ops/install/ and runs in adopting repos, which have
// no scripts/lib/.
let fix;
/** @type {number[]} issues whose missing_process must fail rather than advise */
let enforcedIssues = [];
/** @type {number|undefined} issue delivered by the close event */
let checkClosedRegistration;
try {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			fix: { type: "boolean" },
			"enforce-issue": { type: "string", multiple: true },
			"check-closed-registration": { type: "string" },
		},
		strict: true,
		allowPositionals: false,
	});
	fix = values.fix === true;
	enforcedIssues = (values["enforce-issue"] ?? []).map((value) => {
		const n = Number(value);
		if (!Number.isInteger(n) || n <= 0) {
			throw new TypeError(
				`--enforce-issue expects an issue number, got '${value}'`,
			);
		}
		return n;
	});
	const checkValue = values["check-closed-registration"];
	if (checkValue !== undefined) {
		const n = Number(checkValue);
		if (!Number.isInteger(n) || n <= 0) {
			throw new TypeError(
				`--check-closed-registration expects an issue number, got '${checkValue}'`,
			);
		}
		checkClosedRegistration = n;
	}
	if (
		checkClosedRegistration !== undefined &&
		(fix || enforcedIssues.length > 0)
	) {
		throw new TypeError(
			"--check-closed-registration is mutually exclusive with --fix and --enforce-issue",
		);
	}
} catch (err) {
	console.error(`audit-issues-flow: ${err.message}`);
	process.exit(2);
}

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
		stateReason: i.stateReason ?? null,
		labels: i.labels.map((l) => l.name),
		updatedAt: i.updatedAt,
	};
}

async function fetchClosedIssue(number) {
	try {
		const issue = await githubOps.viewIssue({
			number,
			fields: ["number", "state", "stateReason", "labels", "updatedAt"],
		});
		return normalizeIssue(issue);
	} catch (e) {
		const detail = `${e?.stderr ?? ""} ${e?.message ?? ""}`;
		if (/could not (?:resolve|find)|not found|no issue/i.test(detail)) {
			return undefined;
		}
		throw e;
	}
}

// --- Parse frontmatter ---

const doc = parseDocument(fmText);
const fm = doc.toJS();
const processes = parseIssueProcesses(fm);
const outputsByProcess = buildProcessOutputs(body);

// Mark artifacts that are consumed (have downstream) in the flow body
function getConsumedArtifactIds(body) {
	const consumed = new Set();
	for (const line of body.split("\n")) {
		const idx = line.indexOf(">>");
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

if (checkClosedRegistration !== undefined) {
	let issue;
	try {
		issue = await fetchClosedIssue(checkClosedRegistration);
	} catch (e) {
		if (isGhUnavailableError(e)) exitGhUnavailable();
		throw e;
	}
	const result = classifyClosedIssueRegistration(issue, entries);
	console.log(
		`closed-registration: ${result.status} #${checkClosedRegistration} ${result.detail}`,
	);
	process.exit(result.status === "PASS" ? 0 : 1);
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
	if (fix) {
		for (const f of labelFindings) {
			if (f.type === "label_missing") {
				await githubOps.createLabel({
					name: f.name,
					description: f.description,
					color: "ededed",
				});
			} else if (f.type === "label_description_mismatch") {
				await githubOps.editLabel({
					name: f.name,
					description: f.description,
				});
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
	issues = await fetchIssues();
} catch (e) {
	if (isGhUnavailableError(e)) exitGhUnavailable();
	throw e;
}
let findings = computeFindings(entries, issues);

// Returns the partition it printed, so callers deciding the exit code do not
// walk the same findings again.
function printFindings(findings) {
	const parts = partitionFindings(findings, { enforcedIssues });
	const { fixable, manual, advisory } = parts;

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
	if (advisory.length > 0) {
		console.log("advisory (does not fail this audit):");
		for (const f of advisory) console.log(fmtFinding(f));
	}
	return parts;
}

// Advisory findings never fail the audit (#963): they report drift that a
// parallel session's unmerged branch produces, which this tree can clear only
// for the issue it is itself working on. So "in sync" means "nothing fixable
// and nothing manual", which also covers the no-findings-at-all case.
const { fixable: fixableFindings, manual: manualFindings } =
	printFindings(findings);
if (fixableFindings.length === 0 && manualFindings.length === 0) {
	console.log("roadmap.pfdsl is in sync");
	process.exit(0);
}

if (!fix) {
	process.exit(1);
}

// --- Apply fixes ---

// 1. Add flow:managed label to issues missing it
const missingLabel = findings.filter((f) => f.fixVia === "github");
for (const f of missingLabel) {
	await githubOps.addIssueLabel({
		number: f.issueNumber,
		label: "flow:managed",
	});
}

// 2. Re-fetch issues (labeling changes updatedAt), recompute
issues = await fetchIssues();
findings = computeFindings(entries, issues);

// 3. Apply document and body fixes
const issuesByNumber = new Map(issues.map((i) => [i.number, i]));
const docBefore = doc.toString({ lineWidth: 0 });
applyFixes(doc, findings, issuesByNumber);
const newBody = applyClosedInFlowFixes(doc, body, findings, issuesByNumber);
const docAfter = doc.toString({ lineWidth: 0 });

if (docAfter !== docBefore || newBody !== body) {
	const newRaw = `---\n${docAfter}---\n${newBody}`;
	writeFileSync(flowPath, newRaw, "utf-8");
	console.log("updated .pfdsl/roadmap.pfdsl");
}

// 4. Report remaining manual findings
const remaining = partitionFindings(findings, { enforcedIssues }).manual;
if (remaining.length > 0) {
	console.log("remaining manual findings:");
	printFindings(remaining);
	process.exit(1);
}
process.exit(0);

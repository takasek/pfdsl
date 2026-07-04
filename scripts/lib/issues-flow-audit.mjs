// Pure logic for auditing sync between GitHub issues and .pfdsl/roadmap.pfdsl.
// Zero I/O. No imports.

export const FLOW_LABELS = [
	{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
	{ name: "flow:exempt", description: "intentionally out of .pfdsl/roadmap.pfdsl scope" },
];

/**
 * @param {{ name: string, description: string }[]} expectedLabels
 * @param {{ name: string, description: string }[]} actualLabels
 * @returns {{ type: string, name: string, description: string, detail: string, fixVia: "github" }[]}
 */
export function computeLabelFindings(expectedLabels, actualLabels) {
	const actualByName = new Map(actualLabels.map((l) => [l.name, l]));
	const findings = [];
	for (const expected of expectedLabels) {
		const actual = actualByName.get(expected.name);
		if (!actual) {
			findings.push({
				type: "label_missing",
				name: expected.name,
				description: expected.description,
				detail: `label "${expected.name}" does not exist`,
				fixVia: "github",
			});
		} else if (actual.description !== expected.description) {
			findings.push({
				type: "label_description_mismatch",
				name: expected.name,
				description: expected.description,
				detail: `expected: "${expected.description}", actual: "${actual.description}"`,
				fixVia: "github",
			});
		}
	}
	return findings;
}

/**
 * @param {object} frontmatter - parsed YAML object
 * @returns {{ id: string, issueNumbers: number[], updatedAt: string|undefined, priorities: string[] }[]}
 */
export function parseIssueProcesses(frontmatter) {
	const process = frontmatter.process;
	if (!process) return [];
	const result = [];
	for (const [id, val] of Object.entries(process)) {
		const prefixMatch = id.match(/^(?:i\d+_)+/);
		if (!prefixMatch) continue;
		const issueNumbers = [...prefixMatch[0].matchAll(/i(\d+)_/g)].map((m) => Number(m[1]));
		const tags = val.tags ?? [];
		const priorities = tags.filter((t) => t.startsWith("priority:")).sort();
		result.push({ id, issueNumbers, updatedAt: val.updated_at, priorities });
	}
	return result;
}

/**
 * @param {{ processId: string, issueNumber: number, artifactId: string, status: string|undefined, hasDownstream: boolean, updatedAt: string|undefined, priorities: string[] }[]} entries - priorities must be pre-sorted
 * @param {{ number: number, state: "OPEN"|"CLOSED", stateReason?: string|null, labels: string[], updatedAt: string }[]} issues
 * @returns {{ type: string, issueNumber: number, processId: string|undefined, artifactId: string|undefined, detail: string, fixVia?: "file"|"github"|"flow", hasDownstream?: boolean }[]}
 */
export function computeFindings(entries, issues) {
	const trackedIssueNumbers = new Set(entries.map((e) => e.issueNumber));
	const issuesByNumber = new Map();
	for (const iss of issues) {
		issuesByNumber.set(iss.number, iss);
	}

	const findings = [];

	// Check each tracked entry against its issue
	for (const entry of entries) {
		const iss = issuesByNumber.get(entry.issueNumber);
		if (!iss) {
			findings.push({
				type: "unknown_issue",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `issue #${entry.issueNumber} not found in issues list`,
			});
			continue;
		}

		if (iss.state === "CLOSED") {
			// closed + done + has downstream = expected state, no action needed
			if (entry.status === "done" && entry.hasDownstream) {
				continue;
			}
			const isNotPlanned = iss.stateReason === "NOT_PLANNED";
			findings.push({
				type: isNotPlanned ? "closed_not_planned" : "closed_in_flow",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				hasDownstream: entry.hasDownstream,
				detail: isNotPlanned
					? entry.hasDownstream
						? `issue closed as not planned but has downstream consumers — remove manually`
						: `issue closed as not planned — terminal chain will be removed`
					: `issue is closed — delete the chain if terminal, or clear iN_ issue-tracking fields on the process if downstream processes consume the output`,
				fixVia: isNotPlanned && entry.hasDownstream ? undefined : "flow",
			});
			// skip all freshness checks for closed issues
			continue;
		}

		// OPEN issue with a tracked process
		const hasManaged = iss.labels.includes("flow:managed");
		const hasExempt = iss.labels.includes("flow:exempt");

		if (hasExempt) {
			findings.push({
				type: "exempt_conflict",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `issue has flow:exempt label but has a tracked process in the flow`,
			});
		} else if (!hasManaged) {
			findings.push({
				type: "missing_label",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `open issue with tracked process is missing "flow:managed" label`,
				fixVia: "github",
			});
		}

		// Freshness checks for open issues
		if (entry.updatedAt !== iss.updatedAt) {
			const val = entry.updatedAt ?? "(none)";
			findings.push({
				type: "stale_updated_at",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `process: ${val}, issue: ${iss.updatedAt}`,
				fixVia: "file",
			});
		}

		// Priority drift
		const issuePriorities = iss.labels.filter((l) => l.startsWith("priority:")).sort();
		if (JSON.stringify(issuePriorities) !== JSON.stringify(entry.priorities)) {
			findings.push({
				type: "priority_drift",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `process: [${entry.priorities.join(", ")}], issue: [${issuePriorities.join(", ")}]`,
				fixVia: "file",
			});
		}
	}

	// Check each issue for a missing tracked process
	for (const iss of issues) {
		if (iss.state !== "OPEN") continue;
		if (trackedIssueNumbers.has(iss.number)) continue;

		const hasManaged = iss.labels.includes("flow:managed");
		const hasExempt = iss.labels.includes("flow:exempt");

		if (hasExempt) {
			// flow:exempt and no tracked process: no finding
			continue;
		}
		if (hasManaged) {
			findings.push({
				type: "missing_process",
				issueNumber: iss.number,
				processId: undefined,
				artifactId: undefined,
				detail: `issue has flow:managed label but no tracked process in the flow`,
			});
		} else {
			findings.push({
				type: "untriaged",
				issueNumber: iss.number,
				processId: undefined,
				artifactId: undefined,
				detail: `open issue has no tracked process and no flow label`,
			});
		}
	}

	// Stable sort by issueNumber ascending
	findings.sort((a, b) => a.issueNumber - b.issueNumber);

	return findings;
}

/**
 * Applies file-fixable findings to the yaml Document in place.
 * @param {import("yaml").Document} doc
 * @param {{ type: string, issueNumber: number, processId: string|undefined, fixVia?: "file"|"github"|"flow" }[]} findings
 * @param {Map<number, { number: number, state: string, labels: string[], updatedAt: string }>} issuesByNumber
 */
export function applyFixes(doc, findings, issuesByNumber) {
	for (const finding of findings) {
		if (finding.fixVia !== "file") continue;
		const { type, processId, issueNumber } = finding;
		const issue = issuesByNumber.get(issueNumber);
		if (!issue) continue;

		if (type === "stale_updated_at") {
			doc.setIn(["process", processId, "updated_at"], issue.updatedAt);
		} else if (type === "priority_drift") {
			// Get existing tags preserving order, remove priority: ones
			const existingTags = doc.getIn(["process", processId, "tags"]);
			let nonPriorityTags = [];
			if (existingTags) {
				// existingTags may be a yaml Seq node or plain array
				const arr = existingTags.toJSON ? existingTags.toJSON() : existingTags;
				nonPriorityTags = arr.filter((t) => !t.startsWith("priority:"));
			}
			const issuePriorities = issue.labels.filter((l) => l.startsWith("priority:")).sort();
			const newTags = [...nonPriorityTags, ...issuePriorities];
			if (newTags.length === 0) {
				doc.deleteIn(["process", processId, "tags"]);
			} else {
				doc.setIn(["process", processId, "tags"], newTags);
			}
		}
		// other types: ignore
	}
}

/**
 * Maps each process id appearing in a flow edge to the list of artifact ids
 * it produces (RHS of `>>`), merged across all edge lines mentioning it.
 * @param {string} body
 * @returns {Map<string, string[]>}
 */
export function buildProcessOutputs(body) {
	const result = new Map();
	for (const line of body.split("\n")) {
		const parsed = parseEdgeLine(line);
		if (!parsed) continue;
		const existing = result.get(parsed.process) ?? [];
		result.set(parsed.process, [...existing, ...parsed.outputs]);
	}
	return result;
}

/**
 * Parses a flow edge line and returns its parts, or null if not an edge.
 * Edge forms:
 *   inputs >> PROCESS -> output
 *   inputs >> PROCESS -> [out1, out2, ...]
 * Returns { raw, prefix, process, outputs: string[], isList }
 * where prefix is everything up to and including ">> PROCESS -> "
 * @param {string} line
 * @returns {{ raw: string, prefix: string, process: string, outputs: string[], isList: boolean }|null}
 */
function parseEdgeLine(line) {
	const m = line.match(/^(.*>>\s*(\w+)\s*->\s*)(\[([^\]]*)\]|(\w+))\s*$/);
	if (!m) return null;
	const prefix = m[1];
	const process = m[2];
	const isList = m[3].startsWith("[");
	const outputs = isList
		? m[4].split(",").map((s) => s.trim()).filter(Boolean)
		: [m[5]];
	return { raw: line, prefix, process, outputs, isList };
}

/**
 * Collapses 3+ consecutive newlines to 2 and trims trailing blank lines to a single newline.
 * @param {string} body
 * @returns {string}
 */
export function normalizeBody(body) {
	return body.replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
}

/**
 * Applies closed_in_flow fixes to both the yaml Document (in place) and the flow body string.
 * Returns the (possibly modified) body string.
 *
 * Two cases per finding:
 *   A. hasDownstream === false (terminal): remove artifact from frontmatter. If the producing
 *      process has no other outputs, remove the process too and drop the edge line. If the
 *      process has other outputs, remove only this artifact from the output list in the edge.
 *   B. hasDownstream === true and status !== done (non-terminal): the iN_ prefix on the process
 *      is permanent, so there is nothing to rename. Just clear the process's issue-tracking
 *      fields (tags, updated_at) — status is already correct from the completion commit.
 *
 * @param {import("yaml").Document} doc
 * @param {string} body
 * @param {{ type: string, processId: string, artifactId: string, hasDownstream?: boolean }[]} findings
 * @returns {string} new body string
 */
export function applyClosedInFlowFixes(doc, body, findings) {
	const closedFindings = findings.filter(
		(f) => (f.type === "closed_in_flow" || f.type === "closed_not_planned") && f.fixVia === "flow",
	);
	if (closedFindings.length === 0) return body;

	let lines = body.split("\n");

	for (const finding of closedFindings) {
		const { processId, artifactId, hasDownstream } = finding;

		if (!hasDownstream) {
			// Case A: terminal — remove artifact from frontmatter
			doc.deleteIn(["artifact", artifactId]);

			// Find the producing edge line for this process
			const edgeIdx = lines.findIndex((line) => {
				const parsed = parseEdgeLine(line);
				return parsed && parsed.process === processId && parsed.outputs.includes(artifactId);
			});

			if (edgeIdx >= 0) {
				const parsed = parseEdgeLine(lines[edgeIdx]);
				const remainingOutputs = parsed.outputs.filter((o) => o !== artifactId);

				if (remainingOutputs.length === 0) {
					// A1: sole-output process — remove process from frontmatter and drop the edge line
					doc.deleteIn(["process", processId]);
					lines.splice(edgeIdx, 1);
				} else if (remainingOutputs.length === 1) {
					// A2: multi-output, now single — rewrite as non-list
					lines[edgeIdx] = `${parsed.prefix}${remainingOutputs[0]}`;
				} else {
					// A2: multi-output — rewrite list without removed artifact
					lines[edgeIdx] = `${parsed.prefix}[${remainingOutputs.join(", ")}]`;
				}
			}
		} else {
			// Case B: non-terminal — iN_ is permanent on the process, nothing to rename.
			// Only clear the fields that stop being meaningful once the issue is closed.
			doc.deleteIn(["process", processId, "tags"]);
			doc.deleteIn(["process", processId, "updated_at"]);
		}
	}

	return normalizeBody(lines.join("\n"));
}

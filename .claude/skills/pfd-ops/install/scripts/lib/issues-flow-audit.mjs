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
 * @returns {{ id: string, issueNumber: number, status: string|undefined, updatedAt: string|undefined, priorities: string[] }[]}
 */
export function parseIssueArtifacts(frontmatter) {
	const artifact = frontmatter.artifact;
	if (!artifact) return [];
	const result = [];
	for (const [id, val] of Object.entries(artifact)) {
		const m = id.match(/^i(\d+)_/);
		if (!m) continue;
		const tags = val.tags ?? [];
		const priorities = tags.filter((t) => t.startsWith("priority:")).sort();
		result.push({
			id,
			issueNumber: Number(m[1]),
			status: val.status,
			updatedAt: val.updated_at,
			priorities,
		});
	}
	return result;
}

/**
 * @param {{ id: string, issueNumber: number, status: string|undefined, updatedAt: string|undefined, priorities: string[], hasDownstream?: boolean }[]} artifacts - priorities must be pre-sorted (parseIssueArtifacts guarantees this)
 * @param {{ number: number, state: "OPEN"|"CLOSED", labels: string[], updatedAt: string }[]} issues
 * @returns {{ type: string, issueNumber: number, artifactId: string|undefined, detail: string, fixVia?: "file"|"github" }[]}
 */
export function computeFindings(artifacts, issues) {
	const artifactIssueNumbers = new Set(artifacts.map((a) => a.issueNumber));
	const issuesByNumber = new Map();
	for (const iss of issues) {
		issuesByNumber.set(iss.number, iss);
	}

	const findings = [];

	// Check each artifact against its issue
	for (const art of artifacts) {
		const iss = issuesByNumber.get(art.issueNumber);
		if (!iss) {
			findings.push({
				type: "unknown_issue",
				issueNumber: art.issueNumber,
				artifactId: art.id,
				detail: `issue #${art.issueNumber} not found in issues list`,
			});
			continue;
		}

		if (iss.state === "CLOSED") {
			// closed + done + has downstream = expected state, no action needed
			if (art.status === "done" && art.hasDownstream) {
				continue;
			}
			findings.push({
				type: "closed_in_flow",
				issueNumber: art.issueNumber,
				artifactId: art.id,
				hasDownstream: art.hasDownstream,
				detail: `issue is closed — delete the chain if terminal, or strip the iN_ prefix to demote it to a plain done artifact if downstream processes consume it`,
				fixVia: "flow",
			});
			// skip all freshness checks for closed issues
			continue;
		}

		// OPEN issue with artifact
		const hasManaged = iss.labels.includes("flow:managed");
		const hasExempt = iss.labels.includes("flow:exempt");

		if (hasExempt) {
			findings.push({
				type: "exempt_conflict",
				issueNumber: art.issueNumber,
				artifactId: art.id,
				detail: `issue has flow:exempt label but has an artifact in the flow`,
			});
		}

		if (!hasManaged) {
			findings.push({
				type: "missing_label",
				issueNumber: art.issueNumber,
				artifactId: art.id,
				detail: `open issue with artifact is missing "flow:managed" label`,
				fixVia: "github",
			});
		}

		// Freshness checks for open issues
		if (art.updatedAt !== iss.updatedAt) {
			const artVal = art.updatedAt ?? "(none)";
			findings.push({
				type: "stale_updated_at",
				issueNumber: art.issueNumber,
				artifactId: art.id,
				detail: `artifact: ${artVal}, issue: ${iss.updatedAt}`,
				fixVia: "file",
			});
		}

		// Priority drift
		const issuePriorities = iss.labels.filter((l) => l.startsWith("priority:")).sort();
		if (JSON.stringify(issuePriorities) !== JSON.stringify(art.priorities)) {
			findings.push({
				type: "priority_drift",
				issueNumber: art.issueNumber,
				artifactId: art.id,
				detail: `artifact: [${art.priorities.join(", ")}], issue: [${issuePriorities.join(", ")}]`,
				fixVia: "file",
			});
		}
	}

	// Check each issue for missing artifact
	for (const iss of issues) {
		if (iss.state !== "OPEN") continue;
		if (artifactIssueNumbers.has(iss.number)) continue;

		const hasManaged = iss.labels.includes("flow:managed");
		const hasExempt = iss.labels.includes("flow:exempt");

		if (hasExempt) {
			// flow:exempt and no artifact: no finding
			continue;
		}
		if (hasManaged) {
			findings.push({
				type: "missing_artifact",
				issueNumber: iss.number,
				artifactId: undefined,
				detail: `issue has flow:managed label but no artifact in the flow`,
			});
		} else {
			findings.push({
				type: "untriaged",
				issueNumber: iss.number,
				artifactId: undefined,
				detail: `open issue has no artifact and no flow label`,
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
 * @param {{ type: string, issueNumber: number, artifactId: string|undefined, fixVia?: "file"|"github"|"flow" }[]} findings
 * @param {Map<number, { number: number, state: string, labels: string[], updatedAt: string }>} issuesByNumber
 */
export function applyFixes(doc, findings, issuesByNumber) {
	for (const finding of findings) {
		if (finding.fixVia !== "file") continue;
		const { type, artifactId, issueNumber } = finding;
		const issue = issuesByNumber.get(issueNumber);
		if (!issue) continue;

		if (type === "stale_updated_at") {
			doc.setIn(["artifact", artifactId, "updated_at"], issue.updatedAt);
		} else if (type === "priority_drift") {
			// Get existing tags preserving order, remove priority: ones
			const existingTags = doc.getIn(["artifact", artifactId, "tags"]);
			let nonPriorityTags = [];
			if (existingTags) {
				// existingTags may be a yaml Seq node or plain array
				const arr = existingTags.toJSON ? existingTags.toJSON() : existingTags;
				nonPriorityTags = arr.filter((t) => !t.startsWith("priority:"));
			}
			const issuePriorities = issue.labels.filter((l) => l.startsWith("priority:")).sort();
			const newTags = [...nonPriorityTags, ...issuePriorities];
			if (newTags.length === 0) {
				doc.deleteIn(["artifact", artifactId, "tags"]);
			} else {
				doc.setIn(["artifact", artifactId, "tags"], newTags);
			}
		}
		// other types: ignore
	}
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
 * Applies closed_in_flow fixes to both the yaml Document (in place) and the flow body string.
 * Returns the (possibly modified) body string.
 *
 * Two cases per finding:
 *   A. hasDownstream === false (terminal): remove artifact from frontmatter. If the producing
 *      process has no other outputs, remove the process too and drop the edge line. If the
 *      process has other outputs, remove only this artifact from the output list in the edge.
 *   B. hasDownstream === true and status !== done (demote): strip iN_ prefix → new plain id,
 *      set status: done, remove updated_at and tags. Update all body references.
 *
 * @param {import("yaml").Document} doc
 * @param {string} body
 * @param {{ type: string, artifactId: string, hasDownstream?: boolean }[]} findings
 * @returns {string} new body string
 */
export function applyClosedInFlowFixes(doc, body, findings) {
	const closedFindings = findings.filter((f) => f.type === "closed_in_flow" && f.fixVia === "flow");
	if (closedFindings.length === 0) return body;

	let lines = body.split("\n");

	for (const finding of closedFindings) {
		const { artifactId, hasDownstream } = finding;

		if (!hasDownstream) {
			// Case A: terminal — remove artifact from frontmatter
			doc.deleteIn(["artifact", artifactId]);

			// Find the producing edge line (artifact appears on RHS)
			const edgeIdx = lines.findIndex((line) => {
				const parsed = parseEdgeLine(line);
				return parsed && parsed.outputs.includes(artifactId);
			});

			if (edgeIdx >= 0) {
				const parsed = parseEdgeLine(lines[edgeIdx]);
				const remainingOutputs = parsed.outputs.filter((o) => o !== artifactId);

				if (remainingOutputs.length === 0) {
					// A1: sole-output process — remove process from frontmatter and drop the edge line
					doc.deleteIn(["process", parsed.process]);
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
			// Case B: non-terminal not-done — demote by stripping iN_ prefix
			const newId = artifactId.replace(/^i\d+_/, "");

			// Reuse the existing YAML Map node to preserve scalar quoting/styling.
			// Do NOT call toJSON(): it flattens nodes into plain strings, which causes
			// setIn to re-emit them as PLAIN scalars. A value like
			//   description: some text #4 more text
			// is parsed as value="some text" comment="4 more text", and toJSON()
			// silently discards the comment — the data is lost permanently.
			const mapNode = doc.getIn(["artifact", artifactId]);

			doc.deleteIn(["artifact", artifactId]);
			doc.setIn(["artifact", newId], mapNode);

			// After reuse, fix up PLAIN scalars whose original text contained ' #':
			// the YAML parser stored the ' #...' portion as an inline comment on the
			// node. Reconstruct the full value and force-quote so the next parse
			// doesn't truncate it again.
			if (mapNode && mapNode.items) {
				for (const pair of mapNode.items) {
					const val = pair.value;
					if (val && val.type === "PLAIN" && typeof val.comment === "string" && val.comment.length > 0) {
						val.value = val.value + " #" + val.comment;
						val.comment = undefined;
						val.type = "QUOTE_DOUBLE";
					}
				}
			}

			// Set status to done and remove issue-tracking fields.
			doc.setIn(["artifact", newId, "status"], "done");
			doc.deleteIn(["artifact", newId, "tags"]);
			doc.deleteIn(["artifact", newId, "updated_at"]);

			// Update all references in body
			// Use word-boundary regex: match artifactId as a whole word token
			const re = new RegExp(`\\b${artifactId}\\b`, "g");
			lines = lines.map((line) => line.replace(re, newId));
		}
	}

	return lines.join("\n");
}

// Pure logic for auditing sync between GitHub issues and .pfdsl/plan.pfdsl.
// Zero I/O. No imports.

export const FLOW_LABELS = [
	{ name: "flow:managed", description: "tracked in .pfdsl/plan.pfdsl" },
	{ name: "flow:exempt", description: "intentionally out of .pfdsl/plan.pfdsl scope" },
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
				detail: `issue is closed — delete the chain if terminal, or strip the iN_ prefix to demote it to a plain done artifact if downstream processes consume it`,
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
 * @param {{ type: string, issueNumber: number, artifactId: string|undefined, fixVia?: "file"|"github" }[]} findings
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

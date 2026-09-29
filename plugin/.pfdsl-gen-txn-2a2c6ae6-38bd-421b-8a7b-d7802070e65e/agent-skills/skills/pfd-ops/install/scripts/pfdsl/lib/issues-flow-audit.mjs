// Pure logic for auditing sync between GitHub issues and .pfdsl/roadmap.pfdsl.
// Zero I/O. No imports.

export const FLOW_LABELS = [
	{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
	{
		name: "flow:exempt",
		description: "intentionally out of .pfdsl/roadmap.pfdsl scope",
	},
];

/**
 * @param {{ name: string, description: string }[]} expectedLabels
 * @param {{ name: string, description: string }[]} actualLabels
 * @returns {{ type: string, name: string, description: string, detail: string }[]}
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
			});
		} else if (actual.description !== expected.description) {
			findings.push({
				type: "label_description_mismatch",
				name: expected.name,
				description: expected.description,
				detail: `expected: "${expected.description}", actual: "${actual.description}"`,
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
		const issueNumbers = [...prefixMatch[0].matchAll(/i(\d+)_/g)].map((m) =>
			Number(m[1]),
		);
		const tags = val.tags ?? [];
		const priorities = tags.filter((t) => t.startsWith("priority:")).sort();
		result.push({ id, issueNumbers, updatedAt: val.updated_at, priorities });
	}
	return result;
}

/**
 * @param {{ processId: string, issueNumber: number, artifactId: string, updatedAt: string|undefined, priorities: string[] }[]} entries - priorities must be pre-sorted
 * @param {{ number: number, state: "OPEN"|"CLOSED", labels: string[], updatedAt: string }[]} issues
 * @returns {{ type: string, issueNumber: number, processId: string|undefined, artifactId: string|undefined, detail: string, advisory?: boolean }[]}
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

		// Closed issues are historical records. They do not require freshness,
		// triage, or roadmap cleanup by this read-only audit.
		if (iss.state === "CLOSED") continue;

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
			});
		}

		// Priority drift
		const issuePriorities = iss.labels
			.filter((l) => l.startsWith("priority:"))
			.sort();
		if (JSON.stringify(issuePriorities) !== JSON.stringify(entry.priorities)) {
			findings.push({
				type: "priority_drift",
				issueNumber: entry.issueNumber,
				processId: entry.processId,
				artifactId: entry.artifactId,
				detail: `process: [${entry.priorities.join(", ")}], issue: [${issuePriorities.join(", ")}]`,
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
			// Advisory, not blocking (#963). A managed issue's roadmap entry is
			// added on the branch that implements it, so every other session sees
			// this gap until that branch merges — the divergence is inherent to
			// parallel work, not a defect of the tree being audited. A cycle can
			// clear the gap for the issue it is itself starting, and for no other,
			// so left blocking it fails gate-check on issues the failing cycle does
			// not own, and a permanently red row stops being read at all
			// (.pfdsl/bindings/pfd-retro-patterns/chronic-false-positive-silencing.md).
			// The check that still binds runs at the one moment it can be acted on:
			// cycle-status reports it for the issue being started.
			findings.push({
				type: "missing_process",
				issueNumber: iss.number,
				processId: undefined,
				artifactId: undefined,
				advisory: true,
				detail: `issue has flow:managed label but no tracked process in the flow`,
			});
		} else {
			findings.push({
				type: "untriaged",
				issueNumber: iss.number,
				processId: undefined,
				artifactId: undefined,
				advisory: true,
				detail: `open issue has no tracked process and no flow label`,
			});
		}
	}

	// Stable sort by issueNumber ascending
	findings.sort((a, b) => a.issueNumber - b.issueNumber);

	return findings;
}

/**
 * Splits findings into blocking and advisory rows.
 * @param {{issueNumber?: number, advisory?: boolean}[]} findings
 * @param {{enforcedIssues?: number[]}} [options]
 * @returns {{blocking: object[], advisory: object[]}}
 */
export function partitionFindings(findings, { enforcedIssues = [] } = {}) {
	const enforced = new Set(enforcedIssues);
	const blocking = (f) => !f.advisory || enforced.has(f.issueNumber);
	return {
		blocking: findings.filter(blocking),
		advisory: findings.filter((f) => !blocking(f)),
	};
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
 * @param {string} line
 * @returns {{ process: string, outputs: string[] }|null}
 */
function parseEdgeLine(line) {
	const m = line.match(/^(.*>>\s*(\w+)\s*->\s*)(\[([^\]]*)\]|(\w+))\s*$/);
	if (!m) return null;
	const process = m[2];
	const isList = m[3].startsWith("[");
	const outputs = isList
		? m[4]
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean)
		: [m[5]];
	return { process, outputs };
}

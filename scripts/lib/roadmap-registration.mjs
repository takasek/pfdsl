// Decides whether a PR that edits the roadmap registered the issues it closes
// (#963).
//
// `missing_process` is advisory in the audit because the entry for a managed
// issue lives on the branch implementing it, so every other tree sees the gap.
// A PR is the one place that asymmetry disappears for a known set: the issues
// GitHub reads this PR as closing are exactly the ones this PR could register.
// Enforcing those and no others keeps the check silent about work it cannot
// reach.

import { GITHUB_UNAVAILABLE_EXIT_CODE } from "../pfdsl/lib/github-ops.mjs";

const AUDIT_SCRIPT = "scripts/pfdsl/audit-issues-flow.mjs";

/**
 * Select local links from the identity-validated GitHubOps view, then reduce
 * them to the issue numbers the repository-local roadmap audit accepts.
 * @param {Array<{number: number, repository: {name: string, owner: {login: string}}}>} references
 * @param {{owner: string, repo: string}} repository
 * @returns {number[]}
 */
export function localClosingIssueNumbers(references, { owner, repo }) {
	return [
		...new Set(
			references
				.filter(
					(ref) =>
						ref.repository.owner.login.toLowerCase() === owner.toLowerCase() &&
						ref.repository.name.toLowerCase() === repo.toLowerCase(),
				)
				.map((ref) => ref.number),
		),
	];
}

/**
 * The argv for the audit run that enforces this PR's own issues.
 * @param {number[]} issueNumbers
 * @returns {string[]}
 */
export function buildAuditArgs(issueNumbers) {
	return [
		AUDIT_SCRIPT,
		...issueNumbers.flatMap((n) => ["--enforce-issue", String(n)]),
	];
}

/**
 * @param {{issueNumbers: number[], auditExit: number}} input
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail: string}}
 */
export function classifyRoadmapRegistration({ issueNumbers, auditExit }) {
	if (issueNumbers.length === 0) {
		return {
			status: "SKIP",
			detail:
				"this PR closes no issue in this repository, so it has none to register",
		};
	}
	if (auditExit === GITHUB_UNAVAILABLE_EXIT_CODE) {
		return { status: "SKIP", detail: "GitHub operations unavailable" };
	}
	const list = issueNumbers.map((n) => `#${n}`).join(", ");
	if (auditExit === 0) {
		// Not "registered": a flow:exempt issue passes by being absent by design,
		// and saying it was registered would be false for that case.
		return { status: "PASS", detail: `no registration owed for ${list}` };
	}
	return {
		status: "FAIL",
		detail: `the audit rejected the roadmap for ${list}`,
	};
}

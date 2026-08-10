/**
 * Does a PR into the default branch close the issue it was written for (#801)?
 *
 * The companion has required `Closes #<n>` since the backend was adopted, and
 * PR #497 shipped without it. The item lived only in prose, folded under the
 * one-line meta item that says the companion's sub-items were checked, so
 * nothing could catch it — and this is the one PR-body item that cannot move
 * into a commit trailer the way the size override did (#775), because GitHub
 * itself is the reader.
 *
 * So the evidence is GitHub's reading rather than the text: a PR "closes" an
 * issue when the API says it does. A `Closes #476` inside a code fence or a
 * quoted example produces no link, and matching the token would have called
 * that compliant.
 */

/**
 * A hotfix declaration: the backend convention (`hotfix 運用`) lets a bug fix
 * skip the issue entirely, and such a PR has nothing to close.
 *
 * Spelled the way the companion writes it — `hotfix:` at a line head. The
 * colon is what separates the declaration from prose about it: a PR body
 * explaining the convention starts lines with the bare word, and a line-head
 * match without the colon would let such a PR exempt itself.
 */
const HOTFIX_DECLARATION = /^hotfix\s*:/im;

/**
 * @param {{baseRef?: string, defaultBranch?: string,
 *          closingIssueCount?: number, body?: string}} params
 *   - baseRef: the branch this PR merges into.
 *   - defaultBranch: the repo's default branch.
 *   - closingIssueCount: how many issues GitHub reads the PR as closing.
 *   - body: the PR body, consulted only for the hotfix declaration.
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail: string}}
 */
export function classifyClosesReference({
	baseRef,
	defaultBranch,
	closingIssueCount = 0,
	body,
}) {
	// The convention reserves the keyword for the default branch: on an
	// intermediate PR it closes the issue at the wrong moment, before the work
	// has reached the branch that ships.
	if (baseRef !== defaultBranch) {
		return {
			status: "SKIP",
			detail: `intermediate PR into ${baseRef}; Closes is reserved for ${defaultBranch}`,
		};
	}
	if (closingIssueCount > 0) {
		return {
			status: "PASS",
			detail: `closes ${closingIssueCount} issue(s)`,
		};
	}
	if (HOTFIX_DECLARATION.test(body ?? "")) {
		return {
			status: "SKIP",
			detail: "declared a hotfix, which the backend convention exempts",
		};
	}
	return {
		status: "FAIL",
		detail: `GitHub reads this PR as closing no issue; add "Closes #<n>" to the body, or declare a hotfix`,
	};
}

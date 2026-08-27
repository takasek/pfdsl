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
 * A no-issue declaration: unlike `hotfix:`, this covers any PR that has no
 * issue to close for a reason other than "it's a hotfix" (retro/docs
 * spin-offs, bookkeeping — #871). Spelled the same line-head + colon way as
 * `hotfix:`, for the same reason (a line-head match without the colon would
 * let prose about the convention exempt itself).
 *
 * The reason is mandatory (`\s*\S` after the colon), unlike `hotfix:`: that
 * declaration names one established, narrow convention on its own, while
 * `no-issue:` can be attached to any PR — an empty declaration here would be
 * a blank check, so the colon must be followed by at least one non-space
 * character on the same line.
 */
const NO_ISSUE_DECLARATION = /^no-issue[ \t]*:[ \t]*\S/im;

/**
 * Whether `body` carries either exemption declaration. Exported so the
 * PreToolUse `gh pr create` guard (closes-create-guard.mjs, #871) checks a PR
 * body against the same vocabulary this module uses at merge time, instead
 * of redefining it.
 * @param {string} body
 * @returns {boolean}
 */
export function hasExemptionDeclaration(body) {
	const text = body ?? "";
	return HOTFIX_DECLARATION.test(text) || NO_ISSUE_DECLARATION.test(text);
}

/**
 * @param {{baseRef?: string, defaultBranch?: string,
 *          closingIssueCount?: number, body?: string}} params
 *   - baseRef: the branch this PR merges into.
 *   - defaultBranch: the repo's default branch.
 *   - closingIssueCount: how many issues GitHub reads the PR as closing.
 *   - body: the PR body, consulted only for exemption declarations.
 *
 * The two exemptions are self-reported. This function checks only that the PR
 * author wrote `hotfix:` or a non-empty `no-issue:` reason; it cannot prove
 * that the diff is truly a hotfix or needs no issue. No detector is added for
 * that semantic classification: the declaration and diff are both visible to
 * the human reviewer who owns the exemption decision (#910).
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
	if (NO_ISSUE_DECLARATION.test(body ?? "")) {
		return {
			status: "SKIP",
			detail:
				"declared no-issue, with a reason the backend convention requires",
		};
	}
	return {
		status: "FAIL",
		detail: `GitHub reads this PR as closing no issue; add "Closes #<n>" to the body, declare a hotfix, or declare "no-issue: <reason>"`,
	};
}

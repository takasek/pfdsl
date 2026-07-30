// Runs check-md-linebreaks.mjs's check against a single .md file right
// after it is Written (#650), instead of leaving the violation to surface
// at the next pre-commit run. roadmap.md noted this concretely: writing
// several new .md files in one session and only finding out about
// mid-sentence line breaks at commit time turns into a full rewrite pass,
// because by then the violations are spread across every file written that
// session.
//
// Advisory only, and PostToolUse rather than PreToolUse: the file is already
// written by the time this runs, so there is nothing to block — only a
// prompt to fix it while the content is still fresh in context.
//
// checkFile/formatViolation are imported from check-md-linebreaks.mjs
// in-process (that script exports them for this reason) rather than shelled
// out to, so this hook does not pay a second Node process spawn on every
// .md Write and there stays exactly one place that defines a violation.

/**
 * Whether this PostToolUse payload changed a .md file.
 * Edit counts as well as Write: most prose reaches a .md file through Edit, and
 * the check reads the whole file either way, so an Edit-shaped violation would
 * otherwise still wait for pre-commit. Reporting violations the current change
 * did not introduce is not a concern in practice — CI runs
 * check-md-linebreaks over every tracked .md, so the tree is clean before the
 * edit.
 * @param {object} payload PostToolUse hook payload
 * @returns {boolean}
 */
export function isMarkdownChange(payload) {
	if (payload?.tool_name !== "Write" && payload?.tool_name !== "Edit") return false;
	const filePath = payload?.tool_input?.file_path;
	return typeof filePath === "string" && filePath.endsWith(".md");
}

/**
 * The advisory text, or undefined when there are no violations. formatViolation
 * is injected — the hook wrapper passes check-md-linebreaks.mjs's own
 * formatter, so this file never re-implements what a violation looks like.
 * @param {string} filePath
 * @param {Array<{file: string, line: number, prev: string, cont: string}>} violations
 *   check-md-linebreaks.mjs's checkFile() result
 * @param {(v: object) => string} formatViolation
 * @returns {string | undefined}
 */
export function formatLinebreakAdvisory(filePath, violations, formatViolation) {
	if (violations.length === 0) return undefined;
	const lines = violations.map(formatViolation).join("\n");
	return `note: ${filePath} has mid-sentence line break violation(s) (check-md-linebreaks.mjs):\n${lines}`;
}

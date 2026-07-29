// Runs check-md-linebreaks.mjs against a single .md file right after it is
// Written (#650), instead of leaving the violation to surface at the next
// pre-commit run. roadmap.md noted this concretely: writing several new .md
// files in one session and only finding out about mid-sentence line breaks
// at commit time turns into a full rewrite pass, because by then the
// violations are spread across every file written that session.
//
// Advisory only, and PostToolUse rather than PreToolUse: the file is already
// written by the time this runs, so there is nothing to block — only a
// prompt to fix it while the content is still fresh in context.
//
// The actual check is not reimplemented here; the hook wrapper shells out to
// check-md-linebreaks.mjs (scoped to the one file) so there is exactly one
// place that defines what a violation is.

/**
 * Whether this PostToolUse payload is a Write of a .md file.
 * Edit is excluded on purpose: this hook exists to catch the newly-written
 * case roadmap.md described (several fresh files, one late pre-commit
 * catch-all), not every touch of an existing file.
 * @param {object} payload PostToolUse hook payload
 * @returns {boolean}
 */
export function isMarkdownWrite(payload) {
	if (payload?.tool_name !== "Write") return false;
	const filePath = payload?.tool_input?.file_path;
	return typeof filePath === "string" && filePath.endsWith(".md");
}

/**
 * The advisory text, or undefined when the check passed.
 * @param {string} filePath
 * @param {{ok: boolean, out: string}} checkResult result of running
 *   check-md-linebreaks.mjs against `filePath` (scripts/lib/run-exec.mjs's tryRun shape)
 * @returns {string | undefined}
 */
export function formatLinebreakAdvisory(filePath, checkResult) {
	if (checkResult.ok) return undefined;
	return `note: ${filePath} has mid-sentence line break violation(s) (check-md-linebreaks.mjs):\n${checkResult.out.trim()}`;
}

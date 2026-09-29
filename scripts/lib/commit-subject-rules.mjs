/** Dependency-free commit-subject parsing and linting for the base-owned CI job. */

// Conventional Commits subject line: type(scope)!: description.
// Scope and ! are optional; type must be one of the conventional set.
const CONVENTIONAL_COMMIT_PATTERN =
	/^(feat|fix|refactor|docs|chore|test|style|perf|build|ci|revert)(\([\w.,/-]+\))?!?: .+/;

/**
 * Lint commit subjects against the Conventional Commits format.
 * Language and commit granularity remain review guidance.
 * @param {string[]} subjects
 * @returns {Array<{subject: string, ok: boolean, reason?: string}>}
 */
export function lintCommitSubjects(subjects) {
	return subjects.map((subject) => {
		if (!CONVENTIONAL_COMMIT_PATTERN.test(subject)) {
			return { subject, ok: false, reason: "not Conventional Commits" };
		}
		return { subject, ok: true };
	});
}

/**
 * Parse `git log --format=%h%x09%s <range>` output into sha/subject records,
 * one per non-blank line (#834's cycle window: collectCycleWindow in
 * gate-check-steps.mjs is what runs the git calls this shape comes from).
 *
 * Splits on the first tab only. `%s` does not escape a tab that a subject
 * itself carries, so splitting on every tab would cut such a subject short
 * and drop its tail rather than keep it whole.
 * @param {string} text
 * @returns {{sha: string, subject: string}[]}
 */
export function parseCommitLogLines(text) {
	return text
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => {
			const i = line.indexOf("\t");
			return i === -1
				? { sha: line, subject: "" }
				: { sha: line.slice(0, i), subject: line.slice(i + 1) };
		});
}

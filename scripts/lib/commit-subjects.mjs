/**
 * The commit-subject verdict for one range, shared by the terminal gate and by
 * the CI entry point.
 *
 * Its own module because it runs git: gate-check.mjs states that process and
 * git I/O live in the top-level script and that it stays a bag of pure
 * functions, and a CI script about repo-wide commit hygiene has no business
 * importing from the gate's namespace either.
 *
 * Range acquisition belongs with the lint rather than with each caller. The
 * gate and CI must agree on what they judged, and the first caller that builds
 * its own range — or forgets `--no-merges` — starts failing on the synthetic
 * merge subject GitHub writes for a pull request while the other one passes:
 * two verdicts for the same commits, with nothing to say which is right
 * (#1174).
 */

import { lintCommitSubjects, parseCommitLogLines } from "./gate-check.mjs";

/**
 * @param {{exec: (file: string, args: string[]) => {ok: boolean, out: string}, baseRef: string, headRef: string}} params
 *   `baseRef` and `headRef` are refs, not a base branch name: the gate passes
 *   `origin/<base>` and `HEAD`, and CI passes the branch it fetched and the
 *   head SHA from the event payload.
 * @returns {{name: string, status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function checkCommitSubjects({ exec, baseRef, headRef }) {
	const name = "commit subject lint";
	// The sha-prefixed format, not a bare `%s`: a commit made with
	// --allow-empty-message has an empty subject, and a plain newline split
	// cannot tell that record apart from the blank line between records, so the
	// one commit that violates every rule is the one the lint never sees. Each
	// line here is anchored by its sha, which keeps the empty subject a record.
	const logOut = exec("git", [
		"log",
		"--no-merges",
		`${baseRef}..${headRef}`,
		"--format=%h%x09%s",
	]);
	if (!logOut.ok) return { name, status: "FAIL", detail: logOut.out.trim() };

	const subjects = parseCommitLogLines(logOut.out).map((r) => r.subject);
	if (subjects.length === 0)
		return { name, status: "SKIP", detail: "no commits in range" };

	const failed = lintCommitSubjects(subjects).filter((r) => !r.ok);
	return {
		name,
		status: failed.length === 0 ? "PASS" : "FAIL",
		detail:
			failed.length === 0
				? `${subjects.length} commit(s)`
				: failed.map((r) => `${r.reason}: ${r.subject}`).join("; "),
	};
}

// PreToolUse(Bash) guard: catches a `gh pr create` bound for the default
// branch whose body carries no evidence it closes an issue (#871, the earlier
// layer for the "no issue exists yet" half of the failures the CI check
// caught after the fact — see check-closes-reference.mjs's header for how the
// two layers now divide the work).
//
// This is not a replacement for that CI check: the evidence here is a token
// found in the command string, weaker than the close link GitHub derives from
// the merged PR body. A `Closes #476` inside a code fence or a quoted example
// would pass this guard and still be caught by CI, the way
// classifyClosesReference's header explains for the link-vs-token choice
// there. CI stays the last word; this is a layer in front of it, not a
// substitute.
//
// Ask, not deny: a PR with no issue to close is a real, legitimate case
// (#871's own observed failures were exactly this), and the fix is either
// approving as-is or adding a declaration to the body — both are choices a
// human should make in the moment, not a hard stop with no path through.

import { hasExemptionDeclaration } from "./closes-reference.mjs";
import {
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { flagValues, parseGhCommand } from "./gh-command.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

/**
 * GitHub's own closing-keyword vocabulary, immediately followed by `#<n>`.
 * Case-insensitive, since GitHub's own matching is.
 */
const CLOSE_KEYWORD_REFERENCE =
	/\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b\s+#\d+/i;

/**
 * The PR body text a `gh pr create` call would send, or null when it cannot
 * be determined from the command line alone — `--web`/`--fill` open a browser
 * or fill from commits, no `--body`/`--body-file` at all opens $EDITOR, and an
 * unreadable `--body-file` (including `-` for stdin) leaves nothing to read.
 * A null return is deliberately treated as "let it through" by the caller:
 * asking without evidence would just be noise, and CI remains the final net.
 * @param {string[]} args parseGhCommand()'s args
 * @param {(path: string) => string} readFile
 * @returns {string | null}
 */
function resolveBodyText(args, readFile) {
	const [inlineBody] = flagValues(args, ["--body", "-b"]);
	if (inlineBody !== undefined) return inlineBody;

	const [bodyFile] = flagValues(args, ["--body-file", "-F"]);
	if (bodyFile === undefined || bodyFile === "-") return null;
	try {
		return readFile(bodyFile);
	} catch {
		return null;
	}
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @param {{defaultBranch: string, readFile: (path: string) => string}} deps
 * @returns {{decision: "allow"} | {decision: "ask", reason: string}}
 */
export function evaluateClosesCreateGuard(
	payload,
	{ defaultBranch, readFile },
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const command = payload?.tool_input?.command;
	if (typeof command !== "string" || command.trim() === "")
		return { decision: "allow" };

	for (const segment of splitSegments(command)) {
		const tokens = stripLeadingNoise(tokenize(segment));
		const parsed = parseGhCommand(tokens);
		if (!parsed || parsed.group !== "pr" || parsed.verb !== "create") continue;

		const bodyText = resolveBodyText(parsed.args, readFile);
		if (bodyText === null) continue;

		const [base] = flagValues(parsed.args, ["--base", "-B"]);
		if ((base ?? defaultBranch) !== defaultBranch) continue;

		if (CLOSE_KEYWORD_REFERENCE.test(bodyText)) continue;
		if (hasExemptionDeclaration(bodyText)) continue;

		return {
			decision: "ask",
			reason:
				`This 'gh pr create' targets ${defaultBranch} and its body has no closing keyword ` +
				"(e.g. 'Closes #<n>') and no exemption declaration. If an issue exists, add 'Closes #<n>' to the " +
				"body. If not, add a line-head 'no-issue: <reason>' declaration, or approve this once to proceed " +
				"as-is. CI's check-closes-reference still runs after the PR is opened either way.",
		};
	}

	return { decision: "allow" };
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision, the way
 * runRoadmapPublishGuard does. Malformed JSON produces no output — a crash in
 * this guard must not wedge every Bash call.
 * @param {string} inputText raw stdin payload
 * @param {{defaultBranch: string, readFile: (path: string) => string}} deps
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runClosesCreateGuard(inputText, deps) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };

	const result = evaluateClosesCreateGuard(payload, deps);
	if (result.decision === "allow") return { shouldOutput: false };
	return { shouldOutput: true, output: buildPermissionOutput(result) };
}

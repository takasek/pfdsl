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
	GH_VALUE_FLAGS,
	hasHelpOption,
	parseLeadingShellPrefix,
	splitSegments,
	stripLeadingNoise,
	tokenize,
} from "./delegation-guard.mjs";
import { parseGhCommand } from "./gh-command.mjs";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

/**
 * GitHub's own closing-keyword vocabulary, immediately followed by `#<n>`.
 * Case-insensitive, since GitHub's own matching is.
 */
const CLOSE_KEYWORD_REFERENCE =
	/\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b\s+#\d+/i;

// Preserve quoting evidence: single-quoted dollars are literal, while a
// double-quoted variable or substitution cannot be resolved without running it.
function staticOption(tokens, flags) {
	let result = { present: false, value: null };
	for (let i = 1; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.value === "--") break;
		const flag = flags.find(
			(name) => token.value === name || token.value.startsWith(`${name}=`),
		);
		if (!flag) {
			if (GH_VALUE_FLAGS.has(token.value)) i++;
			continue;
		}
		const valueToken =
			token.value === flag
				? tokens[++i]
				: { ...token, value: token.value.slice(flag.length + 1) };
		const value = valueToken?.value;
		result = {
			present: true,
			value:
				typeof value === "string" &&
				(valueToken.quote === "'" ||
					(valueToken.quote === '"' && !/[$`]/.test(value)) ||
					!/[$`~*?]/.test(value))
					? value
					: null,
		};
	}
	return result;
}

function resolveBodyText(tokens, readFile, priorCommands) {
	const inlineBody = staticOption(tokens, ["--body", "-b"]);
	if (inlineBody.present) return inlineBody.value;
	const bodyFile = staticOption(tokens, ["--body-file", "-F"]);
	if (
		priorCommands ||
		tokens.some((token) => token.quote !== "'" && /[$`]/.test(token.value))
	)
		return null;
	if (bodyFile.value === null || bodyFile.value === "-") return null;
	try {
		const text = readFile(bodyFile.value);
		return typeof text === "string" ? text : null;
	} catch {
		return null;
	}
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 *
 * `getDefaultBranch` is a function rather than a value because this runs on
 * every Bash call while `gh pr create` is a rare one: resolving the branch up
 * front would spawn a git process for each of them. It is called only once a
 * `gh pr create` requiring body validation has been found.
 * @param {object} payload PreToolUse hook payload
 * @param {{getDefaultBranch: () => string, readFile: (path: string) => string}} deps
 * @returns {{decision: "allow"} | {decision: "ask", reason: string}}
 */
export function evaluateClosesCreateGuard(
	payload,
	{ getDefaultBranch, readFile },
) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const command = payload?.tool_input?.command;
	if (typeof command !== "string" || command.trim() === "")
		return { decision: "allow" };

	let priorCommands = false;
	for (const segment of splitSegments(command)) {
		const rawTokens = tokenize(segment);
		const prefix = parseLeadingShellPrefix(rawTokens);
		const tokens = stripLeadingNoise(rawTokens);
		const parsed = parseGhCommand(tokens);
		if (!parsed || parsed.group !== "pr" || parsed.verb !== "create") {
			priorCommands ||= tokens.length > 0;
			continue;
		}
		if (hasHelpOption(parsed)) continue;

		const defaultBranch = getDefaultBranch();
		const base = staticOption(tokens, ["--base", "-B"]);
		if (base.value !== null && base.value !== defaultBranch) continue;
		const bodyText = resolveBodyText(
			tokens,
			readFile,
			priorCommands ||
				prefix.unresolved ||
				prefix.envs.some((env) => env.chdir !== undefined),
		);
		if ((base.present && base.value === null) || bodyText === null) {
			return {
				decision: "ask",
				reason:
					"This 'gh pr create' could not be checked because its base or body cannot be determined from literal arguments and a readable body file. Use a literal base and --body-file with a literal path to the completed body, or approve this once. Include 'Closes #<n>' or a line-head 'no-issue: <reason>' when targeting the default branch. CI's check-closes-reference still runs after creation.",
			};
		}

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
 * @param {{getDefaultBranch: () => string, readFile: (path: string) => string}} deps
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runClosesCreateGuard(inputText, deps) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };

	const result = evaluateClosesCreateGuard(payload, deps);
	if (result.decision === "allow") return { shouldOutput: false };
	return { shouldOutput: true, output: buildPermissionOutput(result) };
}

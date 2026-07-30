// Catches two command usages that mislead the caller rather than fail loudly
// (#650 candidates C and D). Both are decided from the command string alone, so
// they share one hook process instead of adding two more to every Bash call —
// the startup cost measured in #650 is paid per hook, not per rule.
//
// Neither rule can be advisory: a PreToolUse hook has no channel that reaches
// the model (see buildPermissionOutput in hook-io.mjs), so the choice is
// between "ask" and "deny".
//
// C — `npx @pfdsl/cli` inside this repo: "ask". The published CLI is a
// different program from this working tree's build, so a status value or flag
// added on the current branch comes back as a V008 error and reads as "the fix
// did not work". Not a deny: exercising the published version on purpose is a
// real case here (release smoke test, and the adoption probe of ADR-0029 acts
// as an adopting repo would), and ADR-0031 keeps a pinned `npx` invocation as
// the documented fallback for environments without a global install.
//
// D — `gh issue view --comments` (same for `gh pr view`): "deny". The flag
// prints the comments only and omits the body, so an issue whose content is all
// in the body reads as empty and the caller concludes there is nothing there.
// The remedy is another form of the same call, so denying costs one retry and
// nothing else — and unlike C there is no case where dropping the body silently
// is what was wanted.

import { splitSegments, stripLeadingNoise, tokenize } from "./delegation-guard.mjs";
import { parseGhCommand } from "./gh-command.mjs";

/** `@pfdsl/cli`, optionally with a version spec. */
const PUBLISHED_CLI_SPEC = /^@pfdsl\/cli(@.+)?$/;

/** The `gh` groups whose `view` verb drops the body when `--comments` is given. */
const VIEW_GROUPS = new Set(["issue", "pr"]);

/**
 * The tokens of each command segment, leading `FOO=bar`/`sudo` noise stripped.
 * Quoting is preserved so callers can require an unquoted head — that is what
 * keeps a command mentioned inside a string from tripping a rule, while its
 * arguments are matched however they are quoted.
 * @param {string} command
 * @returns {Array<Array<{value: string, quoted: boolean}>>}
 */
function commandSegments(command) {
	return splitSegments(command).map((segment) => stripLeadingNoise(tokenize(segment)));
}

/**
 * Whether `command` runs the npm-published `@pfdsl/cli` rather than the local
 * build. Covers `npx` and `pnpm dlx`; `npm install -g` is not an invocation and
 * is left alone.
 * @param {string} command
 * @returns {boolean}
 */
export function usesPublishedCli(command) {
	if (typeof command !== "string" || command.trim() === "") return false;

	for (const tokens of commandSegments(command)) {
		const head = tokens[0];
		if (!head || head.quoted) continue;
		const values = tokens.map((token) => token.value);
		const runsFromRegistry = head.value === "npx" || (head.value === "pnpm" && values.includes("dlx"));
		if (!runsFromRegistry) continue;
		if (values.some((value) => PUBLISHED_CLI_SPEC.test(value))) return true;
	}
	return false;
}

/**
 * Whether `command` asks `gh` for comments in a way that omits the body.
 * `--json` overrides the human-readable output entirely, so a call that names
 * its fields has already decided what it wants.
 * @param {string} command
 * @returns {boolean}
 */
export function usesBodyDroppingView(command) {
	if (typeof command !== "string" || command.trim() === "") return false;

	for (const tokens of commandSegments(command)) {
		const parsed = parseGhCommand(tokens);
		if (!parsed || !VIEW_GROUPS.has(parsed.group) || parsed.verb !== "view") continue;
		if (!parsed.args.includes("--comments")) continue;
		if (parsed.args.some((arg) => arg === "--json" || arg.startsWith("--json="))) continue;
		return true;
	}
	return false;
}

/**
 * Decide whether a PreToolUse Bash invocation may proceed.
 * @param {object} payload PreToolUse hook payload
 * @returns {{decision: "allow"} | {decision: "deny" | "ask", reason: string}}
 */
export function evaluateCommandUsageGuard(payload) {
	if (payload?.tool_name !== "Bash") return { decision: "allow" };
	const command = payload?.tool_input?.command;

	if (usesBodyDroppingView(command)) {
		return {
			decision: "deny",
			reason:
				"'gh issue view --comments' (and 'gh pr view --comments') prints the comments and omits the body, " +
				"so an item whose content is in the body reads as empty. " +
				"Use 'gh issue view <n> --json body,comments' to get both, or '--json comments' if the body is already read.",
		};
	}

	if (usesPublishedCli(command)) {
		return {
			decision: "ask",
			reason:
				"'npx @pfdsl/cli' runs the npm-published CLI, not this working tree's build, so anything added on this branch " +
				"(a new status value, a new flag) comes back as an error rather than as the behaviour under test. " +
				"Use 'node packages/cli/dist/cli.js' after 'pnpm -r build'. Approve this only to exercise the published version on purpose.",
		};
	}

	return { decision: "allow" };
}

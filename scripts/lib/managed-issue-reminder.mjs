// Nudges the roadmap entry for a `flow:managed` issue at the moment the issue
// is created (#650 candidate H). roadmap.md said "起票と roadmap 追加は同時に
// 行う", and `audit-issues-flow.mjs` does catch a managed issue that never
// became an artifact — but only at the next gate-check, by which point the
// cycle's context is gone. Right after `gh issue create` returns is the one
// moment the artifact's inputs and outputs are still in hand.
//
// Advisory, and PostToolUse rather than PreToolUse: the issue exists by the
// time this runs, so there is nothing to block. PostToolUse is also the only
// event whose output can carry additionalContext back to the model, which is
// what an advisory needs (see buildPermissionOutput in hook-io.mjs).
//
// Same shape as hooks/retro-reminder-post-tool-use.mjs, which reminds about
// pfd-retro when a commit marks an artifact done.

import { splitSegments, stripLeadingNoise, tokenize } from "./delegation-guard.mjs";

/** The URL `gh issue create` prints on success — the only success signal it gives. */
const CREATED_ISSUE_URL = /https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/;

/**
 * Whether `command` creates an issue labelled `flow:managed`. `flow:exempt`
 * issues are deliberately absent from the roadmap, so they are left alone.
 * @param {string} command
 * @returns {boolean}
 */
export function createsManagedIssue(command) {
	if (typeof command !== "string" || command.trim() === "") return false;

	for (const segment of splitSegments(command)) {
		const tokens = stripLeadingNoise(tokenize(segment)).filter((token) => !token.quoted);
		const values = tokens.map((token) => token.value);
		if (values[0] !== "gh" || values[1] !== "issue" || !values.includes("create")) continue;
		if (values.some((value) => value.split(/[=,]/).includes("flow:managed"))) return true;
	}
	return false;
}

/**
 * The number of the issue the command created, or null when it created none —
 * a failed `gh issue create` prints no URL, and this hook must stay silent then
 * rather than ask for a roadmap entry for an issue that does not exist.
 * @param {unknown} toolResponse PostToolUse tool_response
 * @returns {string | null}
 */
export function createdIssueNumber(toolResponse) {
	const text =
		typeof toolResponse === "string"
			? toolResponse
			: [toolResponse?.stdout, toolResponse?.output].filter((part) => typeof part === "string").join("\n");
	const match = CREATED_ISSUE_URL.exec(text ?? "");
	return match ? match[1] : null;
}

/**
 * The advisory text, or undefined when this payload is not a successful
 * `flow:managed` create.
 * @param {object} payload PostToolUse hook payload
 * @returns {string | undefined}
 */
export function formatManagedIssueAdvisory(payload) {
	if (payload?.tool_name !== "Bash") return undefined;
	if (!createsManagedIssue(payload?.tool_input?.command)) return undefined;

	const number = createdIssueNumber(payload?.tool_response);
	if (!number) return undefined;

	return (
		`note: issue #${number} is labelled flow:managed, so it needs a matching artifact in .pfdsl/roadmap.pfdsl ` +
		"in this same cycle (see workflow.pfdsl's file_issues description for what the artifact carries). " +
		"audit-issues-flow.mjs only reports a missing entry at the next gate-check, when the cycle's context is gone."
	);
}

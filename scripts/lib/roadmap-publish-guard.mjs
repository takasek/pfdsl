// Asks for `make release-status` before a new publish process is declared in
// roadmap.pfdsl (#650 candidate I). Registering the next version without
// checking what is already published writes the drift that release-status
// exists to show: an already-released version entered as the upcoming one, with
// every artifact hanging off it now describing the past.
//
// Ask, not deny: whether release-status was consulted is not visible in the
// payload, so a deny would block the retry too and there would be no way
// through. The prompt puts the question where it can still be answered.
//
// Only tagged process declarations count, not
// the flow lines that reference an existing publish process. Adding an
// implementation artifact to an existing publish process's inputs is the
// routine case and says nothing about release state.

import { parseDocument } from "yaml";
import { buildPermissionOutput, parseHookPayload } from "./hook-io.mjs";

const RELEASE_TAGS = new Set([
	"release_cli",
	"release_extension",
	"release_standalone",
]);

/** Read authored process tags; invalid documents are left to ordinary validation. */
function declaredPublishProcesses(text) {
	if (typeof text !== "string") return new Map();
	const header = text.match(
		/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/,
	);
	if (!header) return new Map();
	const doc = parseDocument(header[1]);
	if (doc.errors.length) throw doc.errors[0];
	const processes = doc.toJS()?.process;
	if (!processes || typeof processes !== "object" || Array.isArray(processes))
		return new Map();
	return new Map(
		Object.entries(processes).flatMap(([id, meta]) => {
			const tags = Array.isArray(meta?.tags)
				? meta.tags.filter((tag) => RELEASE_TAGS.has(tag))
				: [];
			return tags.length ? [[id, tags]] : [];
		}),
	);
}

/**
 * Release processes newly tagged in complete before/after documents.
 * A newly added release kind also warrants checking that kind's release state.
 * @param {string} after
 * @param {string} before
 * @returns {Array<[string, string[]]>}
 */
function addedReleases(after, before) {
	try {
		const existing = declaredPublishProcesses(before);
		return [...declaredPublishProcesses(after)].filter(([id, tags]) =>
			tags.some((tag) => !existing.get(id)?.includes(tag)),
		);
	} catch {
		return [];
	}
}

/** @param {string} after @param {string} before @returns {string[]} */
export function addedPublishProcesses(after, before) {
	return addedReleases(after, before).map(([id]) => id);
}

/**
 * Decide whether a PreToolUse Edit/Write may proceed.
 *
 * Read the existing document for both tools. Edit fragments need their full
 * context to distinguish process tags from artifact tags. An unreconstructable
 * Edit is not evidence of a new release; a Write can still declare one itself.
 * @param {object} payload PreToolUse hook payload
 * @param {{readFile?: (path: string) => string | undefined}} [io]
 * @returns {{decision: "allow"} | {decision: "ask", reason: string}}
 */
export function evaluateRoadmapPublishGuard(
	payload,
	{ readFile = () => undefined } = {},
) {
	if (payload?.tool_name !== "Edit" && payload?.tool_name !== "Write")
		return { decision: "allow" };

	const filePath = payload?.tool_input?.file_path;
	if (typeof filePath !== "string" || !filePath.endsWith("roadmap.pfdsl"))
		return { decision: "allow" };

	const input = payload.tool_input;
	const before = readFile(filePath);
	let after = input.content;
	if (payload.tool_name === "Edit") {
		if (
			typeof before !== "string" ||
			typeof input.old_string !== "string" ||
			!input.old_string ||
			typeof input.new_string !== "string"
		)
			return { decision: "allow" };
		const parts = before.split(input.old_string);
		if (parts.length < 2 || (parts.length > 2 && !input.replace_all))
			return { decision: "allow" };
		after = parts.join(input.new_string);
	}
	const releases = addedReleases(after, before ?? "");
	const added = releases.map(([id]) => id);
	if (added.length === 0) return { decision: "allow" };
	const standalone = releases.some(([, tags]) =>
		tags.includes("release_standalone"),
	);

	return {
		decision: "ask",
		reason:
			`This adds the publish process ${added.join(", ")} to the roadmap. ` +
			"Run 'make release-status' first and check what is already published — registering a released version as the " +
			"upcoming one makes every artifact under it describe the past. " +
			(standalone
				? "'make release-status' does not report standalone releases; separately verify the published standalone distribution and its version at the release destination recorded by its work item. "
				: "") +
			"Approve once the released version is confirmed.",
	};
}

/**
 * Orchestrates the hook's stdin payload into a print-or-not decision, the way
 * runDelegationGuard does (#645). `readFile` stays injected here rather than
 * being read in the wrapper, so the Write branch's on-disk comparison is
 * covered by tests instead of living in an untestable script.
 * @param {string} inputText raw stdin payload
 * @param {{readFile?: (path: string) => string | undefined}} [io]
 * @returns {{shouldOutput: boolean, output?: object}}
 */
export function runRoadmapPublishGuard(
	inputText,
	{ readFile = () => undefined } = {},
) {
	const payload = parseHookPayload(inputText);
	if (!payload) return { shouldOutput: false };

	const result = evaluateRoadmapPublishGuard(payload, { readFile });
	if (result.decision === "allow") return { shouldOutput: false };
	return { shouldOutput: true, output: buildPermissionOutput(result) };
}

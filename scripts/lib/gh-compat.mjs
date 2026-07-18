/**
 * Pure logic for the gh-CLI compatibility layer: detecting a missing `gh`
 * binary and translating the small subset of `gh` argv shapes this repo's
 * scripts use into a REST-callable operation descriptor. Zero I/O — the
 * actual REST calls live in github-rest.mjs, dispatch lives in gh-exec.mjs.
 */

// gh-exec.mjs's execGh exits/signals with this code when neither the gh
// binary nor a GH_TOKEN/GITHUB_TOKEN REST fallback is available, distinct
// from exit code 1 (real findings) — see #489, #492.
export const GH_UNAVAILABLE_EXIT_CODE = 2;

/**
 * True if an execFileSync("gh", ...) failure means the gh CLI binary itself
 * is missing (ENOENT), as opposed to gh running and reporting a real error
 * (auth failure, network error, bad args).
 * @param {{ code?: string }} error
 * @returns {boolean}
 */
export function isGhUnavailableError(error) {
	return error?.code === "ENOENT";
}

/**
 * @param {string[]} args
 * @param {string} flag
 * @returns {string | undefined}
 */
function flagValue(args, flag) {
	const idx = args.indexOf(flag);
	return idx >= 0 ? args[idx + 1] : undefined;
}

/**
 * Parse a `gh` argv (as passed to execFileSync("gh", argv)) into a
 * REST-callable operation descriptor. Only covers the argv shapes this
 * repo's scripts actually emit — returns null for anything else, so callers
 * fall back to surfacing the original gh error rather than guessing.
 * @param {string[]} args
 * @returns {{ op: string, [key: string]: unknown } | null}
 */
export function planGhRestCall(args) {
	const [cmd, sub, ...rest] = args;

	if (cmd === "label" && sub === "list") {
		return { op: "listLabels" };
	}
	if (cmd === "label" && sub === "create") {
		return {
			op: "createLabel",
			name: rest[0],
			description: flagValue(rest, "--description"),
			color: flagValue(rest, "--color"),
		};
	}
	if (cmd === "label" && sub === "edit") {
		return { op: "editLabel", name: rest[0], description: flagValue(rest, "--description") };
	}
	if (cmd === "issue" && sub === "list") {
		return { op: "listIssues" };
	}
	if (cmd === "issue" && sub === "edit") {
		return { op: "addIssueLabel", number: Number(rest[0]), label: flagValue(rest, "--add-label") };
	}
	if (cmd === "issue" && sub === "view") {
		return { op: "getIssueBody", number: Number(rest[0]) };
	}
	if (cmd === "pr" && sub === "list") {
		return { op: "listOpenPrsWithCi" };
	}
	return null;
}

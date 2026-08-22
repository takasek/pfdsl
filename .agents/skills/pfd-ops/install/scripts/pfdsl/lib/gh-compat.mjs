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
 * The `--json`/`--jq` pair the `view` verbs share, without the op name — that
 * stays a literal at each call site, because the test holding the two sides of
 * the fallback together reads the op names straight out of this file's source
 * (#639).
 *
 * One op per verb serves both shapes. `--jq .field` reduces gh's output to
 * that field's value; without it gh prints the JSON object and the caller
 * parses it. Answering both with the body alone is what made the
 * object-shaped callers throw inside a catch that blamed a missing gh (#745),
 * and answering `--jq` from a second REST path would leave two ways to ask the
 * same question.
 * @param {string[]} rest argv after the group and verb
 * @returns {{ fields: string[], jqField?: string } | null}
 */
function planView(rest) {
	const json = flagValue(rest, "--json");
	if (!json) return null;
	const fields = json.split(",");

	const jq = flagValue(rest, "--jq");
	if (jq === undefined) return { fields };
	// Only a bare `.field` naming one of the requested fields is something this
	// layer can evaluate. Anything else is a jq program, and guessing at it
	// would answer a question that was not asked.
	const field = /^\.(\w+)$/.exec(jq)?.[1];
	if (!field || !fields.includes(field)) return null;
	return { fields, jqField: field };
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
		return {
			op: "editLabel",
			name: rest[0],
			description: flagValue(rest, "--description"),
		};
	}
	if (cmd === "issue" && sub === "list") {
		return { op: "listIssues" };
	}
	if (cmd === "issue" && sub === "edit") {
		return {
			op: "addIssueLabel",
			number: Number(rest[0]),
			label: flagValue(rest, "--add-label"),
		};
	}
	if (cmd === "issue" && sub === "view") {
		const view = planView(rest);
		return view && { op: "viewIssue", number: Number(rest[0]), ...view };
	}
	if (cmd === "pr" && sub === "list") {
		return { op: "listOpenPrsWithCi" };
	}
	if (cmd === "pr" && sub === "view") {
		// Only the no-argument form, which asks about the current branch's PR.
		// A numbered `pr view` is a different question, and the REST side
		// resolves the branch rather than a number (#749).
		if (rest[0] !== undefined && !rest[0].startsWith("-")) return null;
		const view = planView(rest);
		return view && { op: "viewCurrentPr", ...view };
	}
	return null;
}

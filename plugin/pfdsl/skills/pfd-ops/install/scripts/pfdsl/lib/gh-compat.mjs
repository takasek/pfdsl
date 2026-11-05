/**
 * Pure logic for the gh-CLI compatibility layer: detecting a missing `gh`
 * binary. Zero I/O — the gh spawn lives in gh-exec.mjs, and the REST/GraphQL
 * calls that replace it when gh is unavailable live in github-ops.mjs and
 * github-rest.mjs.
 */

// Legacy compatibility export. Operation consumers use github-ops.mjs's
// GITHUB_UNAVAILABLE_EXIT_CODE; execGh itself throws backend errors.
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

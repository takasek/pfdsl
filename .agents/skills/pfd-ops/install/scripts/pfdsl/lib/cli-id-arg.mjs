/**
 * Formats ids for the `<id[,id...]>` argument the pfdsl CLI's `delete`
 * (and `meta set`, `get`) accept, so an id containing a comma survives the
 * round trip instead of being split into two ids (#1125 review defect 2).
 *
 * Deliberately duplicates `formatId` from packages/core/src/formatter.ts
 * rather than importing it: this file ships to adopting repos as part of
 * the pfd-ops install mirror, which has no dependency on `@pfdsl/core`
 * (same constraint sweep-completed-chains.mjs's `resolveCli()` documents for
 * not pulling in shared repo-local helpers). The escaping rules mirror
 * `formatId` exactly, and the CLI's own `parseIdList` is what decodes this
 * on the other end — the two must keep matching escapes if either changes.
 */

const BARE_ID_RE = /^[\p{L}\p{N}_-]+$/u;

/**
 * @param {string} id
 * @returns {string} `id` unchanged if it needs no quoting, otherwise a
 *   double-quoted, escaped form `parseIdList` recovers the original from.
 */
export function formatIdForCliArg(id) {
	if (BARE_ID_RE.test(id)) return id;
	let escaped = "";
	for (const char of id) {
		if (char === "\\") escaped += "\\\\";
		else if (char === '"') escaped += '\\"';
		else if (char === "\n") escaped += "\\n";
		else if (char === "\t") escaped += "\\t";
		else escaped += char;
	}
	return `"${escaped}"`;
}

/**
 * @param {string[]} ids
 * @returns {string} the `<id[,id...]>` CLI argument for `ids`, each formatted
 *   with `formatIdForCliArg` so a comma-carrying id stays a single id on the
 *   other side of the CLI's own comma-split.
 */
export function joinIdsForCliArg(ids) {
	return ids.map(formatIdForCliArg).join(",");
}

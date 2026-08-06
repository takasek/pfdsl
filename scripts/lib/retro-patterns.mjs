/**
 * The retro audit-pattern catalog: splitting the monolith into one file per
 * pattern, and reading those files back.
 *
 * The catalog used to be a single markdown file whose only documented way in
 * was to read all of it. An index inside that same file does not fix it — you
 * have to read the file to learn not to read the file, and the index becomes a
 * second copy of the pattern list to keep in sync. So the patterns become
 * files, and selection happens over their frontmatter instead of over prose.
 */

/** A top-level catalog bullet: `- **name**: first line`. */
const PATTERN_HEAD = /^- \*\*(.+?)\*\*/;

/**
 * The catalog's patterns, in source order.
 *
 * A pattern owns every line after its head up to the next head, minus the
 * blank line that separates them — the separator belongs to the catalog's
 * layout, not to either neighbour, and re-adding it is the joiner's business.
 * @param {string} markdown - the catalog section, patterns only.
 * @returns {{name: string, body: string}[]}
 */
export function splitCatalog(markdown) {
	/** @type {{name: string, body: string[]}[]} */
	const patterns = [];
	for (const line of markdown.split("\n")) {
		const head = PATTERN_HEAD.exec(line);
		if (head) {
			patterns.push({ name: head[1], body: [line] });
			continue;
		}
		patterns.at(-1)?.body.push(line);
	}
	return patterns.map(({ name, body }) => ({
		name,
		body: body.join("\n").replace(/\n+$/, ""),
	}));
}

/**
 * The catalog section the patterns came from.
 *
 * Inverse of splitCatalog, and the only reason the split is verifiable: the
 * migration is trustworthy exactly when this reproduces the original bytes.
 * @param {{body: string}[]} patterns
 * @returns {string}
 */
export function joinCatalog(patterns) {
	return patterns.map((p) => p.body).join("\n\n");
}

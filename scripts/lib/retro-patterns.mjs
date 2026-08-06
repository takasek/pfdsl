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

/** `---` fence, frontmatter, `---` fence, blank line, then the bullet. */
const PATTERN_FILE = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/;

const TAGS_LINE = /^tags: \[(.*)\]$/m;

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

/**
 * One pattern as a standalone file: frontmatter, then the pattern's own
 * catalog bullet, unchanged.
 *
 * The bullet keeps its `- **name**:` head rather than being flattened into a
 * heading, and neither the name nor the summary is restated in the
 * frontmatter. All of it follows from one decision: the file's body has to
 * stay byte-identical to the slice it came from, because that identity is the
 * whole proof that the migration lost nothing. Anything the bullet already
 * says would be a second copy, free to go stale, and prose is not something a
 * checker can compare against prose.
 * @param {{tags: string[], body: string}} pattern
 * @returns {string}
 */
export function renderPatternFile({ tags, body }) {
	return `---\ntags: [${tags.join(", ")}]\n---\n\n${body}\n`;
}

/**
 * A pattern file, back into its parts. The name comes from the bullet; the
 * summary is summaryOf(body), not a field.
 * @param {string} text
 * @returns {{name: string, tags: string[], body: string}}
 */
export function parsePatternFile(text) {
	const file = PATTERN_FILE.exec(text);
	if (!file) throw new Error("not a pattern file: missing frontmatter fence");
	const [, frontmatter, rest] = file;
	const body = rest.replace(/\n+$/, "");
	const head = PATTERN_HEAD.exec(body);
	if (!head) throw new Error("not a pattern file: body has no pattern bullet");
	const tags = TAGS_LINE.exec(frontmatter)?.[1].trim() ?? "";
	return {
		name: head[1],
		tags: tags === "" ? [] : tags.split(",").map((t) => t.trim()),
		body,
	};
}

/**
 * The tag for patterns that hold in every cycle.
 *
 * A few patterns have no discriminating condition — they fire whenever a cycle
 * happens at all. Tagging them like the rest would make their tag match almost
 * every query and dilute the others, so selection always adds them instead of
 * making the caller remember to ask.
 */
export const ALWAYS_TAG = "always";

/**
 * Every tag that exists, with how many patterns carry it. This output is the
 * vocabulary: there is no canonical list elsewhere to drift from it.
 *
 * Most-used first, then alphabetical. A tag that shows up once is visible as
 * such, which is how a typo or a synonym of an existing tag gets noticed.
 * @param {{tags: string[]}[]} patterns
 * @returns {{tag: string, count: number}[]}
 */
export function collectTags(patterns) {
	/** @type {Map<string, number>} */
	const counts = new Map();
	for (const { tags } of patterns) {
		for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The patterns to read for a tag, in catalog order, always-tagged ones
 * included.
 * @param {{tags: string[]}[]} patterns
 * @param {string} tag
 * @returns {{tags: string[]}[]}
 */
export function selectByTag(patterns, tag) {
	return patterns.filter(
		(p) => p.tags.includes(tag) || p.tags.includes(ALWAYS_TAG),
	);
}

/**
 * The pattern's opening sentence, which by convention states what the pattern
 * is.
 *
 * Derived rather than stored: a summary written into the frontmatter would be
 * a second copy of this sentence, free to go stale when the body is edited,
 * and prose against prose is not something a checker can compare. The cost is
 * that a pattern cannot carry a summary that differs from how it opens — so
 * the writing convention is that the first sentence is the definition.
 * @param {string} body - a pattern's catalog bullet, head included.
 * @returns {string}
 */
export function summaryOf(body) {
	const text = body
		.replace(PATTERN_HEAD, "")
		.replace(/^[:：]\s*/, "")
		.split("\n")
		.map((line) => line.trim())
		.join(" ")
		.trim();
	const end = text.indexOf("。");
	return end === -1 ? text : text.slice(0, end + 1);
}

/**
 * The tag list, split into the axes its prefixes name.
 *
 * Prefixes are a reading and writing aid, not a schema: nothing declares which
 * axes exist and nothing rejects a new one. The payoff is at authoring time —
 * "which target, which method, which context" prompts for the dimensions a
 * flat list lets you forget, which is where tags actually get missed. A stray
 * axis shows up here as a group of one, the same way a stray tag does.
 *
 * Axes come most-used first; unprefixed tags trail behind in an axis named "".
 * @param {{tag: string, count: number}[]} tags - as returned by collectTags.
 * @returns {{axis: string, tags: {tag: string, count: number}[]}[]}
 */
export function groupTagsByAxis(tags) {
	/** @type {Map<string, {tag: string, count: number}[]>} */
	const axes = new Map();
	for (const entry of tags) {
		const axis = entry.tag.includes(":") ? entry.tag.split(":", 1)[0] : "";
		axes.set(axis, [...(axes.get(axis) ?? []), entry]);
	}
	const total = (/** @type {{count: number}[]} */ group) =>
		group.reduce((sum, t) => sum + t.count, 0);
	return [...axes]
		.map(([axis, group]) => ({ axis, tags: group }))
		.sort((a, b) => {
			if (a.axis === "") return 1;
			if (b.axis === "") return -1;
			return total(b.tags) - total(a.tags) || a.axis.localeCompare(b.axis);
		});
}

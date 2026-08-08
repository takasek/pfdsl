/**
 * The retro audit-pattern catalog: one file per pattern under
 * .pfdsl/bindings/pfd-retro-patterns/, selected over their frontmatter
 * instead of read as one prose file.
 */

/** A top-level catalog bullet: `- **name**: first line`. */
const PATTERN_HEAD = /^- \*\*(.+?)\*\*/;

/** `---` fence, frontmatter, `---` fence, blank line, then the bullet. */
const PATTERN_FILE = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/;

const TAGS_LINE = /^tags: \[(.*)\]$/m;

/** An ASCII kebab-case slug: lowercase letters and digits, hyphen-joined. */
const ASCII_KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
 * The invariants a pattern file has to keep once it is no longer a slice
 * produced by a migration script but a file people hand-edit: that it still
 * parses, that its filename is an ASCII kebab-case slug (so the catalog stays
 * the repo's only non-ASCII-free directory, and shells/tools that mishandle
 * non-ASCII or quoting never have to touch it), that it carries at least one
 * tag to be selected by, and that it is still exactly what renderPatternFile
 * would write — catching the whitespace and ordering slips a hand edit
 * introduces that parsePatternFile alone tolerates. Uniqueness of the
 * filename is the filesystem's job, not this function's.
 * @param {{name: string, text: string}} file - name is the filename minus
 *   its extension.
 * @returns {string[]} one reason per violation, empty when the file is clean.
 */
export function checkPatternFile({ name, text }) {
	let parsed;
	try {
		parsed = parsePatternFile(text);
	} catch (e) {
		return [e.message];
	}
	const reasons = [];
	if (!ASCII_KEBAB_CASE.test(name)) {
		reasons.push("filename is not ascii kebab-case");
	}
	if (parsed.tags.length === 0) {
		reasons.push("has no tags");
	}
	if (renderPatternFile(parsed) !== text) {
		reasons.push(
			"does not round-trip through renderPatternFile (formatting drift)",
		);
	}
	return reasons;
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
 * The patterns carrying any of these tags, in catalog order.
 *
 * A union, never an intersection, and there is deliberately no intersecting
 * counterpart. Measured on the real catalog, intersecting two axes cuts a
 * fourteen-pattern result to three — and a pattern missed here is missed
 * silently, which is the failure this whole catalog exists to catch. An
 * operation that looks reasonable and loses eleven patterns should not be
 * one keystroke away.
 * @param {{tags: string[]}[]} patterns
 * @param {string[]} tags
 * @returns {{tags: string[]}[]}
 */
export function selectByTag(patterns, tags) {
	return patterns.filter((p) => tags.some((tag) => p.tags.includes(tag)));
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

/** A body line that is a 問いの形 / 具体例 label, numbering and suffix included. */
const KEY_LINE = /^(問いの形|具体例)/;

/**
 * The 問いの形 / 具体例 label lines a pattern's body carries, trimmed and in
 * body order. These are the lines tagged selection was missing (#803):
 * without them, a `tagged` match shows only the opening sentence and a
 * reader cannot judge whether the pattern is worth opening.
 *
 * Only the label line itself is pulled, not the unlabeled continuation lines
 * that follow it — the same depth `select`'s word-hit lines already show,
 * so this stays a pointer into the file rather than a second copy of it.
 * @param {string} body
 * @returns {string[]}
 */
export function keyLinesOf(body) {
	return body
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => KEY_LINE.test(line));
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
		const group = axes.get(axis);
		if (group) group.push(entry);
		else axes.set(axis, [entry]);
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

/**
 * Where each word appears in a pattern, one hit per line it occurs on.
 * @param {{body: string}} pattern
 * @param {string[]} words
 * @returns {{word: string, line: number, text: string}[]}
 */
function wordHits({ body }, words) {
	/** @type {{word: string, line: number, text: string}[]} */
	const hits = [];
	body.split("\n").forEach((text, index) => {
		for (const word of words) {
			if (text.includes(word))
				hits.push({ word, line: index + 1, text: text.trim() });
		}
	});
	return hits;
}

/**
 * What to read this cycle, in three groups.
 *
 * The word search is not a fallback for when the tags come back empty. The
 * dangerous case is the opposite one: tags that return something invite the
 * reader to stop, and a pattern the tagger never anticipated stays unread with
 * nothing to show for it. So both searches run together and `wordOnly` names
 * what the tags missed — a standing measurement of the vocabulary's reach,
 * rather than a prompt someone has to remember to follow.
 *
 * Hits carry the line they matched on, because a word search also finds
 * patterns that merely mention the term in an example, and telling those apart
 * is the reader's job, cheaply.
 * @param {{tags: string[], body: string}[]} patterns
 * @param {{tags: string[], words: string[]}} query
 */
export function select(patterns, { tags, words }) {
	/** @type {{tags: string[]}[]} */
	const always = [];
	/** @type {{tags: string[]}[]} */
	const rest = [];
	for (const p of patterns)
		(p.tags.includes(ALWAYS_TAG) ? always : rest).push(p);

	const tagged = selectByTag(rest, tags);
	const taggedSet = new Set(tagged);
	const wordOnly = rest
		.filter((p) => !taggedSet.has(p))
		.map((pattern) => ({ pattern, hits: wordHits(pattern, words) }))
		.filter((m) => m.hits.length > 0);
	return { tagged, wordOnly, always };
}

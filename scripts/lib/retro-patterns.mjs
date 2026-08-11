/**
 * The retro audit-pattern catalog: one file per pattern under
 * .pfdsl/bindings/pfd-retro-patterns/, selected over their frontmatter
 * instead of read as one prose file.
 */

import { join } from "node:path";

/** A top-level catalog bullet: `- **name**: first line`. */
const PATTERN_HEAD = /^- \*\*(.+?)\*\*/;

/** `---` fence, frontmatter, `---` fence, blank line, then the bullet. */
const PATTERN_FILE = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/;

const TAGS_LINE = /^tags: \[(.*)\]$/m;

const PHASE_LINE = /^phase: (.+)$/m;

/** A 対策 line phrased as effective before some point ("〜前に"). Deliberately
 * loose — see checkPatternFile's JSDoc for why this misses cases on purpose.
 * The lookbehind drops the two spellings that carry 前に as a substring
 * without meaning "before": 以前に (previously) and 名前に (to the name). */
const PRE_ARTIFACT_PHRASING = /対策[:：][^、。]{1,20}(?<![以名])前に/;

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
 * `phase` is omitted from the frontmatter entirely when the pattern doesn't
 * carry one, rather than printed as `phase: ` or similar — the 56 patterns
 * that predate the field round-trip byte-for-byte through this function only
 * because an absent field prints nothing.
 * @param {{tags: string[], body: string, phase?: string}} pattern
 * @returns {string}
 */
export function renderPatternFile({ tags, body, phase }) {
	const phaseLine = phase === undefined ? "" : `phase: ${phase}\n`;
	return `---\ntags: [${tags.join(", ")}]\n${phaseLine}---\n\n${body}\n`;
}

/**
 * Every pattern under `dir`, parsed, in filename order.
 *
 * The one place the catalog is read, so that a second caller cannot acquire
 * its own directory order or its own failure semantics. Filenames are sorted
 * because `readdirSync` order is the filesystem's, not the catalog's, and a
 * malformed file is reported as one error among the rest rather than
 * discarding every pattern that parsed — the same isolation `checkPatternFile`
 * already gives per file. Callers that need the abort instead can raise on a
 * non-empty `errors`.
 * @param {string} dir
 * @param {{readdirSync: (dir: string) => string[], readFileSync: (path: string, encoding: string) => string, displayPath?: (path: string) => string}} io
 * @returns {{patterns: {name: string, tags: string[], phase?: string, body: string, path: string}[], errors: string[]}}
 */
export function loadPatternCatalog(
	dir,
	{ readdirSync, readFileSync, displayPath },
) {
	const shown = displayPath ?? ((path) => path);
	const patterns = [];
	const errors = [];
	for (const file of readdirSync(dir)
		.filter((f) => f.endsWith(".md"))
		.sort()) {
		const path = join(dir, file);
		try {
			patterns.push({
				...parsePatternFile(readFileSync(path, "utf8")),
				path: shown(path),
			});
		} catch (e) {
			errors.push(`${shown(path)}: ${e.message}`);
		}
	}
	return { patterns, errors };
}

/**
 * A pattern file, back into its parts. The name comes from the bullet; the
 * summary is summaryOf(body), not a field. `phase` is `undefined` when the
 * file carries no `phase:` line, matching renderPatternFile's omission.
 * @param {string} text
 * @returns {{name: string, tags: string[], body: string, phase?: string}}
 */
export function parsePatternFile(text) {
	const file = PATTERN_FILE.exec(text);
	if (!file) throw new Error("not a pattern file: missing frontmatter fence");
	const [, frontmatter, rest] = file;
	const body = rest.replace(/\n+$/, "");
	const head = PATTERN_HEAD.exec(body);
	if (!head) throw new Error("not a pattern file: body has no pattern bullet");
	const tags = TAGS_LINE.exec(frontmatter)?.[1].trim() ?? "";
	const phase = PHASE_LINE.exec(frontmatter)?.[1];
	return {
		name: head[1],
		tags: tags === "" ? [] : tags.split(",").map((t) => t.trim()),
		body,
		...(phase === undefined ? {} : { phase }),
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
 *
 * The `phase` promotion is a nudge, not a proof: it fires only when a 対策
 * line is phrased as "対策: <≤20 chars, no 、。>前に" — a pattern that reads
 * "before"-shaped but is phrased any other way (「着手前に」split across a
 * continuation line, a longer clause before 前に, no 対策: label at all) is
 * missed. The miss is one-directional by design: a pattern this misses stays
 * unpromoted (a false negative), never one this catches that isn't actually
 * before-something (see `catalog-consulted-after-the-artifact` for why a
 * missed promotion is the failure this exists to catch). Do not tighten this
 * into a claim of completeness — hand judgment decided the 56-pattern
 * baseline's `phase` assignments, and this check will not reproduce it.
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
	if (parsed.phase === undefined && PRE_ARTIFACT_PHRASING.test(parsed.body)) {
		reasons.push(
			"対策 reads as effective before something ('...前に') but declares no phase",
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
 * Every tag that exists, with the patterns that carry it. This output is the
 * vocabulary: there is no canonical list elsewhere to drift from it.
 *
 * Patterns ride along rather than a count, so a reader picking a tag to read
 * does not have to go read the whole catalog first to find out which
 * patterns it names — the count would otherwise be the only thing visible
 * before opening a file, closing the same circle #803 found in `tags`.
 *
 * Most-used first, then alphabetical. A tag that shows up once is visible as
 * such, which is how a typo or a synonym of an existing tag gets noticed.
 * @template {{tags: string[]}} T
 * @param {T[]} patterns
 * @returns {{tag: string, patterns: T[]}[]}
 */
export function collectTags(patterns) {
	/** @type {Map<string, T[]>} */
	const groups = new Map();
	for (const p of patterns) {
		for (const tag of p.tags) {
			const group = groups.get(tag);
			if (group) group.push(p);
			else groups.set(tag, [p]);
		}
	}
	return [...groups]
		.map(([tag, patterns]) => ({ tag, patterns }))
		.sort(
			(a, b) =>
				b.patterns.length - a.patterns.length || a.tag.localeCompare(b.tag),
		);
}

/**
 * The patterns carrying any of these tags, in catalog order, each with the
 * tags it actually matched.
 *
 * A union, never an intersection, and there is deliberately no intersecting
 * counterpart. Measured on the real catalog, intersecting two axes cuts a
 * fourteen-pattern result to three — and a pattern missed here is missed
 * silently, which is the failure this whole catalog exists to catch. An
 * operation that looks reasonable and loses eleven patterns should not be
 * one keystroke away.
 *
 * Membership and the matched list come out of the same pass, so "this tag
 * reaches this pattern" has one definition — widening the match (prefixes,
 * synonyms) stays a single edit rather than a sweep, the same reason `hitsFor`
 * is the sole definition on the word side.
 * @template {{tags: string[]}} T
 * @param {T[]} patterns
 * @param {string[]} tags
 * @returns {{pattern: T, matched: string[]}[]}
 */
export function selectByTag(patterns, tags) {
	return patterns
		.map((pattern) => ({
			pattern,
			matched: pattern.tags.filter((tag) => tags.includes(tag)),
		}))
		.filter((m) => m.matched.length > 0);
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

/** A body line that is the pattern's own 対策 label — not a suffixed variant
 * like 対策の追加, which reads as a continuation rather than the prescription
 * itself. */
const COUNTER_LINE = /^対策[:：]\s*(.+)$/;

/**
 * The pattern's own prescription, as one line: the text of its first 対策
 * line, trimmed, with the label removed. `undefined` for a pattern that has
 * none (some patterns write only 問いの形 / 具体例, or use different prose
 * for their resolution).
 * @param {string} body - a pattern's catalog bullet, head included.
 * @returns {string | undefined}
 */
export function counterLineOf(body) {
	for (const line of body.split("\n")) {
		const match = COUNTER_LINE.exec(line.trim());
		if (match) return match[1];
	}
	return undefined;
}

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
 * @template T
 * @param {{tag: string, patterns: T[]}[]} tags - as returned by collectTags.
 * @returns {{axis: string, tags: {tag: string, patterns: T[]}[]}[]}
 */
export function groupTagsByAxis(tags) {
	/** @type {Map<string, {tag: string, patterns: T[]}[]>} */
	const axes = new Map();
	for (const entry of tags) {
		const axis = entry.tag.includes(":") ? entry.tag.split(":", 1)[0] : "";
		const group = axes.get(axis);
		if (group) group.push(entry);
		else axes.set(axis, [entry]);
	}
	const total = (/** @type {{patterns: T[]}[]} */ group) =>
		group.reduce((sum, t) => sum + t.patterns.length, 0);
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
 * The patterns any of these words hit, each with the lines they hit, in the
 * given order. The one definition of "this word reaches this pattern": every
 * caller that counts or ranks word matches goes through here, so widening the
 * match (case folding, stemming) stays a single edit rather than a sweep.
 * @template {{body: string}} T
 * @param {T[]} patterns
 * @param {string[]} words
 * @returns {{pattern: T, hits: {word: string, line: number, text: string}[]}[]}
 */
function hitsFor(patterns, words) {
	return patterns
		.map((pattern) => ({ pattern, hits: wordHits(pattern, words) }))
		.filter((m) => m.hits.length > 0);
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
 *
 * `reach` counts each word's hits across every pattern, tagged or not, before
 * `wordOnly` subtracts the ones the tags already caught. Without it, a word
 * with zero hits in `wordOnly` reads as one signal ("the word found nothing")
 * when it is really two: the word found nothing at all, or it found patterns
 * the tags already had (#803).
 *
 * `tagged` carries which of the cycle's tags each pattern matched, ranked by
 * how many. The union never shrinks — a broad cycle satisfies many tags and
 * gets most of the catalog back, measured at 38 of 43 for one real cycle — so
 * ranking is what a reader gets instead of a shorter list: a pattern whose
 * conditions all held this cycle sorts above one that shares a single tag, and
 * the named tags say why each entry is here at all (#819). Ties keep catalog
 * order, so the ranking never reorders what it cannot distinguish.
 *
 * `unselective` is the same measurement stated as a verdict: a result holding
 * more than half of `pool` has removed less than half of what reading the
 * catalog outright would cost, which is not a narrowing. Ranking alone cannot
 * say this, because a ranked list of 38 looks exactly like a ranked list of 4
 * until someone compares it to the catalog's size — and the failure this
 * catalog exists to catch is a reader who stops at "narrowed, read, done".
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

	const tagged = selectByTag(rest, tags).sort(
		(a, b) => b.matched.length - a.matched.length,
	);
	const taggedSet = new Set(tagged.map((t) => t.pattern));
	const wordOnly = hitsFor(
		rest.filter((p) => !taggedSet.has(p)),
		words,
	);
	const reach = words.map((word) => ({
		word,
		count: hitsFor(patterns, [word]).length,
	}));
	return {
		tagged,
		wordOnly,
		always,
		reach,
		pool: rest.length,
		unselective: tagged.length > rest.length / 2,
	};
}

/**
 * Every pattern the given words hit anywhere in its body, ranked by how many
 * lines they hit — for checking whether a pattern close to a draft already
 * exists before writing a new one (#803).
 *
 * Unlike `select`, nothing is excluded and nothing is added: every pattern is
 * a candidate, `always`-tagged ones included, because a near-duplicate check
 * has no cycle to exclude patterns for already answering.
 * @template {{tags: string[], body: string}} T
 * @param {T[]} patterns
 * @param {string[]} words
 * @returns {{pattern: T, hits: {word: string, line: number, text: string}[]}[]}
 */
export function near(patterns, words) {
	return hitsFor(patterns, words).sort((a, b) => b.hits.length - a.hits.length);
}

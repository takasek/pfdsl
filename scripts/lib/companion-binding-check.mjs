/**
 * Pure functions for the companion-binding dead-pointer check: extracts
 * repo-relative path references from companion .md prose (inline code and
 * markdown links) and required-heading checks. Filesystem I/O (existsSync)
 * lives in the main script; this module stays testable.
 */

const PATH_PREFIXES = ["docs", "\\.claude", "scripts", "packages"];
const PREFIX_ALT = PATH_PREFIXES.join("|");
const PATH_TOKEN_RE = new RegExp(`^(?:${PREFIX_ALT})/\\S*$`);
const FENCE_RE = /^(```|~~~)/;

const INLINE_CODE_RE = /`([^`]*)`/g;
const MD_LINK_RE = new RegExp(`\\]\\(((?:${PREFIX_ALT})/[^)\\s]*)\\)`, "g");

/**
 * @param {string} text
 * @returns {string} text with fenced code blocks (```...``` or ~~~...~~~) removed
 */
function stripFencedBlocks(text) {
	const lines = text.split("\n");
	const out = [];
	let inFence = false;
	for (const line of lines) {
		if (FENCE_RE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		out.push(line);
	}
	return out.join("\n");
}

/**
 * Strips a trailing "#anchor" (markdown link fragment) and a bare trailing
 * "." shell cwd argument (e.g. the "." in `cp -r foo/bar/. .`) off a raw
 * path-like token.
 * @param {string} ref
 * @returns {string}
 */
function normalizeRef(ref) {
	const withoutAnchor = ref.split("#")[0];
	return withoutAnchor.endsWith("/.")
		? withoutAnchor.slice(0, -1)
		: withoutAnchor;
}

/**
 * Extracts repo-relative path references (inline code + markdown link
 * targets) starting with docs/, .claude/, scripts/, or packages/, in
 * source order with duplicates removed. Inline code content is split on
 * whitespace first, so a path embedded in a shell command (e.g. `` `node
 * scripts/foo.mjs --fix` ``) is still found, not just a bare path in its
 * own inline-code span.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPathReferences(text) {
	const unfenced = stripFencedBlocks(text);
	const refs = [];

	INLINE_CODE_RE.lastIndex = 0;
	let inlineMatch;
	while ((inlineMatch = INLINE_CODE_RE.exec(unfenced)) !== null) {
		for (const token of inlineMatch[1].split(/\s+/)) {
			if (PATH_TOKEN_RE.test(token)) refs.push(normalizeRef(token));
		}
	}

	MD_LINK_RE.lastIndex = 0;
	let linkMatch;
	while ((linkMatch = MD_LINK_RE.exec(unfenced)) !== null) {
		refs.push(normalizeRef(linkMatch[1]));
	}

	return [...new Set(refs)];
}

/**
 * Resolves a path reference to the filesystem path that should actually be
 * checked for existence:
 * - `<placeholder>` segments (e.g. .claude/skills/<name>) mean the reference
 *   is a template, not a concrete path — returns null (not checkable).
 * - glob patterns (e.g. "docs/spec/proposals" + glob-suffix, or a wildcard
 *   mid-path) aren't a single real path — checks the static directory
 *   prefix before the first wildcard segment instead. Returns null if
 *   there's no static prefix at all (e.g. a bare glob-suffix with nothing
 *   before it).
 * - otherwise, returns the reference unchanged.
 * @param {string} ref
 * @returns {string | null}
 */
export function resolveCheckTarget(ref) {
	if (ref.includes("<")) return null;
	const starIdx = ref.indexOf("*");
	if (starIdx === -1) return ref;
	const idx = ref.slice(0, starIdx).lastIndexOf("/");
	return idx === -1 ? null : ref.slice(0, idx + 1);
}

/**
 * @param {string} text
 * @param {string[]} requiredHeadings - exact heading text, without the leading #'s
 * @returns {string[]} the subset of requiredHeadings not found as a heading line
 */
export function findMissingHeadings(text, requiredHeadings) {
	const headingLines = stripFencedBlocks(text)
		.split("\n")
		.filter((line) => /^#{1,6}\s/.test(line))
		.map((line) => line.replace(/^#{1,6}\s+/, "").trim());
	return requiredHeadings.filter((h) => !headingLines.includes(h));
}

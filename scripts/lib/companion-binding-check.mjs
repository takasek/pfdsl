/**
 * Pure functions for the companion-binding dead-pointer check: extracts
 * repo-relative path references from companion .md prose (inline code and
 * markdown links) and required-heading checks. Filesystem I/O (existsSync)
 * lives in the main script; this module stays testable.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { headingText, isHeading } from "./markdown-heading.mjs";

const PATH_PREFIXES = ["docs", "\\.claude", "scripts", "packages"];
const PREFIX_ALT = PATH_PREFIXES.join("|");
const REPO_PATH_RE = new RegExp(`^(?:${PREFIX_ALT})/`);
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * @param {import('mdast').Nodes} node
 * @param {(node: import('mdast').Nodes) => void} visit
 */
function walk(node, visit) {
	visit(node);
	if ("children" in node) {
		for (const child of node.children) walk(child, visit);
	}
}

/** Collect used link/image destinations; unused definitions are not references. */
function linkTargets(tree) {
	const definitions = new Map();
	walk(tree, (node) => {
		if (node.type === "definition" && !definitions.has(node.identifier)) {
			definitions.set(node.identifier, node.url);
		}
	});
	const targets = [];
	walk(tree, (node) => {
		if (node.type === "link" || node.type === "image") targets.push(node.url);
		if (node.type === "linkReference" || node.type === "imageReference") {
			const target = definitions.get(node.identifier);
			if (target !== undefined) targets.push(target);
		}
	});
	return targets;
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
 * inline-code order followed by link order, with duplicates removed. Inline code content is split on
 * whitespace first, so a path embedded in a shell command (e.g. `` `node
 * scripts/foo.mjs --fix` ``) is still found, not just a bare path in its
 * own inline-code span.
 * @param {string} text
 * @returns {string[]}
 */
export function extractPathReferences(text) {
	const tree = fromMarkdown(text);
	const refs = [];
	walk(tree, (node) => {
		if (node.type !== "inlineCode") return;
		for (const token of node.value.split(/\s+/)) {
			if (REPO_PATH_RE.test(token)) refs.push(normalizeRef(token));
		}
	});
	for (const target of linkTargets(tree)) {
		if (REPO_PATH_RE.test(target)) refs.push(normalizeRef(target));
	}

	return [...new Set(refs)];
}

/**
 * Extracts markdown link targets that point at another .md file relative to
 * the linking file, in source order with duplicates removed.
 *
 * This is the complement of extractPathReferences, which only sees targets
 * under docs/, .claude/, scripts/ or packages/. A link written relative to
 * the file it sits in — `../pfd-retro.md` from a case file, or a bare
 * sibling filename — matched neither pattern, so nothing resolved it. The
 * pfd-retro case store carries 87 copies of one such link, which a single
 * rename would break all at once (#1231 follow-up).
 *
 * Only .md targets are returned: resolving them needs nothing but the
 * linking file's directory, whereas an image or data target may legitimately
 * live outside the tree this check can see.
 * @param {string} text
 * @returns {string[]}
 */
export function extractRelativeMarkdownLinks(text) {
	const refs = [];

	for (const target of linkTargets(fromMarkdown(text))) {
		const ref = normalizeRef(target);
		if (
			!REPO_PATH_RE.test(target) &&
			!SCHEME_RE.test(target) &&
			!target.startsWith("/") &&
			!target.startsWith("#") &&
			ref.endsWith(".md")
		)
			refs.push(ref);
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
	const codeLines = new Set();
	walk(fromMarkdown(text), (node) => {
		if (node.type !== "code") return;
		for (
			let line = node.position.start.line;
			line <= node.position.end.line;
			line++
		) {
			codeLines.add(line);
		}
	});
	const headingLines = text
		.split("\n")
		.filter((_, index) => !codeLines.has(index + 1))
		.filter(isHeading)
		.map(headingText);
	return requiredHeadings.filter((h) => !headingLines.includes(h));
}

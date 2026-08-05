// Blocks a release when docs/spec/spec.md's title-line version has no
// matching top-of-file entry in docs/spec/spec-history.md. Before #692 split
// the changelog out of spec.md, both lived in one file, so a version bump and
// its changelog entry sat a scroll apart — no enforcement, but proximity
// made forgetting one unlikely. The split removed that proximity, so this
// check replaces it. The entry is supposed to be written at bump time, in the
// same maintain_spec integrate step (.pfdsl/workflow.md) — this check is a
// release-time backstop for when that was missed, not a license to defer it.
//
// Checks the *top* entry specifically, not just any matching text anywhere in
// the file — spec-history.md is newest-first, so the top entry is the one
// that's supposed to document the current version. A match further down (an
// older entry that happens to share digits, or an entry left over from a
// version that got superseded before shipping) doesn't mean the current
// version is documented at all.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TITLE_VERSION = /^# PFDSL仕様書 (v[\d.]+)/m;

// The canonical changelog entry heading (documented in spec-history.md's own
// header): "vOLD からの主な変更点（vNEW）：". Anchored to a line start so
// prose mentioning a version in passing (e.g. the header's own
// `vX.Y.Z` placeholder) can't match, and requires the parenthesized target —
// the one piece of legacy-format entries (pre-#692) don't have, so this
// intentionally doesn't match those.
const HISTORY_HEADING = /^v[\d.]+\s*からの主な変更点（(v[\d.]+)）/m;

/** @param {string} specSrc raw docs/spec/spec.md content */
export function currentSpecVersion(specSrc) {
	return specSrc.match(TITLE_VERSION)?.[1] ?? null;
}

/** @param {string} historySrc raw docs/spec/spec-history.md content */
export function topHistoryVersion(historySrc) {
	return historySrc.match(HISTORY_HEADING)?.[1] ?? null;
}

/**
 * @param {{readSpec: () => string, readHistory: () => string}} deps
 * @returns {{ok: boolean, message: string}}
 */
export function runSpecHistoryCheck({ readSpec, readHistory }) {
	const version = currentSpecVersion(readSpec());
	if (!version) {
		return {
			ok: false,
			message:
				"docs/spec/spec.md has no title-line version (# PFDSL仕様書 vX.Y.Z) to check spec-history.md against.",
		};
	}

	const topVersion = topHistoryVersion(readHistory());
	if (topVersion === version) {
		return {
			ok: true,
			message: `docs/spec/spec-history.md's top entry documents ${version}.`,
		};
	}
	return {
		ok: false,
		message: [
			`docs/spec/spec.md is at ${version}, but docs/spec/spec-history.md's top entry`,
			topVersion
				? `documents ${topVersion} instead.`
				: "has no changelog heading matching the canonical format (see the file's header note).",
			"Run the spec-history-finalize skill to add or fix it before releasing.",
		].join(" "),
	};
}

/** The real-repository deps for runSpecHistoryCheck.
 * @param {string} root
 */
export function repoDeps(root) {
	return {
		readSpec: () => readFileSync(resolve(root, "docs/spec/spec.md"), "utf-8"),
		readHistory: () =>
			readFileSync(resolve(root, "docs/spec/spec-history.md"), "utf-8"),
	};
}

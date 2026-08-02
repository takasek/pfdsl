// Blocks a release when docs/spec/spec.md's title-line version has no
// matching entry in docs/spec/spec-history.md. Before #692 split the
// changelog out of spec.md, both lived in one file, so a version bump and
// its changelog entry sat a scroll apart — no enforcement, but proximity
// made forgetting one unlikely. The split removed that proximity, so this
// check replaces it, gated at release time (scripts/release.mjs's pre-tag
// checks) rather than per-commit: a title-line bump mid-development doesn't
// need its changelog entry until the release that ships it (follow-up to #692).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TITLE_VERSION = /^# PFDSL仕様書 (v[\d.]+)/m;

/** @param {string} specSrc raw docs/spec/spec.md content */
export function currentSpecVersion(specSrc) {
	return specSrc.match(TITLE_VERSION)?.[1] ?? null;
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
			message: "docs/spec/spec.md has no title-line version (# PFDSL仕様書 vX.Y.Z) to check spec-history.md against.",
		};
	}

	// Not just `includes` — a shorter version string is a substring of any
	// longer one sharing its prefix (v0.0.1 inside v0.0.17), so the match has
	// to reject a trailing digit to avoid a false positive once versions run
	// past single digits.
	const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	if (new RegExp(`${escaped}(?!\\d)`).test(readHistory())) {
		return { ok: true, message: `docs/spec/spec-history.md documents ${version}.` };
	}
	return {
		ok: false,
		message: [
			`docs/spec/spec.md is at ${version}, but docs/spec/spec-history.md has no changelog`,
			"entry mentioning it. Add one (see the file's existing entries for the format) before releasing.",
		].join("\n"),
	};
}

/** The real-repository deps for runSpecHistoryCheck.
 * @param {string} root
 */
export function repoDeps(root) {
	return {
		readSpec: () => readFileSync(resolve(root, "docs/spec/spec.md"), "utf-8"),
		readHistory: () => readFileSync(resolve(root, "docs/spec/spec-history.md"), "utf-8"),
	};
}

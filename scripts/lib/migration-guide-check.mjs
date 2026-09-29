/**
 * Detects a CLI/plugin Unreleased section left in docs/migration-guide.md.
 * Such a section means release preparation has not assigned its destination release, which .pfdsl/workflow.md「採用先への移行案内」 requires before publication.
 *
 * This checks only that the heading is gone. It does not judge whether the section covers every commit of the interval; that stays with the person doing release preparation.
 */

import { forEachNonFencedLine } from "./forward-ref-marker-check.mjs";
import { headingLevel, headingText } from "./markdown-heading.mjs";

const UNRELEASED = /^Unreleased\b/;
const NAMES_CLI_OR_PLUGIN = /\b(?:CLI|plugin)\b/i;

/**
 * Level-2 headings that begin with `Unreleased` and name the CLI or the plugin.
 * Library and VS Code Unreleased sections are not returned; they do not block a CLI/plugin release.
 * @param {string} guideText
 * @returns {string[]} the heading lines, in document order
 */
export function pendingUnreleasedHeadings(guideText) {
	const pending = [];
	forEachNonFencedLine(guideText, (line) => {
		if (headingLevel(line) !== 2) return;
		const text = headingText(line);
		if (UNRELEASED.test(text) && NAMES_CLI_OR_PLUGIN.test(text)) {
			pending.push(line.trimEnd());
		}
	});
	return pending;
}

// Drops spec.md's version-history section (## N. バージョン) before it's
// bundled into references/spec.md. That section grows monotonically and is
// rarely needed by a skill reader — the current version is already carried
// by the title line (# PFDSL仕様書 vX.Y.Z), and full history lives upstream
// (#692). Cut boundary is the section heading itself, so it stays correct
// as the section's number shifts with future edits.

const VERSION_HEADING = /^## \d+\. バージョン\n/m;

/**
 * @param {string} specSrc raw docs/spec/spec.md content
 * @returns {string} specSrc with the version-history section (and its
 *   preceding `---` divider) removed; unchanged if no such heading is found.
 */
export function dropVersionHistory(specSrc) {
	const match = specSrc.match(VERSION_HEADING);
	if (!match) return specSrc;

	const head = specSrc.slice(0, match.index).replace(/\n?-{3,}\n+$/, "\n");
	return `${head.trimEnd()}\n`;
}

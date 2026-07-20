/**
 * Pure functions for gen-article-images: extracts ```pfdsl fenced blocks from
 * article Markdown, associates each block with the images/<name>.svg reference
 * that immediately follows it, and flags duplicate/orphan image names.
 * Filesystem I/O and CLI invocation live in the main script; this module stays
 * testable without touching disk.
 */

const PFDSL_FENCE_START_RE = /^```pfdsl\s*$/;
const FENCE_END_RE = /^```\s*$/;
const IMAGE_REF_RE = /!\[[^\]]*\]\(images\/([^)]+\.svg)\)/;

/**
 * Extract ```pfdsl fenced blocks from markdown text.
 * @param {string} text
 * @returns {{startLine: number, endLine: number, content: string}[]}
 *   startLine/endLine are 1-based line numbers of the opening/closing fence.
 */
export function extractPfdslBlocks(text) {
	const lines = text.split("\n");
	const blocks = [];
	let inBlock = false;
	let startLine = 0;
	let buf = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!inBlock) {
			if (PFDSL_FENCE_START_RE.test(line.trimEnd())) {
				inBlock = true;
				startLine = i + 1;
				buf = [];
			}
		} else if (FENCE_END_RE.test(line.trimEnd())) {
			blocks.push({ startLine, endLine: i + 1, content: buf.join("\n") });
			inBlock = false;
			buf = [];
		} else {
			buf.push(line);
		}
	}

	return blocks;
}

/**
 * Attach the images/<name>.svg reference that first appears between each
 * block's closing fence and the next block's opening fence (or end of file
 * for the last block). Blocks with no such reference (NG examples, etc.) get
 * `imageName: null` — callers should skip those.
 * @param {string} text
 * @param {{startLine: number, endLine: number, content: string}[]} blocks
 * @returns {{startLine: number, endLine: number, content: string, imageName: string | null}[]}
 */
export function attachImageRefs(text, blocks) {
	const lines = text.split("\n");
	return blocks.map((block, i) => {
		const searchStart = block.endLine; // 0-based index of the line right after the closing fence
		const searchEnd = i + 1 < blocks.length ? blocks[i + 1].startLine - 1 : lines.length;
		let imageName = null;
		for (let ln = searchStart; ln < searchEnd; ln++) {
			const m = IMAGE_REF_RE.exec(lines[ln]);
			if (m) {
				imageName = m[1];
				break;
			}
		}
		return { ...block, imageName };
	});
}

/**
 * Detect image names referenced by more than one block within the same
 * article. Blocks with `imageName: null` are ignored.
 * @param {{imageName: string | null}[]} blocksWithImages
 * @returns {string[]} each duplicated name once
 */
export function findDuplicateImageNames(blocksWithImages) {
	const seen = new Set();
	const dups = new Set();
	for (const b of blocksWithImages) {
		if (!b.imageName) continue;
		if (seen.has(b.imageName)) dups.add(b.imageName);
		seen.add(b.imageName);
	}
	return [...dups];
}

/**
 * Determine which images/ SVG files are not referenced by any block across
 * all articles (orphan warning; caller should list but not delete).
 * @param {string[]} allImageNames names of files present on disk
 * @param {string[]} referencedNames names referenced by article blocks
 * @returns {string[]}
 */
export function findOrphanImages(allImageNames, referencedNames) {
	const referenced = new Set(referencedNames);
	return allImageNames.filter((name) => !referenced.has(name));
}

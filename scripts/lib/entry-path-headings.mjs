// A procedure's heading that names the slash command it is reached by reads,
// to anyone who arrived some other way, as a section about someone else — and
// the whole procedure hanging under it goes unread. Naming the content instead
// costs the arriving-by-command reader nothing.
//
// This is a navigation defect, not a resolvability one: it bites a reader
// inside this repo exactly as hard as one in an adopting repo, so the corpus
// is every tracked markdown file rather than the distributed bundle.
//
// Inline code is not stripped, unlike the neighbouring distributed-prose
// rules: backticks are how a command is normally written, so ignoring quoted
// text would blind this check to its own subject. Only ATX headings are
// examined; a setext heading would slip, and the repo carries none.

/** A leading slash that starts a command rather than continuing a path. */
const COMMAND_RE = /(?:^|[^\w./-])\/([a-z][a-z0-9-]+)(?![\w./-])/;

/**
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, line: number, command: string, text: string}>}
 */
export function findEntryPathHeadings(files) {
	const found = [];
	for (const { path, content } of files) {
		let inFence = false;
		content.split("\n").forEach((text, i) => {
			// Tilde fences count too, as in the repo's other markdown scanners: a
			// heading quoted inside a block is an example, not a section of its own.
			if (/^\s*(```|~~~)/.test(text)) {
				inFence = !inFence;
				return;
			}
			if (inFence || !/^#{1,6}\s/.test(text)) return;
			const m = COMMAND_RE.exec(text);
			if (m) found.push({ path, line: i + 1, command: `/${m[1]}`, text });
		});
	}
	return found;
}

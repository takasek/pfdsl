// Builds references/examples.md: an index (example id, what it demonstrates,
// line range) followed by one section per example, so a reader can route to
// and partially read a single domain example instead of the whole file.
// Used by scripts/gen-skill.mjs.

/** Extract a single-line scalar frontmatter field from .pfdsl source. */
export function parseFrontmatterField(src, key) {
	const m = src.match(/^---\n([\s\S]*?)\n---/);
	if (!m) return null;
	const line = m[1].split("\n").find((l) => l.startsWith(`${key}:`));
	if (!line) return null;
	const raw = line.replace(new RegExp(`^${key}:\\s*`), "").trim();
	return raw.replace(/^(["'])(.*)\1$/, "$2");
}

/**
 * @param {{ id: string, source: string }[]} entries example files in order
 * @param {string} header leading comment/title block (must end with "\n")
 * @returns {string} markdown with an index whose L<start>–L<end> ranges match
 *   the emitted section positions (1-based, inclusive)
 */
export function buildExamplesMd(entries, header) {
	const sections = entries.map(({ id, source }) => {
		const title = parseFrontmatterField(source, "title") ?? id;
		const description = parseFrontmatterField(source, "description");
		const fence = source.includes("```") ? "````" : "```";
		const body = `## ${id} — ${title}\n\n${fence}pfdsl\n${source}${fence}\n\n---\n\n`;
		return { id, title, description, body };
	});

	// The index sits between header and sections; its own length shifts every
	// section, so lay out the index first (one line per example, count fixed
	// regardless of the numbers eventually printed).
	const indexHead = "## Index\n\n";
	const indexTail = "\n";
	const headerLines = header.split("\n").length - 1;
	const indexLines = indexHead.split("\n").length - 1 + sections.length + indexTail.split("\n").length - 1;

	let cursor = headerLines + indexLines + 1; // 1-based first line after the index
	const indexEntries = sections.map((s) => {
		const start = cursor;
		// Range ends at the section's closing "---"; a blank separator follows.
		const end = cursor + s.body.split("\n").length - 3;
		cursor = end + 2;
		const demonstrates = s.description ? ` — ${s.description}` : "";
		return `- ${s.id}（${s.title}）L${start}–L${end}${demonstrates}\n`;
	});

	return header + indexHead + indexEntries.join("") + indexTail + sections.map((s) => s.body).join("");
}

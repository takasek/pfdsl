/**
 * Pure functions backing gen-readme-cli.mjs's second target (#850): turning
 * `pfdsl help` and the per-group help outputs into the grouped Markdown tables
 * `packages/cli/README.md` shows on its npm package page.
 *
 * The root README pastes the raw help output, so it needs no parsing; the npm
 * page keeps tables for readability, and those tables were hand-maintained
 * until eight subcommands had gone missing from them. Parsing the help output
 * here means the CLI's own argv surface stays the single source, exactly as it
 * already is for the root README.
 */

/** Entries are indented two spaces; their wrapped descriptions, further. */
const ENTRY_INDENT = 2;

/**
 * The column the descriptions start at.
 *
 * Not a fixed run of spaces: the help formatter aligns descriptions into one
 * column, so the longest usage in a section can end a single space before its
 * description (`status list` does). Splitting on two-or-more spaces reads that
 * line as usage-only and swallows the description. The column is whichever
 * candidate starts leftmost — a wrapped description's indent, or the gap on an
 * entry line — since every description in the section shares it.
 * @param {string[]} sectionLines
 * @returns {number | null} null when no line carries a description
 */
function findDescriptionColumn(sectionLines) {
	/** @type {number[]} */
	const candidates = [];
	for (const line of sectionLines) {
		const indent = line.length - line.trimStart().length;
		if (indent > ENTRY_INDENT) {
			candidates.push(indent);
			continue;
		}
		// Searched past the entry indent, which is itself a run of two spaces.
		const gap = / {2,}\S/.exec(line.slice(ENTRY_INDENT));
		if (gap) candidates.push(ENTRY_INDENT + gap.index + gap[0].length - 1);
	}
	return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * Reads a help output's `Commands:` / `Subcommands:` block into entries.
 *
 * A wrapped description belongs to the entry above it, and a description can
 * wrap more than once (`render`'s puppeteer note does), so continuation lines
 * append rather than overwrite.
 * @param {string} helpOutput
 * @param {string} sectionHeading - the literal heading line, colon included
 * @returns {{usage: string, description: string}[]}
 */
export function parseCommandSection(helpOutput, sectionHeading) {
	const lines = helpOutput.split("\n");
	const start = lines.indexOf(sectionHeading);
	if (start === -1) {
		throw new Error(`help output has no ${sectionHeading} section`);
	}

	const sectionEnd = lines
		.slice(start + 1)
		.findIndex((line) => line.trim() === "");
	const sectionLines = lines.slice(
		start + 1,
		sectionEnd === -1 ? undefined : start + 1 + sectionEnd,
	);
	const descriptionColumn = findDescriptionColumn(sectionLines);

	/** @type {{usage: string, description: string}[]} */
	const entries = [];
	for (const line of sectionLines) {
		const indent = line.length - line.trimStart().length;
		const last = entries.at(-1);
		if (indent > ENTRY_INDENT) {
			if (last) {
				const text = line.trim();
				last.description = last.description
					? `${last.description} ${text}`
					: text;
			}
			continue;
		}
		const splittable =
			descriptionColumn !== null &&
			line.length > descriptionColumn &&
			line[descriptionColumn - 1] === " ";
		entries.push(
			splittable
				? {
						usage: line.slice(ENTRY_INDENT, descriptionColumn).trim(),
						description: line.slice(descriptionColumn).trim(),
					}
				: { usage: line.trim(), description: "" },
		);
	}
	return entries;
}

/**
 * Guards the one way a misparse reaches the README quietly.
 *
 * When the description column is read wrong, the description ends up inside
 * the usage and the entry's description is empty — which renders as a table
 * row with a blank second cell rather than as an error. Every entry in every
 * help section has a description, so an empty one is always the parser's
 * fault, and saying so at generation time costs a build instead of a release.
 * @template {{usage: string, description: string}[]} T
 * @param {T} entries
 * @param {string} label - the section these entries came from, for the message
 * @returns {T}
 */
export function assertEntriesDescribed(entries, label) {
	const undescribed = entries.filter((entry) => entry.description === "");
	if (undescribed.length > 0) {
		throw new Error(
			`${label}: no description parsed for ${undescribed
				.map((entry) => `\`${entry.usage}\``)
				.join(", ")}`,
		);
	}
	return entries;
}

/**
 * The command groups `pfdsl help` advertises, by name and description.
 *
 * The heading carries a backticked `pfdsl <group>` and so cannot be matched
 * literally the way the other sections are. The subcommand list on each entry
 * line is dropped: the group's own help is the source for those, and reading
 * it twice is how the two would come to disagree.
 * @param {string} helpOutput
 * @returns {{name: string, description: string}[]}
 */
export function parseCommandGroups(helpOutput) {
	const heading = helpOutput
		.split("\n")
		.find((line) => line.startsWith("Command groups"));
	if (!heading) {
		throw new Error("help output has no Command groups section");
	}
	return parseCommandSection(helpOutput, heading).map((entry) => ({
		name: entry.usage.split(/\s+/)[0],
		description: entry.description,
	}));
}

/**
 * GFM splits a table row on every unescaped pipe, code spans included, and
 * usage strings are full of them (`<file|->`).
 * @param {string} text
 * @returns {string}
 */
function escapeTableCell(text) {
	return text.replace(/\|/g, "\\|");
}

/**
 * @param {{usage: string, description: string}[]} entries
 * @param {string} prefix - `pfdsl` or `pfdsl <group>`
 * @returns {string}
 */
function renderTable(entries, prefix) {
	const rows = entries.map(
		(entry) =>
			`| \`${escapeTableCell(`${prefix} ${entry.usage}`)}\` | ${escapeTableCell(entry.description)} |`,
	);
	return ["| Command | Description |", "|---|---|", ...rows].join("\n");
}

/**
 * @param {{commands: {usage: string, description: string}[],
 *          groups: {name: string, description: string,
 *                   subcommands: {usage: string, description: string}[]}[]}} cli
 * @returns {string}
 */
export function renderCommandTables({ commands, groups }) {
	const sections = [renderTable(commands, "pfdsl")];
	for (const group of groups) {
		sections.push(
			`### \`${group.name}\` — ${group.description}\n\n${renderTable(
				group.subcommands,
				`pfdsl ${group.name}`,
			)}`,
		);
	}
	return sections.join("\n\n");
}

// Renders the pfdsl skill's CLI section from `pfdsl help` output: one
// `npx @pfdsl/cli <signature>` line per command, annotated with the
// command's first description line. Flag details stay in `pfdsl help`.
// Used by scripts/gen-skill.mjs (README embeds the full help output via
// scripts/gen-readme-cli.mjs instead).

/**
 * @param {string} helpOutput raw `pfdsl help` stdout
 * @returns {string} bash-block body, one line per command
 */
export function renderCliSection(helpOutput) {
	const lines = helpOutput.split("\n");
	const start = lines.findIndex((l) => l.trim() === "Commands:");
	if (start === -1) {
		throw new Error("`pfdsl help` output has no Commands: section");
	}

	const entries = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim().startsWith("Exit codes:")) break;
		if (line.trim() !== "" && !line.startsWith("  ")) continue; // section sub-header, e.g. "Command groups (...):"
		const command = line.match(/^ {2}(\S.*)$/);
		if (command) {
			// Inline description separated by a run of spaces (e.g. the `help` entry).
			const [signature, inlineDesc] = command[1].split(/ {3,}/, 2);
			entries.push({ signature: signature.trim(), desc: inlineDesc?.trim() ?? null });
			continue;
		}
		const detail = line.match(/^ {4,}(\S.*)$/);
		if (detail && entries.length > 0) {
			const last = entries[entries.length - 1];
			// First non-flag detail line is the command's short description.
			if (last.desc === null && !detail[1].startsWith("--")) last.desc = detail[1].trim();
		}
	}

	return entries
		.map(({ signature, desc }) => `npx @pfdsl/cli ${signature}${desc ? `   # ${desc}` : ""}`)
		.join("\n");
}

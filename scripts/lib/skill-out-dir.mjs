// Shared --out handling for the skill generators (gen-skill.mjs,
// gen-skill-refs.mjs). Parses the flag and enforces that the path contains
// '.claude' or 'skills' as a path component, so a typo'd --out can't clobber
// an arbitrary directory. Both entry points go through this so the --out
// contract can't drift between them.

import { resolve } from "node:path";

/**
 * @param {string} scriptName path used in the usage message, e.g. "scripts/gen-skill.mjs"
 * @param {string[]} argv argument vector to read --out from
 * @returns {string} absolute output directory path
 */
export function parseSkillOutDir(scriptName, argv = process.argv) {
	const outIdx = argv.indexOf("--out");
	if (outIdx === -1 || !argv[outIdx + 1] || argv[outIdx + 1].startsWith("-")) {
		console.error(`Usage: node ${scriptName} --out <skill-dir>`);
		console.error(`Example: node ${scriptName} --out .claude/skills/pfdsl`);
		process.exit(2);
	}

	const outDir = resolve(process.cwd(), argv[outIdx + 1]);
	const parts = outDir.split(/[\\/]/);
	if (!parts.includes(".claude") && !parts.includes("skills")) {
		console.error(`Error: output path must contain a '.claude' or 'skills' directory component — got: ${outDir}`);
		console.error("This check prevents accidentally writing to the wrong location.");
		process.exit(1);
	}
	return outDir;
}

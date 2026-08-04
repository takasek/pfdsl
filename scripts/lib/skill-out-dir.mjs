// Shared --out handling for the skill generators (gen-skill.mjs,
// gen-skill-refs.mjs). Parses the flag and enforces that the path contains
// '.claude' or 'skills' as a path component, so a typo'd --out can't clobber
// an arbitrary directory. Both entry points go through this so the --out
// contract can't drift between them.

import { resolve } from "node:path";
import { parseArgs } from "node:util";

/**
 * @param {string} scriptName path used in the usage message, e.g. "scripts/gen-skill.mjs"
 * @param {string[]} argv argument vector past the script name, i.e. process.argv.slice(2)
 * @returns {string} absolute output directory path
 */
export function parseSkillOutDir(scriptName, argv) {
	// strict parsing, not indexOf("--out"): the inline --out=… form was
	// invisible to the lookup, so the generators printed their usage as though
	// no destination had been named, and a typo'd flag alongside a valid --out
	// was dropped without a word (#648).
	const usage = () => {
		console.error(`Usage: node ${scriptName} --out <skill-dir>`);
		console.error(`Example: node ${scriptName} --out .claude/skills/pfdsl`);
	};
	let values;
	try {
		({ values } = parseArgs({
			args: argv,
			options: { out: { type: "string" } },
			strict: true,
			allowPositionals: false,
		}));
	} catch (err) {
		console.error(`${scriptName}: ${err.message}`);
		usage();
		process.exit(2);
	}
	if (!values.out) {
		usage();
		process.exit(2);
	}

	const outDir = resolve(process.cwd(), values.out);
	const parts = outDir.split(/[\\/]/);
	if (!parts.includes(".claude") && !parts.includes("skills")) {
		console.error(`Error: output path must contain a '.claude' or 'skills' directory component — got: ${outDir}`);
		console.error("This check prevents accidentally writing to the wrong location.");
		process.exit(1);
	}
	return outDir;
}

// Shared output-path safety check for skill generators (gen-skill.mjs,
// gen-skill-refs.mjs): the --out path must contain '.claude' or 'skills' as
// a path component, so a typo'd --out can't clobber an arbitrary directory.

/**
 * @param {string} outDir absolute output directory path
 */
export function assertSafeSkillOutDir(outDir) {
	const parts = outDir.split(/[\\/]/);
	if (!parts.includes(".claude") && !parts.includes("skills")) {
		console.error(`Error: output path must contain a '.claude' or 'skills' directory component — got: ${outDir}`);
		console.error("This check prevents accidentally writing to the wrong location.");
		process.exit(1);
	}
}

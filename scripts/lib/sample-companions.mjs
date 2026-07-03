// Resolves companion sample files: a .pfdsl file named `<id>-<suffix>` where
// `<id>` is a registered samples.tsv id is a companion of that sample (child
// subflow, preset base, etc.) and is embedded in the parent's samples.md
// section instead of getting its own entry. Used by scripts/gen-skill.mjs.

/**
 * @param {string[]} registeredIds ids present in samples.tsv
 * @param {string[]} fileIds .pfdsl file basenames (without extension)
 * @returns {{ companionsById: Map<string, string[]>, orphans: string[] }}
 *   companions keyed by the longest matching registered id; files matching
 *   no registered id (and not registered themselves) are orphans.
 */
export function resolveCompanions(registeredIds, fileIds) {
	const registered = new Set(registeredIds);
	const byLengthDesc = [...registeredIds].sort((a, b) => b.length - a.length);
	const companionsById = new Map();
	const orphans = [];

	for (const file of [...fileIds].sort()) {
		if (registered.has(file)) continue;
		const owner = byLengthDesc.find((id) => file.startsWith(`${id}-`));
		if (owner === undefined) {
			orphans.push(file);
			continue;
		}
		if (!companionsById.has(owner)) companionsById.set(owner, []);
		companionsById.get(owner).push(file);
	}
	return { companionsById, orphans };
}

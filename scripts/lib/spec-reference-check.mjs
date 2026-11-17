/**
 * Current authoring inputs only. Versioned proposals, decisions, reviews and
 * generated mirrors retain the references from the version they document.
 */
export function selectSpecReferenceSources(files) {
	return files.filter((file) => {
		if (/\/(?:fixtures|evidence|dist|node_modules)\//.test(file)) return false;
		if (/^(?:packages|scripts)\/.*\.(?:[cm]?[jt]sx?|rs|md)$/.test(file))
			return true;
		if (/^[^/]+\.md$/.test(file))
			return !["AGENTS.md", "CLAUDE.md", "CHANGELOG.md"].includes(file);
		if (/^docs\/[^/]+\.md$/.test(file))
			return !["docs/pfd_payoff_log.md", "docs/wiki-roadmap-spike.md"].includes(
				file,
			);
		return /^\.pfdsl\/(?:[^/]+|bindings\/[^/]+)\.md$/.test(file);
	});
}

/**
 * Read raw source, including strings, code spans and fenced examples. These
 * files consume definitions; a definition-shaped comment cannot define one.
 * A literal annotation applies only to its own physical line.
 */
export function checkExternalSpecReferences(sources, definitions) {
	const known = new Set(definitions.map(({ id }) => id));
	const violations = [];
	let references = 0;
	let literals = 0;
	for (const { file, text } of sources) {
		for (const [i, line] of text.split(/\r?\n/).entries()) {
			const literal =
				/<!--\s*spec-ref-literal:\s*(.*?)\s*-->|(?:\/\/|#)\s*spec-ref-literal:\s*(.*?)\s*$/.exec(
					line,
				);
			const where = `${file}:${i + 1}`;
			if (literal) {
				if (!(literal[1] ?? literal[2]).trim())
					violations.push(`${where}: spec-ref-literal requires a reason`);
				else literals++;
				continue;
			}
			for (const match of line.matchAll(/§\s*\d+(?:\.\d+)*/g))
				violations.push(
					`${where}: numbered specification reference ${match[0]} — use an existing specification ID, or name an unnumbered rule`,
				);
			for (const match of line.matchAll(/\[\[(SPEC_[A-Za-z0-9_]+)\]\]/g)) {
				references++;
				if (!known.has(match[1]))
					violations.push(`${where}: ${match[1]} has no definition in docs`);
			}
		}
	}
	return { violations, references, literals };
}

import { HARNESS_CAPABILITY_CONTRACT } from "./harness-inventory.mjs";

// These authoring inputs are shipped with spec.md rather than the docs corpus.
// Harness inputs follow the generator's declared inventory.
const bundledInputs = [
	"scripts/skill-template/SKILL.md",
	"packages/cli/src",
	"docs/quality-guide.md",
	"docs/review-perspectives.md",
	...HARNESS_CAPABILITY_CONTRACT.filter(
		({ source, mappings }) =>
			!source.generated &&
			mappings.some(
				({ target, disposition }) =>
					target.endsWith("-plugin") && disposition !== "intentional-exclusion",
			),
	).flatMap(({ source }) =>
		source.files
			? source.files.map((file) => `${source.path}/${file}`)
			: [source.path],
	),
];

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
	const bundled = new Set(
		definitions
			.filter(({ file }) => file === "docs/spec/spec.md")
			.map(({ id }) => id),
	);
	const violations = [];
	let references = 0;
	let literals = 0;
	for (const { file, text } of sources) {
		const distributed = bundledInputs.some(
			(input) => file === input || file.startsWith(`${input}/`),
		);
		const available = distributed ? bundled : known;
		const definitionScope = distributed ? "docs/spec/spec.md" : "docs";
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
				if (!available.has(match[1]))
					violations.push(
						`${where}: ${match[1]} has no definition in ${definitionScope}`,
					);
			}
		}
	}
	return { violations, references, literals };
}

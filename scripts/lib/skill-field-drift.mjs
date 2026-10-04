import { fileURLToPath } from "node:url";
import ts from "typescript";

// Detects drift between the typed frontmatter fields in
// packages/core/src/types/frontmatter.ts and the "Frontmatter structure"
// section of the pfdsl skill template. Every typed field must be mentioned
// (as a word) somewhere in that section — either as a YAML key in the block
// or by name in a pointer line. Used by scripts/gen-skill.mjs.

const SECTION_HEADING = "## Frontmatter structure";

// Exported types to audit, in report order. Others (e.g. LoadResult) are ignored.
const AUDITED_TYPES = [
	"Frontmatter",
	"ArtifactMeta",
	"ProcessMeta",
	"GroupMeta",
	"TagMeta",
];

/**
 * Resolve the five exported types, including schema-derived aliases, with
 * TypeScript's checker. Use the source location for dependency resolution;
 * no built output or hand-maintained list of schema fields is involved.
 */
export function extractTypedFields(tsSource) {
	const result = {};
	const filename = fileURLToPath(
		new URL("../../packages/core/src/types/frontmatter.ts", import.meta.url),
	);
	const options = {
		strict: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
	};
	const host = ts.createCompilerHost(options);
	const readSource = host.getSourceFile.bind(host);
	host.getSourceFile = (path, languageVersion, ...rest) =>
		path === filename
			? ts.createSourceFile(path, tsSource, languageVersion, true)
			: readSource(path, languageVersion, ...rest);
	const program = ts.createProgram([filename], options, host);
	const source = program.getSourceFile(filename);
	const checker = program.getTypeChecker();
	const errors = [
		...program.getSyntacticDiagnostics(source),
		...program.getSemanticDiagnostics(source),
	].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
	if (errors.length)
		throw new Error(
			`Cannot resolve fields: ${errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; ")}`,
		);
	const moduleSymbol = checker.getSymbolAtLocation(source);
	const exports = moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : [];
	for (const name of AUDITED_TYPES) {
		const symbol = exports.find((entry) => entry.name === name);
		if (!symbol) throw new Error(`Missing exported type definition: ${name}`);
		const type = checker.getDeclaredTypeOfSymbol(symbol);
		const fields = checker.getPropertiesOfType(type).map((field) => field.name);
		if (fields.length === 0)
			throw new Error(`Cannot resolve non-empty fields for ${name}`);
		result[name] = fields;
	}
	return result;
}

/**
 * Return the text of a markdown section: from the heading line up to the
 * next heading of the same level (or EOF). Throws if the heading is absent.
 */
export function extractSectionText(source, heading = SECTION_HEADING) {
	const lines = source.split("\n");
	const start = lines.findIndex((l) => l.trim() === heading);
	if (start === -1) {
		throw new Error(`section heading not found: ${heading}`);
	}
	const level = heading.match(/^#+/)[0];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => l.startsWith(`${level} `));
	const body = end === -1 ? rest : rest.slice(0, end);
	return [lines[start], ...body].join("\n");
}

/**
 * Return `Type.field` entries for every typed field not mentioned in
 * the template's frontmatter-structure section.
 */
export function findMissingFields(tsSource, templateSource) {
	const typed = extractTypedFields(tsSource);
	const section = extractSectionText(templateSource);
	const missing = [];
	for (const iface of AUDITED_TYPES) {
		for (const field of typed[iface]) {
			if (!new RegExp(`\\b${field}\\b`).test(section)) {
				missing.push(`${iface}.${field}`);
			}
		}
	}
	return missing;
}

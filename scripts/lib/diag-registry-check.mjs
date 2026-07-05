/**
 * Pure functions for diffing spec.md's §16 diagnostic code table against the
 * DIAGNOSTIC_REGISTRY exported by @pfdsl/core. Network/FS I/O and the core
 * import live in the main script; this module stays testable without a build.
 */

const SEVERITY_LABELS = {
	error: ["error"],
	warning: ["warning"],
	"warning (--strict: error)": ["warning", "error"],
};

/**
 * Parses the `| コード | severity | 定義節 | 条件 |` markdown table out of
 * spec.md's §16. Returns a map of code -> normalized severities array.
 * Throws if a severity cell doesn't match a known label.
 *
 * @param {string} specText
 * @returns {Record<string, string[]>}
 */
export function parseSpecDiagTable(specText) {
	const lines = specText.split("\n");
	const headerIdx = lines.findIndex((l) =>
		/^\|\s*コード\s*\|\s*severity\s*\|/.test(l),
	);
	if (headerIdx === -1) {
		throw new Error("§16 diagnostic code table header not found in spec.md");
	}

	const result = {};
	// Row format: | CODE | severity | §section | condition text |
	const ROW_RE = /^\|\s*([A-Z]+\d+)\s*\|\s*([^|]+?)\s*\|/;

	for (let i = headerIdx + 2; i < lines.length; i++) {
		const line = lines[i];
		if (!line.startsWith("|")) break; // table ended
		const m = line.match(ROW_RE);
		if (!m) continue;
		const [, code, severityCell] = m;
		const severities = SEVERITY_LABELS[severityCell];
		if (!severities) {
			throw new Error(
				`spec.md §16 table: unrecognized severity "${severityCell}" for code ${code}`,
			);
		}
		result[code] = severities;
	}

	return result;
}

/**
 * Compares the spec.md table entries against the DIAGNOSTIC_REGISTRY.
 *
 * @param {Record<string, string[]>} specCodes
 * @param {Record<string, {severities: readonly string[]}>} registry
 * @returns {{missingInSpec: string[], staleInSpec: string[], severityMismatches: string[]}}
 */
export function diffDiagRegistry(specCodes, registry) {
	const missingInSpec = Object.keys(registry).filter(
		(code) => !(code in specCodes),
	);
	const staleInSpec = Object.keys(specCodes).filter(
		(code) => !(code in registry),
	);
	const severityMismatches = Object.keys(specCodes)
		.filter((code) => code in registry)
		.filter((code) => {
			const a = [...specCodes[code]].sort();
			const b = [...registry[code].severities].sort();
			return JSON.stringify(a) !== JSON.stringify(b);
		});

	return {
		missingInSpec: missingInSpec.sort(),
		staleInSpec: staleInSpec.sort(),
		severityMismatches: severityMismatches.sort(),
	};
}

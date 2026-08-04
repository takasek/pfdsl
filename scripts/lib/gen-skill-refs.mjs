// Generates the build-independent references/*.md files for the pfdsl skill
// (spec / review-perspectives / quality-guide / samples / examples).
// Split out of scripts/gen-skill.mjs (#586) so a references-only drift check
// can run in scripts/pre-commit without requiring packages/cli/dist/cli.js —
// unlike SKILL.md generation (step 3 of gen-skill.mjs), which embeds `pfdsl
// help` output and therefore needs the built CLI.
//
// This module (and anything it imports) must never touch packages/cli/dist
// or spawn a child process — that build-independence is what the pre-commit
// drift check in scripts/pre-commit relies on. scripts/lib/gen-skill-refs.test.mjs
// asserts this via static import-graph inspection.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { buildExamplesMd } from "./examples-index.mjs";
import { resolveCompanions } from "./sample-companions.mjs";
import { currentSpecVersion } from "./spec-history-check.mjs";

function buildExamplesIndexMd(dir) {
	const entries = readdirSync(dir)
		.filter((f) => f.endsWith(".pfdsl"))
		.sort()
		.map((f) => ({
			id: f.replace(".pfdsl", ""),
			source: readFileSync(resolve(dir, f), "utf-8"),
		}));

	if (entries.length === 0) {
		console.warn(`warn: no .pfdsl files found in ${dir}`);
	}
	const header = `<!-- DO NOT EDIT — generated from docs/examples/ in https://github.com/takasek/pfdsl -->\n\n# PFDSL Examples Reference\n\nRealistic domain examples demonstrating the quality guide. Use the index to Read only the relevant line range.\n\n`;
	return { md: buildExamplesMd(entries, header), count: entries.length };
}

/**
 * Writes references/{spec,review-perspectives,quality-guide,samples,examples}.md
 * under `${outDir}/references`.
 *
 * @param {string} root repo root
 * @param {string} outDir skill directory (references/ is created under it)
 * @returns {string} specVersion extracted from docs/spec/spec.md, e.g. "v1.2.3"
 *   — callers that also generate SKILL.md (gen-skill.mjs) need it there.
 */
export function writeSkillRefs(root, outDir) {
	const refsDir = resolve(outDir, "references");
	mkdirSync(refsDir, { recursive: true });

	// --- 1. Copy spec ---

	const specSrc = readFileSync(resolve(root, "docs/spec/spec.md"), "utf-8");
	const specVersion = currentSpecVersion(specSrc) ?? "unknown";
	const baseHeader = (src) =>
		`<!-- DO NOT EDIT — snapshot distributed with pfdsl skill. Authoritative source: https://github.com/takasek/pfdsl/blob/main/${src} -->\n\n`;
	writeFileSync(
		resolve(refsDir, "spec.md"),
		baseHeader("docs/spec/spec.md") + specSrc,
	);
	console.log("references/spec.md ← docs/spec/spec.md");

	// --- 1b. Copy review perspectives ---

	const promptsSrc = readFileSync(
		resolve(root, "docs/review-perspectives.md"),
		"utf-8",
	);
	writeFileSync(
		resolve(refsDir, "review-perspectives.md"),
		baseHeader("docs/review-perspectives.md") + promptsSrc,
	);
	console.log(
		"references/review-perspectives.md ← docs/review-perspectives.md",
	);

	// --- 1c. Copy quality guide ---

	const qualityGuideSrc = readFileSync(
		resolve(root, "docs/quality-guide.md"),
		"utf-8",
	);
	writeFileSync(
		resolve(refsDir, "quality-guide.md"),
		baseHeader("docs/quality-guide.md") + qualityGuideSrc,
	);
	console.log("references/quality-guide.md ← docs/quality-guide.md");

	// --- 2. Generate samples.md from TSV ---

	const samplesDir = resolve(root, "docs/samples");
	const tsv = readFileSync(resolve(samplesDir, "samples.tsv"), "utf-8");
	const rows = tsv
		.trim()
		.split("\n")
		.slice(1)
		.map((line) => {
			const [id, summary, description] = line.split("\t");
			return {
				id: id.trim(),
				summary: summary?.trim() ?? "",
				description: description?.trim() ?? "",
			};
		});

	const sampleFileIds = readdirSync(samplesDir)
		.filter((f) => f.endsWith(".pfdsl"))
		.map((f) => f.replace(".pfdsl", ""));
	const { companionsById, orphans } = resolveCompanions(
		rows.map((r) => r.id),
		sampleFileIds,
	);
	for (const id of orphans) {
		console.warn(
			`  warn: ${id}.pfdsl exists but has no entry in samples.tsv — will not appear in references/samples.md`,
		);
	}

	let samplesMd = `<!-- DO NOT EDIT — generated from docs/samples/ in https://github.com/takasek/pfdsl -->\n\n# PFDSL Samples Reference\n\nAnnotated .pfdsl files illustrating each language feature.\n\n`;
	let sampleCount = 0;

	for (const { id, summary, description } of rows) {
		const pfdslPath = resolve(samplesDir, `${id}.pfdsl`);
		if (!existsSync(pfdslPath)) {
			console.warn(`  warn: ${id}.pfdsl not found, skipping`);
			continue;
		}
		const src = readFileSync(pfdslPath, "utf-8");
		const fence = src.includes("```") ? "````" : "```";
		samplesMd += `## ${id} — ${summary}\n\n${description}\n\n${fence}pfdsl\n${src}${fence}\n\n`;
		for (const cid of companionsById.get(id) ?? []) {
			const csrc = readFileSync(resolve(samplesDir, `${cid}.pfdsl`), "utf-8");
			const cfence = csrc.includes("```") ? "````" : "```";
			samplesMd += `Companion file \`${cid}.pfdsl\` referenced above:\n\n${cfence}pfdsl\n${csrc}${cfence}\n\n`;
		}
		samplesMd += `---\n\n`;
		sampleCount++;
	}

	if (sampleCount === 0) {
		console.warn(
			"warn: no sample .pfdsl files found — references/samples.md will contain no examples",
		);
	}
	writeFileSync(resolve(refsDir, "samples.md"), samplesMd);
	console.log(
		`references/samples.md ← docs/samples/*.pfdsl via samples.tsv (${sampleCount} samples)`,
	);

	// --- 2b. Generate examples.md from frontmatter ---

	const { md: examplesMd, count: exampleCount } = buildExamplesIndexMd(
		resolve(root, "docs/examples"),
	);
	writeFileSync(resolve(refsDir, "examples.md"), examplesMd);
	console.log(
		`references/examples.md ← docs/examples/*.pfdsl (${exampleCount} examples)`,
	);

	return specVersion;
}

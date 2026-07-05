#!/usr/bin/env node
// Generates the pfdsl Claude skill to a target directory.
// Run: node scripts/gen-skill.mjs --out .claude/skills/pfdsl
// The --out path must contain '.claude/' or 'skills/' (safety check).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execFileSync } from "node:child_process";

import { findMissingFields } from "./lib/skill-field-drift.mjs";
import { resolveCompanions } from "./lib/sample-companions.mjs";
import { renderCliSection } from "./lib/skill-cli-section.mjs";
import { buildExamplesMd } from "./lib/examples-index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// --- Parse args ---

const outIdx = process.argv.indexOf("--out");
if (outIdx === -1 || !process.argv[outIdx + 1] || process.argv[outIdx + 1].startsWith("-")) {
  console.error("Usage: node scripts/gen-skill.mjs --out <skill-dir>");
  console.error("Example: node scripts/gen-skill.mjs --out .claude/skills/pfdsl");
  process.exit(2);
}

const outDir = resolve(process.cwd(), process.argv[outIdx + 1]);

const parts = outDir.split(/[\\/]/);
if (!parts.includes(".claude") && !parts.includes("skills")) {
  console.error(`Error: output path must contain a '.claude' or 'skills' directory component — got: ${outDir}`);
  console.error("This check prevents accidentally writing to the wrong location.");
  process.exit(1);
}

const refsDir = resolve(outDir, "references");
mkdirSync(refsDir, { recursive: true });

// --- Helpers ---

function buildExamplesIndexMd(dir) {
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".pfdsl"))
    .sort()
    .map((f) => ({ id: f.replace(".pfdsl", ""), source: readFileSync(resolve(dir, f), "utf-8") }));

  if (entries.length === 0) {
    console.warn(`warn: no .pfdsl files found in ${dir}`);
  }
  const header = `<!-- DO NOT EDIT — generated from docs/examples/ in https://github.com/takasek/pfdsl -->\n\n# PFDSL Examples Reference\n\nRealistic domain examples demonstrating the quality guide. Use the index to Read only the relevant line range.\n\n`;
  return { md: buildExamplesMd(entries, header), count: entries.length };
}

// --- 1. Copy spec ---

const specSrc = readFileSync(resolve(root, "docs/spec/spec.md"), "utf-8");
const specVersion = specSrc.match(/^# PFDSL仕様書 (v[\d.]+)/m)?.[1] ?? "unknown";
const cliVersion = JSON.parse(
	readFileSync(resolve(root, "packages/cli/package.json"), "utf-8"),
).version;
const baseHeader = (src) =>
  `<!-- DO NOT EDIT — snapshot distributed with pfdsl skill. Authoritative source: https://github.com/takasek/pfdsl/blob/main/${src} -->\n\n`;
writeFileSync(resolve(refsDir, "spec.md"), baseHeader("docs/spec/spec.md") + specSrc);
console.log("references/spec.md ← docs/spec/spec.md");

// --- 1b. Copy review perspectives ---

const promptsSrc = readFileSync(resolve(root, "docs/review-perspectives.md"), "utf-8");
writeFileSync(resolve(refsDir, "review-perspectives.md"), baseHeader("docs/review-perspectives.md") + promptsSrc);
console.log("references/review-perspectives.md ← docs/review-perspectives.md");

// --- 2. Generate samples.md from TSV ---

const samplesDir = resolve(root, "docs/samples");
const tsv = readFileSync(resolve(samplesDir, "samples.tsv"), "utf-8");
const rows = tsv
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const [id, summary, description] = line.split("\t");
    return { id: id.trim(), summary: summary?.trim() ?? "", description: description?.trim() ?? "" };
  });

const sampleFileIds = readdirSync(samplesDir)
  .filter((f) => f.endsWith(".pfdsl"))
  .map((f) => f.replace(".pfdsl", ""));
const { companionsById, orphans } = resolveCompanions(rows.map((r) => r.id), sampleFileIds);
for (const id of orphans) {
  console.warn(`  warn: ${id}.pfdsl exists but has no entry in samples.tsv — will not appear in references/samples.md`);
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
  console.warn("warn: no sample .pfdsl files found — references/samples.md will contain no examples");
}
writeFileSync(resolve(refsDir, "samples.md"), samplesMd);
console.log(`references/samples.md ← docs/samples/*.pfdsl via samples.tsv (${sampleCount} samples)`);

// --- 2b. Generate examples.md from frontmatter ---

const { md: examplesMd, count: exampleCount } = buildExamplesIndexMd(resolve(root, "docs/examples"));
writeFileSync(resolve(refsDir, "examples.md"), examplesMd);
console.log(`references/examples.md ← docs/examples/*.pfdsl (${exampleCount} examples)`);

// --- 3. Write SKILL.md from template ---

const templateSrc = readFileSync(resolve(__dirname, "skill-template/SKILL.md"), "utf-8");

const frontmatterTs = readFileSync(resolve(root, "packages/core/src/types/frontmatter.ts"), "utf-8");
const missingFields = findMissingFields(frontmatterTs, templateSrc);
if (missingFields.length > 0) {
  console.error("Error: typed frontmatter fields missing from skill-template 'Frontmatter structure' section:");
  for (const f of missingFields) console.error(`  - ${f}`);
  console.error("Add them to the yaml block (or the pointer line below it) in scripts/skill-template/SKILL.md.");
  process.exit(1);
}

const cliPath = resolve(root, "packages/cli/dist/cli.js");
if (!existsSync(cliPath)) {
  console.error("Error: packages/cli/dist/cli.js not found. Run 'pnpm -r build' first.");
  process.exit(1);
}
const helpOutput = execFileSync(process.execPath, [cliPath, "help"], { encoding: "utf-8" });

const skillMd = templateSrc
	.replace(/\{\{specVersion\}\}/g, specVersion)
	.replace(/\{\{cliVersion\}\}/g, cliVersion)
	.replace("{{cliCommands}}", renderCliSection(helpOutput));

writeFileSync(resolve(outDir, "SKILL.md"), skillMd);
console.log("SKILL.md → generated from skill-template/SKILL.md");

console.log(`\nSkill written to: ${outDir}`);

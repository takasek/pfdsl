#!/usr/bin/env node
// Generates the pfdsl Claude skill to a target directory.
// Run: node scripts/gen-skill.mjs --out .claude/skills/pfdsl
// The --out path must contain '.claude/' (safety check).

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

if (!outDir.split(/[\\/]/).includes(".claude")) {
  console.error(`Error: output path must contain a '.claude' directory component — got: ${outDir}`);
  console.error("This check prevents accidentally writing to the wrong location.");
  process.exit(1);
}

const refsDir = resolve(outDir, "references");
mkdirSync(refsDir, { recursive: true });

// --- Helpers ---

function parseFrontmatterTitle(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const line = m[1].split("\n").find((l) => l.startsWith("title:"));
  if (!line) return null;
  const raw = line.replace(/^title:\s*/, "").trim();
  return raw.replace(/^(["'])(.*)\1$/, "$2");
}

function buildExamplesIndexMd(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".pfdsl"))
    .sort();

  let md = `# PFDSL Examples Reference\n\nRealistic domain examples demonstrating the quality guide.\n\n`;
  let count = 0;

  for (const f of files) {
    const src = readFileSync(resolve(dir, f), "utf-8");
    const id = f.replace(".pfdsl", "");
    const title = parseFrontmatterTitle(src) ?? id;
    const fence = src.includes("```") ? "````" : "```";
    md += `## ${id} — ${title}\n\n${fence}pfdsl\n${src}${fence}\n\n---\n\n`;
    count++;
  }

  if (count === 0) {
    console.warn(`warn: no .pfdsl files found in ${dir}`);
  }
  return { md, count };
}

// --- 1. Copy spec ---

const specSrc = readFileSync(resolve(root, "docs/spec/spec.md"), "utf-8");
const specVersion = specSrc.match(/^# PFDSL仕様書 (v[\d.]+)/m)?.[1] ?? "unknown";
writeFileSync(resolve(refsDir, "spec.md"), specSrc);
console.log("references/spec.md ← docs/spec/spec.md");

// --- 1b. Copy review prompts ---

const promptsSrc = readFileSync(resolve(root, "docs/review-prompts.md"), "utf-8");
writeFileSync(resolve(refsDir, "review-prompts.md"), promptsSrc);
console.log("references/review-prompts.md ← docs/review-prompts.md");

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

const tsvIds = new Set(rows.map((r) => r.id));
for (const f of readdirSync(samplesDir).filter((f) => f.endsWith(".pfdsl"))) {
  if (!tsvIds.has(f.replace(".pfdsl", ""))) {
    console.warn(`  warn: ${f} exists but has no entry in samples.tsv — will not appear in references/samples.md`);
  }
}

let samplesMd = `# PFDSL Samples Reference\n\nAnnotated .pfdsl files illustrating each language feature.\n\n`;
let sampleCount = 0;

for (const { id, summary, description } of rows) {
  const pfdslPath = resolve(samplesDir, `${id}.pfdsl`);
  if (!existsSync(pfdslPath)) {
    console.warn(`  warn: ${id}.pfdsl not found, skipping`);
    continue;
  }
  const src = readFileSync(pfdslPath, "utf-8");
  const fence = src.includes("```") ? "````" : "```";
  samplesMd += `## ${id} — ${summary}\n\n${description}\n\n${fence}pfdsl\n${src}${fence}\n\n---\n\n`;
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
const skillMd = templateSrc.replace(/\{\{specVersion\}\}/g, specVersion);

writeFileSync(resolve(outDir, "SKILL.md"), skillMd);
console.log("SKILL.md → generated from skill-template/SKILL.md");

console.log(`\nSkill written to: ${outDir}`);

#!/usr/bin/env node
// Generates the pfdsl Claude skill to a target directory.
// Run: node scripts/gen-skill.mjs --out .claude/skills/pfdsl
// The --out path must contain '.claude/' (safety check).

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
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

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const result = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_]\w*):\s+(.*)/);
    if (kv) result[kv[1]] = kv[2].trim();
  }
  return result;
}

function buildIndexMd(heading, intro, dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".pfdsl"))
    .sort();

  let md = `# ${heading}\n\n${intro}\n\n`;
  let count = 0;

  for (const f of files) {
    const src = readFileSync(resolve(dir, f), "utf-8");
    const fm = parseFrontmatter(src);
    const id = f.replace(".pfdsl", "");
    const title = fm.title ?? id;
    const description = fm.description ?? "";
    const fence = src.includes("```") ? "````" : "```";
    md += `## ${id} — ${title}\n\n`;
    if (description) md += `${description}\n\n`;
    md += `${fence}pfdsl\n${src}${fence}\n\n---\n\n`;
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

// --- 2. Generate samples.md from frontmatter ---

const { md: samplesMd, count: sampleCount } = buildIndexMd(
  "PFDSL Samples Reference",
  "Annotated .pfdsl files illustrating each language feature.",
  resolve(root, "docs/samples"),
);
writeFileSync(resolve(refsDir, "samples.md"), samplesMd);
console.log(`references/samples.md ← docs/samples/*.pfdsl (${sampleCount} samples)`);

// --- 2b. Generate examples.md from frontmatter ---

const { md: examplesMd, count: exampleCount } = buildIndexMd(
  "PFDSL Examples Reference",
  "Realistic domain examples demonstrating the quality guide.",
  resolve(root, "docs/examples"),
);
writeFileSync(resolve(refsDir, "examples.md"), examplesMd);
console.log(`references/examples.md ← docs/examples/*.pfdsl (${exampleCount} examples)`);

// --- 3. Write SKILL.md from template ---

const templateSrc = readFileSync(resolve(__dirname, "skill-template/SKILL.md"), "utf-8");
const skillMd = templateSrc.replace(/\{\{specVersion\}\}/g, specVersion);

writeFileSync(resolve(outDir, "SKILL.md"), skillMd);
console.log("SKILL.md → generated from skill-template/SKILL.md");

console.log(`\nSkill written to: ${outDir}`);

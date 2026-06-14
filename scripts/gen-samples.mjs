#!/usr/bin/env node
// Generates .dot, .svg, and README.md for every .pfdsl in docs/samples/.
// Run from repo root: node scripts/gen-samples.mjs
// Requires graphviz `dot` CLI to be installed.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

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
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const samplesDir = resolve(root, "docs/samples");

// Import from built dist. @pfdsl/core resolves via packages/graphviz-exporter/node_modules symlink.
const exporterDist = resolve(root, "packages/graphviz-exporter/dist/index.js");
const coreDist = resolve(root, "packages/core/dist/index.js");

const { parse, buildGraph, normalizeDocument } = await import(coreDist);
const { exportDot } = await import(exporterDist);

// --- Generate .dot + .svg ---

const files = readdirSync(samplesDir)
  .filter((f) => f.endsWith(".pfdsl"))
  .sort();

for (const f of files) {
  const src = readFileSync(resolve(samplesDir, f), "utf-8");
  const { document, frontmatter } = parse(src);
  const { edges, nodeKinds } = normalizeDocument(document, frontmatter);
  const graph = buildGraph(edges, nodeKinds);
  const dot = exportDot(graph, frontmatter);

  const base = f.replace(".pfdsl", "");
  const dotPath = resolve(samplesDir, `${base}.dot`);
  const svgPath = resolve(samplesDir, `${base}.svg`);

  writeFileSync(dotPath, dot);
  execSync(`dot -Tsvg "${dotPath}" -o "${svgPath}"`);
  console.log(`${base} → .dot + .svg`);
}

// --- Generate dogfood .dot + .svg ---

const dogfoodBase = resolve(root, "docs/pfdsl_implementation_flow");
const dogfoodSrc = readFileSync(`${dogfoodBase}.pfdsl`, "utf-8");
const { document: dogDoc, frontmatter: dogFm } = parse(dogfoodSrc);
const { edges: dogEdges, nodeKinds: dogKinds } = normalizeDocument(dogDoc, dogFm);
const dogGraph = buildGraph(dogEdges, dogKinds);
const dogDot = exportDot(dogGraph, dogFm);
writeFileSync(`${dogfoodBase}.dot`, dogDot);
execSync(`dot -Tsvg "${dogfoodBase}.dot" -o "${dogfoodBase}.svg"`);
console.log("pfdsl_implementation_flow → .dot + .svg");

// --- Generate README.md from frontmatter ---

const sampleFiles = readdirSync(samplesDir)
  .filter((f) => f.endsWith(".pfdsl"))
  .sort();

let readme = `# PFDSL Samples

Re-generate: \`node scripts/gen-samples.mjs\`

`;

for (const f of sampleFiles) {
  const id = f.replace(".pfdsl", "");
  const src = readFileSync(resolve(samplesDir, f), "utf-8");
  const dot = readFileSync(resolve(samplesDir, `${id}.dot`), "utf-8");
  const fm = parseFrontmatter(src);
  const title = fm.title ?? id;
  const description = fm.description ?? "";
  readme += `## ${id} — ${title}\n\n`;
  if (description) readme += `${description}\n\n`;
  readme += `\`\`\`pfdsl\n${src}\`\`\`\n\n<img src="${id}.svg">\n\n<details>\n<summary>DOT</summary>\n\n\`\`\`dot\n${dot}\`\`\`\n\n</details>\n\n---\n\n`;
}

readme += `## Real-world example

[pfdsl_implementation_flow.pfdsl](../pfdsl_implementation_flow.pfdsl) — the PFDSL toolchain roadmap, written in PFDSL itself.

<img src="../pfdsl_implementation_flow.svg">

[Source](../pfdsl_implementation_flow.pfdsl) · [DOT](../pfdsl_implementation_flow.dot)
`;

writeFileSync(resolve(samplesDir, "README.md"), readme);
console.log("README.md generated");

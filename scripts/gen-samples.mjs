#!/usr/bin/env node
// Generates .dot, .svg, and README.md for every .pfdsl in docs/samples/.
// Run from repo root: node scripts/gen-samples.mjs
// Requires graphviz `dot` CLI to be installed.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
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

// --- Generate README.md from samples.tsv ---

const tsv = readFileSync(resolve(samplesDir, "samples.tsv"), "utf-8");
const rows = tsv
  .trim()
  .split("\n")
  .slice(1) // skip header
  .map((line) => {
    const [id, summary, description] = line.split("\t");
    return { id, summary, description };
  });

let readme = `# PFDSL Samples

Re-generate: \`node scripts/gen-samples.mjs\`

`;

const tsvIds = new Set(rows.map((r) => r.id));
for (const f of readdirSync(samplesDir).filter((f) => f.endsWith(".pfdsl"))) {
  if (!tsvIds.has(f.replace(".pfdsl", ""))) {
    console.warn(`  warn: ${f} exists but has no entry in samples.tsv — will not appear in README`);
  }
}

for (const { id, summary, description } of rows) {
  const pfdslPath = resolve(samplesDir, `${id}.pfdsl`);
  if (!existsSync(pfdslPath)) {
    console.warn(`  warn: ${id}.pfdsl not found, skipping`);
    continue;
  }
  const src = readFileSync(pfdslPath, "utf-8");
  const dot = readFileSync(resolve(samplesDir, `${id}.dot`), "utf-8");
  readme += `## ${id} — ${summary}

${description}

\`\`\`pfdsl
${src}\`\`\`

<img src="${id}.svg">

<details>
<summary>DOT</summary>

\`\`\`dot
${dot}\`\`\`

</details>

---

`;
}

readme += `## Real-world example

[pfdsl_implementation_flow.pfdsl](../pfdsl_implementation_flow.pfdsl) — the PFDSL toolchain roadmap, written in PFDSL itself.

<img src="../pfdsl_implementation_flow.svg">

[Source](../pfdsl_implementation_flow.pfdsl) · [DOT](../pfdsl_implementation_flow.dot)
`;

writeFileSync(resolve(samplesDir, "README.md"), readme);
console.log("README.md generated");

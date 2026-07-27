#!/usr/bin/env node
// Generates .dot, .svg, and README.md for every .pfdsl in docs/samples/.
// Run from repo root: node scripts/gen-samples.mjs
// Renders .svg through @pfdsl/preview-engine's wasm graphviz — deterministic,
// no host `dot` binary required.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReadme } from "./gen-samples-readme.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const samplesDir = resolve(root, "docs/samples");

// Import from built dist. @pfdsl/core resolves via packages/graphviz-exporter/node_modules symlink.
const exporterDist = resolve(root, "packages/graphviz-exporter/dist/index.js");
const coreDist = resolve(root, "packages/core/dist/index.js");
const previewEngineDist = resolve(root, "packages/preview-engine/dist/index.js");

const { parse, buildGraph, normalizeDocument } = await import(coreDist);
const { exportDot } = await import(exporterDist);
const { renderDotToSvg } = await import(previewEngineDist);

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
  writeFileSync(svgPath, await renderDotToSvg(dot));
  console.log(`${base} → .dot + .svg`);
}

// --- Generate README.md from samples.tsv ---

writeFileSync(resolve(samplesDir, "README.md"), buildReadme(samplesDir));
console.log("README.md generated");

# @pfdsl/preview-engine

Renders [PFDSL](https://github.com/takasek/pfdsl) diagrams to SVG for preview and export.

## Requirements

Node.js ≥ 18 (ESM only).

## API

```ts
import { renderGraph, renderDiff, renderDotToSvg } from "@pfdsl/preview-engine";

// Render a graph to SVG
const svg = await renderGraph(graph, frontmatter, options);

// Render a diff to SVG
const svg = await renderDiff(graph, frontmatter, options);

// Render a raw DOT string to SVG
const svg = await renderDotToSvg(dot);
```

See [`RenderOptions`](src/index.ts) for available options (extends `ExportOptions` from `@pfdsl/graphviz-exporter`).

# @pfdsl/graphviz-exporter

Renders [PFDSL](https://github.com/takasek/pfdsl) graphs to DOT / SVG / PDF / PNG.

## Requirements

Node.js ≥ 18 (ESM only).

## API

```ts
import { exportDot, exportDiffDot, svgToBinary } from "@pfdsl/graphviz-exporter";

// Render a graph as a DOT string
const dot = exportDot(graph, frontmatter, options);

// Render a diff as a DOT string
const dot = exportDiffDot(graph, frontmatter, options);

// Convert an SVG string to PDF or PNG (requires @hpcc-js/wasm)
const pdf = await svgToBinary(svgString, "pdf");
```

See [`ExportOptions`](src/index.ts) for available options.

# @pfdsl/metadata-exporter

Extracts structured metadata from [PFDSL](https://github.com/takasek/pfdsl) graphs.

## Requirements

Node.js ≥ 18 (ESM only).

## API

```ts
import { extractMetadata, toTsv } from "@pfdsl/metadata-exporter";

// Extract metadata records from a graph and its frontmatter
const records = extractMetadata(graph, frontmatter);

// Serialize records as TSV
const tsv = toTsv(records);
```

Each `MetadataRecord` contains `kind`, `id`, `label`, `status`, `description`, `criteria`, and `location`.

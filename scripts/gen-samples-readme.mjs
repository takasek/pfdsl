// Builds the docs/samples/README.md content from samples.tsv + generated .dot files.
// Shared by scripts/gen-samples.mjs (writes the file) and the vitest drift guard
// (compares this output against the committed file) so the two never diverge.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function buildReadme(samplesDir) {
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

    if (id === "pfdsl_implementation_flow") {
      readme += `## ${id} — ${summary}

${description}

<img src="${id}.svg">

[Source](${id}.pfdsl) · [DOT](${id}.dot)

---

`;
      continue;
    }

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

  return readme;
}

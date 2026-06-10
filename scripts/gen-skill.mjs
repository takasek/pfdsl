#!/usr/bin/env node
// Generates the pfdsl Claude skill to a target directory.
// Run: node scripts/gen-skill.mjs --out .claude/skills/pfdsl
// The --out path must contain '.claude/' (safety check).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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

// --- 1. Copy spec ---

const specSrc = readFileSync(resolve(root, "docs/spec/spec.md"), "utf-8");
const specVersion = specSrc.match(/^# PFDSL仕様書 (v[\d.]+)/m)?.[1] ?? "unknown";
writeFileSync(resolve(refsDir, "spec.md"), specSrc);
console.log("references/spec.md ← docs/spec/spec.md");

// --- 2. Generate samples.md ---

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
console.log(`references/samples.md ← docs/samples/*.pfdsl (${sampleCount} samples)`);

// --- 3. Write SKILL.md ---

const skillMd = `---
name: pfdsl
description: |
  Use when working with .pfdsl (Process Flow DSL) files — reading, writing,
  editing, or validating them. Always invoke before touching any .pfdsl file,
  running pfdsl CLI tools, updating artifact status (done/wip/todo/blocked),
  adding artifacts or processes, or interpreting flow diagrams. Especially
  use for docs/pfdsl_implementation_flow.pfdsl status updates.
---

## Syntax

- \`A >> P\` — Artifact A as normal input to Process P
- \`A >>? P\` — Artifact A as feedback input to Process P (dashed edge, no rank effect)
- \`P -> B\` — Process P outputs Artifact B
- Chain: \`A >> P -> B >> Q -> C\`
- **Multiple inputs — always use set notation**: \`[a, b] >> P\` (preferred over two separate \`a >> P\` / \`b >> P\` lines)
- Multiple outputs: \`P -> [a, b]\`

**ID type inference** (no explicit declaration needed in body):
- Left of \`>>\` / \`>>?\` → Artifact; right → Process
- Left of \`->\` → Process; right → Artifact
- Frontmatter \`artifact:\` / \`process:\` declarations override

**Continuation**: operator at *start* of next line continues the statement. Blank line terminates.

## Frontmatter structure

\`\`\`yaml
title: ...
layout:
  direction: LR   # LR | RL | TB | BT (default LR)
  maxWidth: 120   # label wrap width in px (optional)

artifact:
  <id>:
    label: 人間向けラベル
    status: done       # done | wip | todo | blocked
    description: ...
    owner: ...
    tags: [tag1, tag2]
    group: <group-id>
    parts: [sub-artifact-id, ...]

process:
  <id>:
    label: ...
    description: ...
    owner: ...
    group: <group-id>

group:
  <id>:
    label: ...
    color: "#f0f0f0"

statusStyles:
  done:    { fillcolor: "#d4edda", style: filled }
  wip:     { fillcolor: "#fff3cd", style: filled }
  todo:    { fillcolor: "#f8f9fa", style: filled }
  blocked: { fillcolor: "#f8d7da", style: filled }
\`\`\`

## CLI

Build first if needed: \`make build-deps\`

\`\`\`bash
node packages/cli/dist/cli.js check <file>
node packages/cli/dist/cli.js fmt <file> [--write] [--mode flat|flows]
node packages/cli/dist/cli.js normalize <file>
node packages/cli/dist/cli.js graph <file> [--format dot|svg]
node packages/cli/dist/cli.js diff <file-a> <file-b>
\`\`\`

## Key constraints

- **V001 single-producer**: each artifact has at most one producing process (\`->\`)
- **V002 process needs inputs**: every non-isolated process needs ≥1 input (\`>>\`)
- **V003 process needs outputs**: every non-isolated process needs ≥1 output (\`->\`)

## Writing quality PFDs

PFD はタスクリストではなく成果物の変換グラフ。

- **最終成果物から遡って書く**: 前から並べる(push)と無意味な成果物・孤立プロセスが混入する
- **プロセス分割は依存で決める**: 時間的凝集で束ねない（束ねた全入力が全出力をゲートする偽依存）。分けても境界をまたぐ新依存が出ないなら割らない
- **命名**: プロセスは変換が見える動詞句（「設計」「査読」。「対応」「作業」不可）、成果物は名詞。ID は短い英語スネーク、表示名は label
- **抽象度を統一**: 「システム開発」と「変数リネーム」を並べない。肥大したら別ファイルへ
- **出力は検証可能な「モノ」**: 「理解」「合意」は理解資料・議事録・承認記録に外化。副次物（リリースノート）だけでなく主産物も出力する
- **入力は全て明示**: 暗黙依存禁止（例: 差分実装に base_code）。「レビュアー知識」等の不定形もフロー外リソースなら入力可。フロー内で生成するなら文書化
- **可変リソースはスナップショット化**: DB・本番環境は「日次ダンプ」「リリース版」等の時点固定 artifact に（単一生成元・DAG と衝突するため）
- **改版は1パターン**: フェーズ境界（承認・配布されるベースライン）なら別 artifact、同一フェーズ内の収束なら \`指摘 >>? 元プロセス\`。併用は二重表現
- **Primary graph は DAG に**: 循環は \`>>\` で書かず \`>>?\` か改版 artifact で（\`check\` は循環を検出しない）
- **生成者の整合**: プロセスは自分が作るものだけ出力（面接が応募者の提出物を生成しない）。description と graph も一致させる
- **parts メンバーもエッジ参加**: \`[ch1, ch2] >> merge -> book\`（spec §17.4）。エッジ無しは図上で孤立ノード化
- **組織学習パターン**: 観点表をレビュー入力に、指摘から \`>>?\` で観点表整備へ還流（samples 11-practical-web-dev）
- **点検**: \`check\` と \`graph --format dot\` を実行し、終端成果物が全て意図した納品物か確認

## Typical task: update status in implementation_flow.pfdsl

1. Find the artifact ID in \`docs/pfdsl_implementation_flow.pfdsl\` frontmatter \`artifact:\` section
2. Change \`status: todo\` → \`status: done\` (or \`wip\`, \`blocked\`)
3. Validate: \`node packages/cli/dist/cli.js check docs/pfdsl_implementation_flow.pfdsl\`

## References

Read these when deeper detail is needed:

- \`references/spec.md\` — full PFDSL spec ${specVersion} (syntax rules, grammar, all frontmatter fields)
- \`references/samples.md\` — annotated .pfdsl examples showing each language feature

---
*Generated by \`scripts/gen-skill.mjs\`. Re-run \`make gen-skill\` to update.*
`;

writeFileSync(resolve(outDir, "SKILL.md"), skillMd);
console.log("SKILL.md → generated");

console.log(`\nSkill written to: ${outDir}`);

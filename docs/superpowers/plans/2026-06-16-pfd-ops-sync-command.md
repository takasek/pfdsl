# pfd-ops Sync Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npx @pfdsl/cli@latest skill sync pfd-ops` で外部採用リポの pfd-ops スキルを一発最新化できるようにする。汎用層（SKILL.md/references）は無条件上書き、`install/`（L3機構）は採用済みリポのみ上書き、L4ファイル（roadmap/ecosystem の `.pfdsl`/`.md`）は欠落時のみ雛形生成する。

**Architecture:** ビルド時に `.claude/skills/pfd-ops/` ツリーを `packages/cli/dist/skills/pfd-ops/` へ postbuild コピーし npm に同梱する。新設の `packages/cli/src/skill-sync.ts` が「コピー対象解決 → 採用済み判定 → 汎用層上書き → install/ 条件付き上書き → L4 scaffold → gh ラベル確認」を行う純粋関数群を提供し、`index.ts` の `run()` ディスパッチが `skill sync pfd-ops` をこれに繋ぐ。

**Tech Stack:** TypeScript, tsup（postbuild hook）, vitest, Node `node:fs`/`node:child_process`, GitHub CLI (`gh`)

---

### Task 1: postbuild で `.claude/skills/pfd-ops/` を dist に同梱する

**Files:**
- Modify: `packages/cli/tsup.config.ts`
- Modify: `packages/cli/package.json` (`scripts.build`)
- Test (手動確認、Step 4): `packages/cli/dist/skills/pfd-ops/`

tsup の `onSuccess` フックでコピーする（別 npm script を `&&` で繋ぐ方式ではなく）。理由: tsup はビルド成功時のみ `onSuccess` を呼ぶため、ビルド失敗時に古い skills ツリーが dist に残る/コピーだけ走るレースを避けられ、`package.json` の `scripts.build` は `"build": "tsup"` のまま変更不要。

- [ ] **Step 1: tsup.config.ts に onSuccess フックを追加**

`packages/cli/tsup.config.ts` を編集:

```typescript
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/cli.ts"],
	format: ["esm"],
	dts: { entry: ["src/index.ts"] },
	noExternal: [/^@pfdsl\//],
	external: ["@hpcc-js/wasm"],
	banner: {
		// noExternal pulls in transitive CJS deps (e.g. yaml, which ships no
		// node ESM build); esbuild's ESM output needs a real require for them.
		js: 'import { createRequire as __pfdslCreateRequire } from "node:module"; const require = __pfdslCreateRequire(import.meta.url);',
	},
	onSuccess: async () => {
		const repoRoot = resolve(__dirname, "../..");
		const src = resolve(repoRoot, ".claude/skills/pfd-ops");
		const dest = resolve(__dirname, "dist/skills/pfd-ops");
		if (!existsSync(src)) {
			throw new Error(`pfd-ops skill source not found at ${src}`);
		}
		mkdirSync(dest, { recursive: true });
		cpSync(src, dest, { recursive: true });
	},
});
```

- [ ] **Step 2: ビルドを実行**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/cli build
```

Expected: tsup の通常ビルド出力に続き、エラーなく終了する（onSuccess は標準出力に何も出さない）。

- [ ] **Step 3: dist 配下に同梱されたことを確認**

```bash
find packages/cli/dist/skills/pfd-ops -type f | sort
```

Expected:
```
packages/cli/dist/skills/pfd-ops/SKILL.md
packages/cli/dist/skills/pfd-ops/install/.github/workflows/check-pfd-ops-sync.yml
packages/cli/dist/skills/pfd-ops/install/.github/workflows/flow-on-issue-close.yml
packages/cli/dist/skills/pfd-ops/install/scripts/audit-issues-flow.mjs
packages/cli/dist/skills/pfd-ops/install/scripts/lib/issues-flow-audit.mjs
packages/cli/dist/skills/pfd-ops/install/scripts/lib/yaml-require.mjs
packages/cli/dist/skills/pfd-ops/references/github-issues-backend.md
```
（Task 4 で `references/scaffold/*` と `references/ecosystem-setup-prompt.md` を追加するまではこの7ファイルのみ。)

- [ ] **Step 4: `npm pack` で配布物に含まれることを確認**

```bash
cd packages/cli && npm pack --dry-run 2>&1 | grep "dist/skills/pfd-ops"
```

Expected: `dist/skills/pfd-ops/SKILL.md` 等、7行が一覧に出力される（`files: ["dist"]` により自動同梱されることの確認。`package.json` 自体の変更は不要）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/tsup.config.ts
git commit -m "feat(cli): bundle .claude/skills/pfd-ops into dist via tsup onSuccess hook"
```

---

### Task 2: `skill-sync.ts` — コピー対象解決（dist skill root の解決）

**Files:**
- Create: `packages/cli/src/skill-sync.ts`
- Create: `packages/cli/src/skill-sync.test.ts`

CLI 実行時（`dist/cli.js` から動かす本番経路）と、テスト実行時（`src/` から動かし `dist/` が無いかビルド前）の両方で同梱ツリーを見つけられるようにする。本番は `dist/skills/pfd-ops`、テスト/ソース実行時は `packages/cli/.claude-skill-source` という固定の `import.meta.url` 相対パスから、リポルートの `.claude/skills/pfd-ops` にフォールバックする。

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` を新規作成:

```typescript
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveSkillRoot } from "./skill-sync.js";

describe("resolveSkillRoot", () => {
	it("resolves to a directory containing SKILL.md", () => {
		const root = resolveSkillRoot();
		expect(existsSync(`${root}/SKILL.md`)).toBe(true);
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Cannot find module './skill-sync.js'` または `Failed to resolve import` エラーで FAIL。

- [ ] **Step 3: 最小実装を書く**

`packages/cli/src/skill-sync.ts` を新規作成:

```typescript
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolves the directory containing the bundled pfd-ops skill tree
 * (SKILL.md, references/, install/).
 *
 * Production: this file runs from `dist/skill-sync.js`, and the skill tree
 * is bundled as a sibling at `dist/skills/pfd-ops` (see tsup.config.ts
 * onSuccess hook).
 *
 * Source/test execution: this file runs from `packages/cli/src/`, where
 * `dist/skills/pfd-ops` may not exist yet (pre-build). Fall back to the
 * repo's canonical `.claude/skills/pfd-ops`, four levels up from `src/`.
 */
export function resolveSkillRoot(): string {
	const distCandidate = resolve(__dirname, "skills/pfd-ops");
	if (existsSync(distCandidate)) return distCandidate;

	const sourceCandidate = resolve(
		__dirname,
		"../../../.claude/skills/pfd-ops",
	);
	if (existsSync(sourceCandidate)) return sourceCandidate;

	throw new Error(
		`pfd-ops skill tree not found at ${distCandidate} or ${sourceCandidate}`,
	);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 1 passed (1)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): resolve bundled pfd-ops skill root with source fallback"
```

---

### Task 3: 汎用層（SKILL.md + references/）の無条件上書きコピー

**Files:**
- Modify: `packages/cli/src/skill-sync.ts`
- Modify: `packages/cli/src/skill-sync.test.ts`

`references/` には Task 4 で追加する `scaffold/` サブディレクトリも含まれる。汎用層コピーは「`install/` を除いた skill ルート全体」を再帰コピーすることで、`scaffold/` や `ecosystem-setup-prompt.md` も自動的に運ばれる。

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` に追記:

```typescript
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { copyGeneralLayer, resolveSkillRoot } from "./skill-sync.js";

describe("copyGeneralLayer", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("copies SKILL.md and references/ unconditionally, excluding install/", () => {
		const skillRoot = resolveSkillRoot();
		copyGeneralLayer(skillRoot, targetRoot);

		const skillMd = readFileSync(
			join(targetRoot, ".claude/skills/pfd-ops/SKILL.md"),
			"utf-8",
		);
		expect(skillMd).toContain("name: pfd-ops");

		const ref = readFileSync(
			join(
				targetRoot,
				".claude/skills/pfd-ops/references/github-issues-backend.md",
			),
			"utf-8",
		);
		expect(ref).toContain("GitHub Issues バックエンド");

		expect(
			existsSync(join(targetRoot, ".claude/skills/pfd-ops/install")),
		).toBe(false);
	});
});
```

`existsSync` を import 文に追加する必要がある（既存の `import { existsSync } from "node:fs";` を `import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";` にまとめる）。

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `copyGeneralLayer is not a function` で FAIL。

- [ ] **Step 3: 実装を追加**

`packages/cli/src/skill-sync.ts` に追記:

```typescript
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ... (resolveSkillRoot は既存のまま) ...

/**
 * Copies the general layer (SKILL.md + references/*) from the bundled skill
 * root into `<targetRoot>/.claude/skills/pfd-ops/`, unconditionally
 * overwriting. The install/ subtree is excluded — its copy is conditional
 * on L3 adoption (see copyInstallLayer in Task 5).
 */
export function copyGeneralLayer(skillRoot: string, targetRoot: string): void {
	const dest = join(targetRoot, ".claude/skills/pfd-ops");
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(skillRoot)) {
		if (entry === "install") continue;
		cpSync(join(skillRoot, entry), join(dest, entry), { recursive: true });
	}
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 2 passed (2)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): copy pfd-ops general layer (SKILL.md + references) unconditionally"
```

---

### Task 4: scaffold テンプレート + ecosystem 構築プロンプトを `references/` に追加

**Files:**
- Create: `.claude/skills/pfd-ops/references/scaffold/ecosystem.pfdsl`
- Create: `.claude/skills/pfd-ops/references/scaffold/ecosystem.md`
- Create: `.claude/skills/pfd-ops/references/scaffold/roadmap.pfdsl`
- Create: `.claude/skills/pfd-ops/references/scaffold/roadmap.md`
- Create: `.claude/skills/pfd-ops/references/ecosystem-setup-prompt.md`

これらは dist 同梱経路（`references/`）に置くことで Task 3 の `copyGeneralLayer` が自動的に運ぶ。`.pfdsl` テンプレートは `pfdsl check` を通る最小グラフにする必要がある（`analyze()` の completeness 検証: 全 process は最低1出力を持つこと）。

- [ ] **Step 1: scaffold ディレクトリを作成し roadmap.pfdsl を書く**

```bash
mkdir -p /Users/m5/works/pfdsl/.claude/skills/pfd-ops/references/scaffold
```

`.claude/skills/pfd-ops/references/scaffold/roadmap.pfdsl`:

```
---
title: Issue 依存フロー
description: オープン issue の依存関係と着手可能順序。issue 本体が一次情報、本ファイルは依存構造のみ管理。詳細は sibling roadmap.md 参照。

statusStyles:
  done: { fillcolor: "#d4edda", style: filled }
  wip: { fillcolor: "#fff3cd", style: filled }
  todo: { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }

artifact:
  seed:
    label: (このプロジェクトの最初の入力 artifact に置き換える)
    status: done
  first_milestone:
    label: (最初のマイルストーンに置き換える)
    status: todo

process:
  start_work:
    label: (最初の作業プロセスに置き換える)
---

seed >> start_work -> first_milestone
```

- [ ] **Step 2: roadmap.md を書く**

`.claude/skills/pfd-ops/references/scaffold/roadmap.md`:

```markdown
# roadmap.md — issue 管理バインディング（roadmap.pfdsl の companion）

`roadmap.pfdsl` は issue 依存構造のみ管理する。issue の一次情報と同期手段はここに書く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## バックエンド

(採用するバックエンドを記載する。GitHub Issues を使う場合は `.claude/skills/pfd-ops/references/github-issues-backend.md` を参照。)

## このリポのインスタンス値

- 一次情報: (issue 管理先の URL)
- 同期監査スクリプト: (採用する場合は `scripts/audit-issues-flow.mjs` のパス)
- 監査対象: (このファイルが対応する `.pfdsl` のパス)

## 運用対象の計画 PFD

ワークサイクルの選択ステップが列挙する対象:

- (このファイルが対応する `.pfdsl` のパス)

## 自動生成 PR（ワークサイクル選択前に確認）

(issue close 等で自動生成される PR がある場合はここに記載する。なければ「なし」と明記する。)

## 終端ゲート追加項目（issue 固有）

(汎用ゲートに加えて、このプロジェクト固有に確認すべき項目を記載する。)
```

- [ ] **Step 3: ecosystem.pfdsl を書く**

`.claude/skills/pfd-ops/references/scaffold/ecosystem.pfdsl`:

```
---
title: リポジトリ成果物の生態系
description: 各成果物の生成元と利用局面を明示し、形骸化（消費者のない成果物）を構造的に検出可能にする。新しい知識成果物を追加する際は本図に消費者を書けることを確認する。

statusStyles:
  done: { fillcolor: "#d4edda", style: filled }
  wip: { fillcolor: "#fff3cd", style: filled }
  todo: { fillcolor: "#f8f9fa", style: filled }
  waiting: { fillcolor: "#f8d7da", style: filled }
  suspended: { fillcolor: "#e2e3e5", style: filled }

artifact:
  seed_input:
    label: (このプロジェクトの最初の入力に置き換える)
    status: done
  first_output:
    label: (最初の成果物に置き換える)
    status: todo

process:
  first_process:
    label: (最初のプロセスに置き換える)
---

seed_input >> first_process -> first_output
```

- [ ] **Step 4: ecosystem.md を書く**

`.claude/skills/pfd-ops/references/scaffold/ecosystem.md`:

```markdown
# ecosystem.md — 運用手続き（ecosystem.pfdsl の companion）

`ecosystem.pfdsl` のグラフが運べない、複数ノードをまたぐ運用手続きをここに置く。pfd-ops skill の L2 ディスパッチがこのファイルを参照する。

## 知見の振り分け

(実践・レビューで得た知見をどこに記録するか、経路を記載する。)

## 学習ループ

(実践→レビュー→改善のサイクルがある場合はここに記載する。)

## 終端ゲートの根拠

(汎用ゲート項目に加えて、このプロジェクト固有に確認すべき終端条件の根拠を記載する。)
```

- [ ] **Step 5: ecosystem-setup-prompt.md を書く**

`.claude/skills/pfd-ops/references/ecosystem-setup-prompt.md`:

```markdown
# ecosystem.pfdsl 構築プロンプト

以下をそのままこのプロジェクトの Claude に渡してください:

---

このプロジェクトの `ecosystem.pfdsl` と `ecosystem.md` は雛形（scaffold）のままです。プロジェクト全体を読んで、実際の生態系グラフに育ててください。

1. リポジトリ内の成果物（spec・skill・examples・ADR・issue・roadmap 等、種類を問わない）を洗い出す
2. 各成果物について、それを生成するプロセス（producer）と、それを使うプロセス（consumer）を特定する
3. **消費者を書けない成果物は ecosystem.pfdsl に載せない**（終端監査 — pfd-ops スキルの運用プロトコル参照）
4. artifact/process を `ecosystem.pfdsl` の frontmatter に追記し、`>>`/`->` のフローエッジで producer→artifact→consumer の関係を記述する
5. グラフだけで表現しきれない運用手続き（知見の振り分け先・学習ループ・終端ゲートの根拠など）は `ecosystem.md` に文章で書く
6. 完成したら `pfdsl check ecosystem.pfdsl` を通すこと

雛形の `seed_input` / `first_process` / `first_output` は実際のノード名・実際の成果物名に置き換えてください（プレースホルダのまま残さない）。

---
```

- [ ] **Step 6: 4つの scaffold .pfdsl が `pfdsl check` を通ることを確認**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/cli build
node packages/cli/dist/cli.js check .claude/skills/pfd-ops/references/scaffold/roadmap.pfdsl
node packages/cli/dist/cli.js check .claude/skills/pfd-ops/references/scaffold/ecosystem.pfdsl
```

Expected: 両方とも `OK` を stdout に出し、exit code 0。

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/pfd-ops/references/scaffold .claude/skills/pfd-ops/references/ecosystem-setup-prompt.md
git commit -m "feat(pfd-ops): add L4 scaffold templates and ecosystem-setup prompt"
```

---

### Task 5: 採用済み判定（L3 adoption detection）

**Files:**
- Modify: `packages/cli/src/skill-sync.ts`
- Modify: `packages/cli/src/skill-sync.test.ts`

判定基準: `install/` 由来の deployed ファイルが一つでもリポルートに存在すれば採用済み。`install/` 配下ファイルのリストは同梱ツリーから動的に walk して導出する（ハードコードしない — install/ にファイルが増えても自動追従する）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` に追記:

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { isL3Adopted, resolveSkillRoot } from "./skill-sync.js";

describe("isL3Adopted", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("returns false when no install/-derived file exists at target root", () => {
		const skillRoot = resolveSkillRoot();
		expect(isL3Adopted(skillRoot, targetRoot)).toBe(false);
	});

	it("returns true when at least one install/-derived file exists", () => {
		const skillRoot = resolveSkillRoot();
		mkdirSync(join(targetRoot, "scripts/lib"), { recursive: true });
		writeFileSync(
			join(targetRoot, "scripts/lib/yaml-require.mjs"),
			"// deployed copy\n",
		);
		expect(isL3Adopted(skillRoot, targetRoot)).toBe(true);
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `isL3Adopted is not a function` で FAIL。

- [ ] **Step 3: 実装を追加**

`packages/cli/src/skill-sync.ts` に追記:

```typescript
import { existsSync, readdirSync, statSync } from "node:fs";

/**
 * Recursively lists all file paths under `dir`, relative to `dir`,
 * using forward-slash separators (matches install/ tree's repo-root-relative
 * layout, e.g. ".github/workflows/check-pfd-ops-sync.yml").
 */
function listFilesRecursive(dir: string, prefix = ""): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const abs = join(dir, entry);
		const rel = prefix ? `${prefix}/${entry}` : entry;
		if (statSync(abs).isDirectory()) {
			out.push(...listFilesRecursive(abs, rel));
		} else {
			out.push(rel);
		}
	}
	return out;
}

/**
 * Returns the list of relative paths that install/ deploys to repo root,
 * derived dynamically from the bundled install/ tree (not hardcoded).
 */
export function listInstallFiles(skillRoot: string): string[] {
	const installDir = join(skillRoot, "install");
	if (!existsSync(installDir)) return [];
	return listFilesRecursive(installDir);
}

/**
 * L3 (GitHub Issues backend / install/ mechanism) is considered adopted if
 * any install/-derived file already exists at the target repo root.
 * Adoption is all-or-nothing (cp -r install/. .), so a single hit is enough.
 */
export function isL3Adopted(skillRoot: string, targetRoot: string): boolean {
	return listInstallFiles(skillRoot).some((rel) =>
		existsSync(join(targetRoot, rel)),
	);
}
```

`node:path` の import に `join` が既にあることを確認（Task 3 で追加済み）。

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 4 passed (4)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): detect L3 (install/) adoption by checking deployed files at target root"
```

---

### Task 6: install/ レイヤーの条件付き上書きコピー + 未採用時の案内メッセージ

**Files:**
- Modify: `packages/cli/src/skill-sync.ts`
- Modify: `packages/cli/src/skill-sync.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` に追記:

```typescript
import { copyInstallLayer } from "./skill-sync.js";

describe("copyInstallLayer", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("copies install/ tree to target root when adopted", () => {
		const skillRoot = resolveSkillRoot();
		// simulate prior adoption
		mkdirSync(join(targetRoot, "scripts/lib"), { recursive: true });
		writeFileSync(join(targetRoot, "scripts/lib/yaml-require.mjs"), "old\n");

		const result = copyInstallLayer(skillRoot, targetRoot);

		expect(result.copied).toBe(true);
		const updated = readFileSync(
			join(targetRoot, "scripts/lib/yaml-require.mjs"),
			"utf-8",
		);
		expect(updated).not.toBe("old\n");
		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(true);
	});

	it("does not copy and returns guidance message when not adopted", () => {
		const skillRoot = resolveSkillRoot();
		const result = copyInstallLayer(skillRoot, targetRoot);

		expect(result.copied).toBe(false);
		expect(result.message).toContain(
			"cp -r .claude/skills/pfd-ops/install/. .",
		);
		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(false);
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `copyInstallLayer is not a function` で FAIL。

- [ ] **Step 3: 実装を追加**

`packages/cli/src/skill-sync.ts` に追記:

```typescript
export interface InstallCopyResult {
	copied: boolean;
	message: string;
}

/**
 * Copies install/ (L3 mechanism: workflows, audit scripts) to target root,
 * preserving relative paths, but only when L3 is already adopted there.
 * When not adopted, copies nothing and returns guidance for first-time
 * adoption (out of scope for sync itself — see design doc YAGNI section).
 */
export function copyInstallLayer(
	skillRoot: string,
	targetRoot: string,
): InstallCopyResult {
	if (!isL3Adopted(skillRoot, targetRoot)) {
		return {
			copied: false,
			message:
				"GitHub Issues バックエンド (L3) は未採用です。採用する場合は次を実行してください:\n" +
				"  cp -r .claude/skills/pfd-ops/install/. .\n",
		};
	}
	const installDir = join(skillRoot, "install");
	for (const rel of listInstallFiles(skillRoot)) {
		const src = join(installDir, rel);
		const dest = join(targetRoot, rel);
		mkdirSync(dirname(dest), { recursive: true });
		cpSync(src, dest);
	}
	return { copied: true, message: "" };
}
```

`dirname` を `node:path` の import に追加する。

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 6 passed (6)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): copy install/ layer when L3-adopted, else print cp -r guidance"
```

---

### Task 7: L4 ファイル scaffold（欠落時のみ生成、既存は不触）

**Files:**
- Modify: `packages/cli/src/skill-sync.ts`
- Modify: `packages/cli/src/skill-sync.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` に追記:

```typescript
import { scaffoldL4Files } from "./skill-sync.js";

describe("scaffoldL4Files", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("creates all 4 files under .pfdsl/ when none exist", () => {
		const skillRoot = resolveSkillRoot();
		const result = scaffoldL4Files(skillRoot, targetRoot);

		expect(result.scaffolded.sort()).toEqual(
			["ecosystem.md", "ecosystem.pfdsl", "roadmap.md", "roadmap.pfdsl"].sort(),
		);
		const roadmap = readFileSync(
			join(targetRoot, ".pfdsl/roadmap.pfdsl"),
			"utf-8",
		);
		expect(roadmap).toContain("seed");
	});

	it("does not touch a file that already exists", () => {
		const skillRoot = resolveSkillRoot();
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		writeFileSync(
			join(targetRoot, ".pfdsl/roadmap.pfdsl"),
			"# pre-existing custom content\n",
		);

		const result = scaffoldL4Files(skillRoot, targetRoot);

		expect(result.scaffolded).not.toContain("roadmap.pfdsl");
		expect(result.scaffolded.sort()).toEqual(
			["ecosystem.md", "ecosystem.pfdsl", "roadmap.md"].sort(),
		);
		const untouched = readFileSync(
			join(targetRoot, ".pfdsl/roadmap.pfdsl"),
			"utf-8",
		);
		expect(untouched).toBe("# pre-existing custom content\n");
	});

	it("returns empty scaffolded list when all 4 files already exist", () => {
		const skillRoot = resolveSkillRoot();
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		for (const f of [
			"roadmap.pfdsl",
			"roadmap.md",
			"ecosystem.pfdsl",
			"ecosystem.md",
		]) {
			writeFileSync(join(targetRoot, ".pfdsl", f), "existing\n");
		}

		const result = scaffoldL4Files(skillRoot, targetRoot);
		expect(result.scaffolded).toEqual([]);
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `scaffoldL4Files is not a function` で FAIL。

- [ ] **Step 3: 実装を追加**

`packages/cli/src/skill-sync.ts` に追記:

```typescript
const L4_FILES = [
	"roadmap.pfdsl",
	"roadmap.md",
	"ecosystem.pfdsl",
	"ecosystem.md",
] as const;

export interface ScaffoldResult {
	scaffolded: string[];
}

/**
 * Scaffolds the 4 L4 files (.pfdsl/{roadmap,ecosystem}.{pfdsl,md}) at target
 * root, one at a time, only when each is individually missing. Existing
 * files are never touched (idempotent, no overwrite — see design doc
 * "scaffold" section).
 */
export function scaffoldL4Files(
	skillRoot: string,
	targetRoot: string,
): ScaffoldResult {
	const scaffolded: string[] = [];
	const targetDir = join(targetRoot, ".pfdsl");
	const templateDir = join(skillRoot, "references/scaffold");
	mkdirSync(targetDir, { recursive: true });
	for (const file of L4_FILES) {
		const dest = join(targetDir, file);
		if (existsSync(dest)) continue;
		cpSync(join(templateDir, file), dest);
		scaffolded.push(file);
	}
	return { scaffolded };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 9 passed (9)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): scaffold missing L4 files (.pfdsl/{roadmap,ecosystem}.{pfdsl,md})"
```

---

### Task 8: ecosystem 構築プロンプトの表示条件

**Files:**
- Modify: `packages/cli/src/skill-sync.ts`
- Modify: `packages/cli/src/skill-sync.test.ts`

scaffold で1ファイルでも新規生成した場合のみ、dist 同梱の `references/ecosystem-setup-prompt.md` を読んで返す。全て既存だった場合は空文字（呼び出し側はそのときは表示しない）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` に追記:

```typescript
import { ecosystemSetupPrompt } from "./skill-sync.js";

describe("ecosystemSetupPrompt", () => {
	it("returns the prompt content when scaffolded list is non-empty", () => {
		const skillRoot = resolveSkillRoot();
		const prompt = ecosystemSetupPrompt(skillRoot, ["roadmap.pfdsl"]);
		expect(prompt).toContain("ecosystem.pfdsl 構築プロンプト");
	});

	it("returns empty string when scaffolded list is empty", () => {
		const skillRoot = resolveSkillRoot();
		const prompt = ecosystemSetupPrompt(skillRoot, []);
		expect(prompt).toBe("");
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `ecosystemSetupPrompt is not a function` で FAIL。

- [ ] **Step 3: 実装を追加**

`packages/cli/src/skill-sync.ts` に追記:

```typescript
import { readFileSync } from "node:fs";

/**
 * Returns the ecosystem-setup prompt content (read from the bundled
 * reference template) when at least one L4 file was scaffolded this run.
 * Returns "" when nothing was scaffolded (all L4 files already grown —
 * avoid noise per design doc).
 */
export function ecosystemSetupPrompt(
	skillRoot: string,
	scaffolded: string[],
): string {
	if (scaffolded.length === 0) return "";
	return readFileSync(
		join(skillRoot, "references/ecosystem-setup-prompt.md"),
		"utf-8",
	);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 11 passed (11)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): print ecosystem-setup prompt only when L4 files were scaffolded"
```

---

### Task 9: gh ラベル確認（gh 未検出時の案内、検出時の `[y/N]` 確認）

**Files:**
- Modify: `packages/cli/src/skill-sync.ts`
- Modify: `packages/cli/src/skill-sync.test.ts`

`gh` 呼び出しと標準入力をテストでモックできるよう、依存を関数引数として注入する設計にする（`execGh` と `confirm` をオプション引数で渡せるようにし、デフォルトは実行環境の `gh` / stdin）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` に追記:

```typescript
import { ensureLabels } from "./skill-sync.js";

describe("ensureLabels", () => {
	it("returns guidance and does nothing when gh is not found", async () => {
		const execGh = () => {
			throw Object.assign(new Error("not found"), { code: "ENOENT" });
		};
		const result = await ensureLabels({ execGh, yes: false });
		expect(result.message).toContain("flow:managed");
		expect(result.message).toContain("flow:exempt");
		expect(result.message).toContain("手動");
		expect(result.created).toEqual([]);
	});

	it("skips when no labels are missing", async () => {
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") {
				return "flow:managed\tcolor\tdesc\nflow:exempt\tcolor\tdesc\n";
			}
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const result = await ensureLabels({ execGh, yes: false });
		expect(result.created).toEqual([]);
	});

	it("creates missing labels with --yes (no prompt)", async () => {
		const created: string[] = [];
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") return "";
			if (args[0] === "label" && args[1] === "create") {
				created.push(args[2]!);
				return "";
			}
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const result = await ensureLabels({ execGh, yes: true });
		expect(result.created.sort()).toEqual(["flow:exempt", "flow:managed"]);
		expect(created.sort()).toEqual(["flow:exempt", "flow:managed"]);
	});

	it("prompts and skips creation when answer is not y", async () => {
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") return "";
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const confirm = async () => false;
		const result = await ensureLabels({ execGh, yes: false, confirm });
		expect(result.created).toEqual([]);
	});

	it("prompts and creates when answer is y", async () => {
		const created: string[] = [];
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") return "";
			if (args[0] === "label" && args[1] === "create") {
				created.push(args[2]!);
				return "";
			}
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const confirm = async () => true;
		const result = await ensureLabels({ execGh, yes: false, confirm });
		expect(result.created.sort()).toEqual(["flow:exempt", "flow:managed"]);
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `ensureLabels is not a function` で FAIL。

- [ ] **Step 3: 実装を追加**

`packages/cli/src/skill-sync.ts` に追記:

```typescript
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const REQUIRED_LABELS = ["flow:managed", "flow:exempt"] as const;

export type ExecGh = (args: string[]) => string;

function defaultExecGh(args: string[]): string {
	return execFileSync("gh", args, { encoding: "utf-8" });
}

async function defaultConfirm(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question(question);
		return answer.trim().toLowerCase() === "y";
	} finally {
		rl.close();
	}
}

export interface EnsureLabelsOptions {
	yes: boolean;
	execGh?: ExecGh;
	confirm?: (question: string) => Promise<boolean>;
}

export interface EnsureLabelsResult {
	created: string[];
	message: string;
}

/**
 * Ensures flow:managed / flow:exempt labels exist via gh. Subordinate to L3
 * adoption — callers should only invoke this when isL3Adopted() is true.
 * gh missing -> guidance message, not an error. gh present -> list missing
 * labels and confirm [y/N] (auto-yes with --yes).
 */
export async function ensureLabels(
	opts: EnsureLabelsOptions,
): Promise<EnsureLabelsResult> {
	const execGh = opts.execGh ?? defaultExecGh;
	const confirm = opts.confirm ?? defaultConfirm;

	let existing: string;
	try {
		existing = execGh(["label", "list"]);
	} catch {
		return {
			created: [],
			message:
				"gh コマンドが見つかりません。flow:managed / flow:exempt ラベルは手動作成してください。\n",
		};
	}

	const missing = REQUIRED_LABELS.filter((label) => !existing.includes(label));
	if (missing.length === 0) {
		return { created: [], message: "" };
	}

	if (!opts.yes) {
		const proceed = await confirm(
			`不足しているラベルを作成しますか: ${missing.join(", ")} [y/N] `,
		);
		if (!proceed) return { created: [], message: "" };
	}

	for (const label of missing) {
		execGh(["label", "create", label]);
	}
	return { created: missing, message: "" };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 16 passed (16)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): confirm and create missing gh labels (flow:managed/flow:exempt)"
```

---

### Task 10: `runSkillSync` — 全ステップを束ねるオーケストレーション関数

**Files:**
- Modify: `packages/cli/src/skill-sync.ts`
- Modify: `packages/cli/src/skill-sync.test.ts`

Task 2-9 の関数を1つの公開エントリポイントに合成する。`index.ts` の `run()` はこの関数だけを呼べばよい。

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/skill-sync.test.ts` に追記:

```typescript
import { runSkillSync } from "./skill-sync.js";

describe("runSkillSync", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("syncs general layer, skips install/, scaffolds L4, shows prompt (unadopted repo)", async () => {
		const result = await runSkillSync({ targetRoot, yes: true });

		expect(
			existsSync(join(targetRoot, ".claude/skills/pfd-ops/SKILL.md")),
		).toBe(true);
		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(false);
		expect(existsSync(join(targetRoot, ".pfdsl/roadmap.pfdsl"))).toBe(true);
		expect(result.stdout).toContain("cp -r .claude/skills/pfd-ops/install/. .");
		expect(result.stdout).toContain("ecosystem.pfdsl 構築プロンプト");
		expect(result.exitCode).toBe(0);
	});

	it("copies install/ when already adopted, and does not print ecosystem prompt when L4 already exists", async () => {
		mkdirSync(join(targetRoot, "scripts/lib"), { recursive: true });
		writeFileSync(join(targetRoot, "scripts/lib/yaml-require.mjs"), "old\n");
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		for (const f of [
			"roadmap.pfdsl",
			"roadmap.md",
			"ecosystem.pfdsl",
			"ecosystem.md",
		]) {
			writeFileSync(join(targetRoot, ".pfdsl", f), "existing\n");
		}

		const result = await runSkillSync({ targetRoot, yes: true });

		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(true);
		expect(result.stdout).not.toContain("ecosystem.pfdsl 構築プロンプト");
		expect(result.exitCode).toBe(0);
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `runSkillSync is not a function` で FAIL。

- [ ] **Step 3: 実装を追加**

`packages/cli/src/skill-sync.ts` に追記:

```typescript
export interface RunSkillSyncOptions {
	targetRoot: string;
	yes: boolean;
	execGh?: ExecGh;
	confirm?: (question: string) => Promise<boolean>;
}

export interface SkillSyncResult {
	stdout: string;
	exitCode: number;
}

/**
 * Orchestrates the full `pfdsl skill sync pfd-ops` flow:
 * general layer overwrite -> conditional install/ overwrite (subordinate gh
 * label confirmation when adopted) -> L4 scaffold -> ecosystem-setup prompt.
 */
export async function runSkillSync(
	opts: RunSkillSyncOptions,
): Promise<SkillSyncResult> {
	const skillRoot = resolveSkillRoot();
	const lines: string[] = [];

	copyGeneralLayer(skillRoot, opts.targetRoot);
	lines.push("pfd-ops general layer (SKILL.md, references/) synced.");

	const installResult = copyInstallLayer(skillRoot, opts.targetRoot);
	if (installResult.copied) {
		lines.push("pfd-ops install/ layer synced (L3 adopted).");
		const labelResult = await ensureLabels({
			yes: opts.yes,
			...(opts.execGh ? { execGh: opts.execGh } : {}),
			...(opts.confirm ? { confirm: opts.confirm } : {}),
		});
		if (labelResult.message) lines.push(labelResult.message);
		if (labelResult.created.length > 0) {
			lines.push(`Created labels: ${labelResult.created.join(", ")}`);
		}
	} else {
		lines.push(installResult.message);
	}

	const scaffoldResult = scaffoldL4Files(skillRoot, opts.targetRoot);
	if (scaffoldResult.scaffolded.length > 0) {
		lines.push(`Scaffolded: ${scaffoldResult.scaffolded.join(", ")}`);
	}

	const prompt = ecosystemSetupPrompt(skillRoot, scaffoldResult.scaffolded);
	if (prompt) lines.push(prompt);

	return { stdout: `${lines.join("\n")}\n`, exitCode: 0 };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts
```

Expected: `Tests 18 passed (18)`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/skill-sync.ts packages/cli/src/skill-sync.test.ts
git commit -m "feat(cli): add runSkillSync orchestration combining all sync steps"
```

---

### Task 11: `skill sync <name>` コマンドディスパッチを `index.ts` に追加

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`

`skill sync pfd-ops` → `runSkillSync`。`skill sync <unknown>`、bare `skill` はそれぞれ usage エラー（exit 2）。`--yes` フラグで非対話化。HELP に追記。

- [ ] **Step 1: 失敗するテストを書く**

`packages/cli/src/index.test.ts` に追記（既存の import 文に `mkdirSync` を追加し、ファイル末尾の `describe("help / unknown", ...)` ブロックの直前に挿入):

```typescript
describe("skill sync", () => {
	it("usage error for bare 'skill'", async () => {
		const r = await run(["skill"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("usage: pfdsl skill sync <name>");
	});

	it("usage error for unknown skill sync target", async () => {
		const r = await run(["skill", "sync", "nonexistent-skill"]);
		expect(r.exitCode).toBe(2);
		expect(r.stderr).toContain("unknown skill: nonexistent-skill");
	});

	it("syncs pfd-ops into target directory with --yes", async () => {
		const target = mkdtempSync(join(tmpdir(), "pfdsl-skill-sync-cli-"));
		try {
			const r = await run([
				"skill",
				"sync",
				"pfd-ops",
				"--target",
				target,
				"--yes",
			]);
			expect(r.exitCode).toBe(0);
			expect(
				existsSync(join(target, ".claude/skills/pfd-ops/SKILL.md")),
			).toBe(true);
		} finally {
			rmSync(target, { recursive: true, force: true });
		}
	});
});
```

`existsSync` と `mkdirSync` を `node:fs` の import に追加する（先頭の `import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";` を `import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";` に変更）。テスト専用に `--target` フラグを追加する（本番では cwd を使うが、テストでは実リポを汚さないために target を上書きできる必要がある）。

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd packages/cli && npx vitest run src/index.test.ts -t "skill sync"
```

Expected: `unknown command: skill` で exitCode 2 だが stderr に `usage: pfdsl skill sync <name>` が含まれず FAIL（HELP 文字列がエラーメッセージとして返るのみ）。

- [ ] **Step 3: `index.ts` にディスパッチを追加**

`packages/cli/src/index.ts` の先頭 import に追記:

```typescript
import { runSkillSync } from "./skill-sync.js";
```

`run()` の `switch` に `diff` の後・`default` の前で `case "skill":` を追加:

```typescript
		case "skill": {
			const [sub, name] = positional;
			if (sub !== "sync" || !name) {
				return fail("usage: pfdsl skill sync <name> [--yes]\n", 2);
			}
			if (name !== "pfd-ops") {
				return fail(`unknown skill: ${name}\n`, 2);
			}
			const targetRoot =
				typeof flags.target === "string" ? flags.target : process.cwd();
			const result = await runSkillSync({
				targetRoot,
				yes: flags.yes === true,
			});
			return ok(result.stdout);
		}
```

`HELP` 定数に追記（`diff` の行の後、`help` の行の前）:

```typescript
export const HELP = `pfdsl <command> [options]

Commands:
  check <file> [--audit] [--summary] [--strict]
                           Validate a .pfdsl file
                           --audit   list terminal artifacts and external inputs
                           --summary print artifact/process/edge counts
                           --strict  error if feedback source not reachable from target process
  fmt <file> [--write] [--mode flat|flows]
                           Format a .pfdsl file; flows groups per-process (A >> P -> B)
  normalize <file>         Print canonical edge list
  graph <file> [--format dot|svg|pdf|png]
                           Print Graphviz DOT (default), SVG, PDF, or PNG
                           PDF/PNG requires: npm install puppeteer
  diff <a> <b>             Print structural diff between two files
  skill sync <name> [--yes]
                           Sync a bundled skill (currently: pfd-ops) into the current directory
                           --yes     auto-confirm gh label creation (non-interactive)
  help                     Show this help
`;
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
cd packages/cli && npx vitest run src/index.test.ts -t "skill sync"
```

Expected: `Tests 3 passed (3)`

- [ ] **Step 5: index.ts の `--target` フラグはテスト専用の抜け道であることを明示するコメントを追加**

`index.ts` の `case "skill":` ブロック内、`targetRoot` の行の直前にコメントを1行追加:

```typescript
			// --target overrides cwd; intended for tests only (production always
			// targets the directory the CLI is invoked from).
			const targetRoot =
				typeof flags.target === "string" ? flags.target : process.cwd();
```

- [ ] **Step 6: フルテストスイートを実行して既存テストに影響がないことを確認**

```bash
cd packages/cli && npx vitest run
```

Expected: 全テスト（`index.test.ts`、`skill-sync.test.ts`、`cli-smoke.test.ts`）が PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "feat(cli): add 'skill sync <name>' command dispatch with --yes flag"
```

---

### Task 12: `docs/pfdsl_implementation_flow.pfdsl` への dogfood 反映

**Files:**
- Modify: `docs/pfdsl_implementation_flow.pfdsl`

設計doc「implementation_flow への反映」節の指示どおり、sync 機構を新規 artifact/process として登録する。`cli_tool` を入力とする process として追加する。

- [ ] **Step 1: artifact と process を追加**

`docs/pfdsl_implementation_flow.pfdsl` の frontmatter `artifact:` セクション末尾（`preview_minimap` の後）に追記:

```yaml
  skill_sync_command:
    label: skill syncコマンド
    status: todo
    description: "`pfdsl skill sync pfd-ops`。外部採用リポの pfd-ops を一発最新化する。npm同梱（postbuildでdist/skills/pfd-opsへコピー）+ L3採用済み判定 + L4 scaffold（設計: docs/superpowers/specs/2026-06-16-pfd-ops-sync-command-design.md）"
```

`process:` セクション末尾（`implement_preview_minimap` の後）に追記:

```yaml
  implement_skill_sync:
    label: skill sync実装
```

- [ ] **Step 2: フロー本体にエッジを追加**

ファイル末尾（`preview_panel >> implement_preview_minimap -> preview_minimap` の後）に追記:

```
cli_tool >> implement_skill_sync -> skill_sync_command
```

- [ ] **Step 3: `pfdsl check` で検証**

```bash
cd /Users/m5/works/pfdsl && node packages/cli/dist/cli.js check docs/pfdsl_implementation_flow.pfdsl
```

Expected: `OK` 相当（エラー無し、exit code 0）。

- [ ] **Step 4: Commit**

```bash
git add docs/pfdsl_implementation_flow.pfdsl
git commit -m "docs(flow): register skill sync command as new toolchain artifact/process"
```

---

### Task 13: Verification — 設計doc検証節の各項目を実行

**Files:** なし（検証のみ、コミットなし）

設計doc「検証」節の各 思考実験 / npm pack / 実CLI 項目を具体チェックに翻訳して実行する。

- [ ] **Step 1: 思考実験1 — L3 非採用リポで install/ が展開されないこと**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts -t "does not copy and returns guidance message when not adopted"
```

Expected: PASS（Task 6 のテストがこれを既にカバーしている）。

- [ ] **Step 2: 思考実験2 — L3 採用済みリポで install/ 全体が上書きされること**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts -t "copies install/ tree to target root when adopted"
```

Expected: PASS（Task 6 のテストがこれを既にカバーしている）。

- [ ] **Step 3: 思考実験3 — L4欠落リポで雛形生成・既存不触・`pfdsl check`通過・プロンプト表示**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts -t "creates all 4 files under .pfdsl/ when none exist"
npx vitest run src/skill-sync.test.ts -t "does not touch a file that already exists"
```

さらに、生成された雛形が実際に `pfdsl check` を通ることを実環境で確認:

```bash
cd /Users/m5/works/pfdsl
TMPDIR_CHECK=$(mktemp -d)
node packages/cli/dist/cli.js skill sync pfd-ops --target "$TMPDIR_CHECK" --yes
node packages/cli/dist/cli.js check "$TMPDIR_CHECK/.pfdsl/roadmap.pfdsl"
node packages/cli/dist/cli.js check "$TMPDIR_CHECK/.pfdsl/ecosystem.pfdsl"
rm -rf "$TMPDIR_CHECK"
```

Expected: 両方の `check` が `OK` で exit code 0。

- [ ] **Step 4: 思考実験4 — L4全て育成済みリポでプロンプト非表示**

```bash
cd packages/cli && npx vitest run src/skill-sync.test.ts -t "returns empty scaffolded list when all 4 files already exist"
npx vitest run src/skill-sync.test.ts -t "copies install/ when already adopted, and does not print ecosystem prompt when L4 already exists"
```

Expected: PASS（Task 7, Task 10 のテストがこれを既にカバーしている）。

- [ ] **Step 5: npm同梱 — `npm pack` で `dist/skills/pfd-ops/` が含まれること**

```bash
cd /Users/m5/works/pfdsl/packages/cli && npm pack --dry-run 2>&1 | grep -c "dist/skills/pfd-ops"
```

Expected: `0` より大きい数（Task 1 Step 4 で既に確認済みだが、Task 4-10 で increment した skill ツリーを反映して再確認）。

- [ ] **Step 6: 実CLI — 別ディレクトリで `npx`相当の実行を行い展開・scaffold結果を確認**

```bash
cd /Users/m5/works/pfdsl/packages/cli && pnpm build
EXT_DIR=$(mktemp -d)
node dist/cli.js skill sync pfd-ops --target "$EXT_DIR" --yes
find "$EXT_DIR" -type f | sort
cat "$EXT_DIR/.pfdsl/roadmap.pfdsl" | head -5
rm -rf "$EXT_DIR"
```

Expected: `.claude/skills/pfd-ops/SKILL.md`、`.claude/skills/pfd-ops/references/*`、`.pfdsl/roadmap.pfdsl`、`.pfdsl/roadmap.md`、`.pfdsl/ecosystem.pfdsl`、`.pfdsl/ecosystem.md` が一覧に出る。`.github/workflows/check-pfd-ops-sync.yml` は出ない（未採用のため）。

- [ ] **Step 7: TDD確認 — 全単体テストが通っていることの最終確認**

```bash
cd /Users/m5/works/pfdsl && pnpm --filter @pfdsl/cli test
```

Expected: `Tests 21 passed (21)` 相当（index.test.ts の既存17 + skill sync 3 追加分、skill-sync.test.ts の18、cli-smoke.test.ts の1 — 正確な合計はテスト実行時の出力で確認する）。

---

### Task 14: 0.0.5 公開パスの確認とドキュメント化（実公開はしない）

**Files:** なし（確認のみ、コミットなし — `.github/workflows/publish-cli.yml` は変更不要）

`@pfdsl/cli` は `package.json` で既に `0.0.5` だが npm未公開。今回の sync コマンドはこの 0.0.5 で出荷する。公開パスを確認し、マージ後の実行手順を確定する（実行はしない）。

- [ ] **Step 1: 公開ワークフローのトリガーを確認**

```bash
cat /Users/m5/works/pfdsl/.github/workflows/publish-cli.yml
```

Expected: `on.push.tags: ['v*']` トリガー、`npm publish --provenance --access public`（OIDC Trusted Publishing、`NPM_TOKEN` 等のシークレット不要）であることを確認。

- [ ] **Step 2: 現在の npm registry 公開バージョンを確認**

```bash
npm view @pfdsl/cli version
```

Expected: `0.0.4`（design doc の記述と一致 — 0.0.5 は未公開であることの確認）。

- [ ] **Step 3: マージ後の公開手順をこのタスクの記録として残す（実行しない）**

このプランの実装が全タスク完了し PR がマージされた後、リポのメンテナがリポルートで実行する手順:

```bash
git checkout main && git pull origin main
git tag v0.0.5
git push origin v0.0.5
```

これにより `.github/workflows/publish-cli.yml` が起動し、`pnpm --filter "@pfdsl/cli..." build` → `test` → `npm publish --provenance --access public` が実行され、npm registry に `@pfdsl/cli@0.0.5` が公開される。**このタスクでは tag push を実行しない** — マージ後の手動操作として記録するのみ。

- [ ] **Step 4: `docs/pfdsl_implementation_flow.pfdsl` の `cli_published` status を確認**

```bash
grep -A3 "cli_published:" /Users/m5/works/pfdsl/docs/pfdsl_implementation_flow.pfdsl
```

現状 `status: done`（0.0.4 公開時点の記録）。0.0.5 公開後、この artifact の `description` を更新するかどうかは別判断（このプランのスコープ外 — 本タスクは公開パスの確認のみ）。

---

## Summary

全14タスク完了で次が揃う:

- `packages/cli/dist/skills/pfd-ops/` に汎用層・install/・scaffold テンプレ・プロンプトが同梱される（Task 1, 4）
- `packages/cli/src/skill-sync.ts` に単体テスト可能な9つの公開関数（`resolveSkillRoot`, `copyGeneralLayer`, `listInstallFiles`, `isL3Adopted`, `copyInstallLayer`, `scaffoldL4Files`, `ecosystemSetupPrompt`, `ensureLabels`, `runSkillSync`）（Task 2, 3, 5-10）
- `pfdsl skill sync pfd-ops [--yes]` が `index.ts` のディスパッチから実行可能（Task 11）
- dogfooding 反映済み（Task 12）
- 設計doc検証節の全項目を具体チェックとして実行済み（Task 13）
- 0.0.5 公開パス確認済み、実行は未了（マージ後の手動 tag push — Task 14）

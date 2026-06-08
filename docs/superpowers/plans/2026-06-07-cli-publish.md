# CLI npm Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm install -g @pfdsl/cli` でインストールできるようにし、git tag push で GitHub Actions が自動的に npm publish する。

**Architecture:** tsup が workspace 依存（`@pfdsl/core`, `@pfdsl/graphviz-exporter`, `@pfdsl/preview-engine`）を `dist/cli.js` に全バンドルする。`@hpcc-js/wasm` だけ外部依存として残し npm が自動インストール。GitHub Actions が `v*` tag push をトリガーに build → `npm publish` する。

**Tech Stack:** tsup, GitHub Actions, npm

---

### Task 1: Commit snapshot fix

**Files:**
- Commit: `packages/core/src/__snapshots__/index.test.ts.snap`

- [ ] **Step 1: Confirm snapshot is updated**

```bash
cd /path/to/worktree
git diff --stat packages/core/src/__snapshots__/
```

Expected: `index.test.ts.snap | N insertions/deletions`

- [ ] **Step 2: Run core tests to confirm all pass**

```bash
cd packages/core && ./node_modules/.bin/vitest run
```

Expected: `Tests 147 passed (147)`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__snapshots__/index.test.ts.snap
git commit -m "test(core): update snapshot for implementation flow changes"
```

---

### Task 2: Update packages/cli/package.json

**Files:**
- Modify: `packages/cli/package.json`

workspace 依存を `devDependencies` に移動し、`@hpcc-js/wasm` を `dependencies` に追加する。`publishConfig` も追加。

- [ ] **Step 1: Edit packages/cli/package.json**

`dependencies` を以下に変更:

```json
{
  "dependencies": {
    "@hpcc-js/wasm": "^2.18.0"
  },
  "devDependencies": {
    "@pfdsl/core": "workspace:*",
    "@pfdsl/preview-engine": "workspace:*",
    "@types/node": "^20.0.0",
    "tsup": "^8.0.0",
    "vitest": "^1.6.0"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2: Rebuild and run tests to confirm nothing broke**

```bash
pnpm -r build && pnpm --filter @pfdsl/cli test
```

Expected: `Tests 18 passed (18)`

- [ ] **Step 3: Commit**

```bash
git add packages/cli/package.json
git commit -m "feat(cli): move workspace deps to devDeps, add @hpcc-js/wasm and publishConfig"
```

---

### Task 3: Create tsup.config.ts to bundle workspace deps

**Files:**
- Create: `packages/cli/tsup.config.ts`
- Modify: `packages/cli/package.json` (scripts の build を簡略化)

`@pfdsl/*` をバンドルし、`@hpcc-js/wasm` は外部依存として残す。

- [ ] **Step 1: Create packages/cli/tsup.config.ts**

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  noExternal: [/^@pfdsl\//],
  external: ["@hpcc-js/wasm"],
});
```

- [ ] **Step 2: Update build script in packages/cli/package.json**

`scripts.build` を変更:

```json
"build": "tsup"
```

- [ ] **Step 3: Build and verify bundle contains no @pfdsl imports**

```bash
pnpm --filter @pfdsl/cli build
```

Expected output:
```
ESM Build start
ESM dist/cli.js  ...KB
ESM dist/index.js  ...KB
ESM ⚡️ Build success
```

- [ ] **Step 4: Verify @pfdsl/* is NOT imported in the bundle**

```bash
grep -c "from \"@pfdsl/" packages/cli/dist/cli.js || echo "0 matches - bundled correctly"
```

Expected: `0 matches - bundled correctly`

- [ ] **Step 5: Verify @hpcc-js/wasm IS imported (not bundled)**

```bash
grep "@hpcc-js/wasm" packages/cli/dist/cli.js
```

Expected: 1行以上ヒット（import が残っていること）

- [ ] **Step 6: Run CLI tests**

```bash
pnpm --filter @pfdsl/cli test
```

Expected: `Tests 18 passed (18)`

- [ ] **Step 7: Commit**

```bash
git add packages/cli/tsup.config.ts packages/cli/package.json
git commit -m "feat(cli): bundle workspace deps via tsup, externalize @hpcc-js/wasm"
```

---

### Task 4: Create GitHub Actions publish workflow

**Files:**
- Create: `.github/workflows/publish-cli.yml`

**前提（手動作業）:** npm access token を取得し GitHub の Settings > Secrets > Actions に `NPM_TOKEN` として登録しておく。

- [ ] **Step 1: Create .github/workflows/publish-cli.yml**

```yaml
name: Publish CLI to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - run: pnpm install --frozen-lockfile

      - run: pnpm -r test

      - run: pnpm -r build

      - run: npm publish --access public
        working-directory: packages/cli
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Verify workflow YAML is valid**

```bash
cat .github/workflows/publish-cli.yml
```

Expected: エラーなく出力される

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish-cli.yml
git commit -m "feat(ci): add GitHub Actions workflow to publish @pfdsl/cli on tag push"
```

---

### Task 5: Update pfdsl_implementation_flow.pfdsl

**Files:**
- Modify: `docs/pfdsl_implementation_flow.pfdsl`

- [ ] **Step 1: Update cli_published status to wip**

`docs/pfdsl_implementation_flow.pfdsl` の frontmatter:

```yaml
  cli_published:
    label: CLI npm公開
    status: wip
```

- [ ] **Step 2: Validate**

```bash
node packages/cli/dist/cli.js check docs/pfdsl_implementation_flow.pfdsl
```

Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add docs/pfdsl_implementation_flow.pfdsl
git commit -m "docs(flow): mark cli_published as wip"
```

---

### Task 6: Verify end-to-end with npm pack dry run

publish の前に何が含まれるかを確認する。

- [ ] **Step 1: Build the CLI**

```bash
pnpm --filter @pfdsl/cli build
```

- [ ] **Step 2: Run npm pack dry run**

```bash
cd packages/cli && npm pack --dry-run
```

Expected 出力に含まれるべきもの:
- `dist/cli.js`
- `dist/index.js`
- `dist/cli.d.ts`
- `dist/index.d.ts`

Expected 出力に含まれてはいけないもの:
- `src/` 以下のファイル
- `node_modules/`

- [ ] **Step 3: Confirm @hpcc-js/wasm appears in listed dependencies**

```bash
cat packages/cli/package.json | grep -A3 '"dependencies"'
```

Expected: `@hpcc-js/wasm` が `dependencies` にある

---

## Publishing (manual steps after PR merge)

1. `packages/cli/package.json` の `version` を更新（例: `0.0.1` → `0.1.0`）
2. `git add packages/cli/package.json && git commit -m "chore(cli): bump version to 0.1.0"`
3. `git tag v0.1.0`
4. `git push origin main --tags`
5. GitHub Actions が自動的に `npm publish` する

ユーザーのインストールコマンド:
```bash
npm install -g @pfdsl/cli
pfdsl --help
```

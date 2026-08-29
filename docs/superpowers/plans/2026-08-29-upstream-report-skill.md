# pfd-upstream-report 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 採用リポの利用者が配布物（pfd-* スキル本文・reference・CLI・gate script）の欠陥や未対応要望を上流リポ takasek/pfdsl へ issue として報告できる配布スキルを追加する。

**Architecture:** 環境採取だけを pfd-ops 同梱スクリプトへ寄せ、所在の探索・起草・一般化・重複確認・承認・投稿は新スキル `pfd-upstream-report` の本文が担う。
自リポモードの起票後処理（ラベル・roadmap 登録）は pfd-ops の GitHub Issues バックエンドへ委譲する。

**Tech Stack:** Node.js stdlib（bundle 内自己完結の制約）、`node --test`、Biome、`gh` CLI。

設計の一次情報は [2026-08-29-upstream-report-skill-design.md](../specs/2026-08-29-upstream-report-skill-design.md)。
本計画が文面の内容を規定しない箇所は設計文書を参照する。

## Global Constraints

- 環境採取スクリプトは bundle 内で自己完結する。Node stdlib 以外を import しない（`plugin-version-check.mjs` と同じ制約）
- 一次ソースは `.claude/skills/` 配下。`plugin/pfdsl/` と `.agents/` と `.codex/` は生成物であり直接編集しない
- 生成物の再生成は `node scripts/gen-plugin-dist-independent.mjs`
- `.md` の散文は文境界でのみ改行する。読点での改行は `check-md-linebreaks` が違反として検出する
- スキル本文・reference は日本語、`description` は英語（既存の pfd-* スキルに合わせる）
- コミットメッセージは英語、Conventional Commits 準拠
- Biome 準拠。落ちたら `make format` で再整形して再 stage する

---

### Task 1: Claude plugin 形態の環境解決

**Files:**
- Create: `.claude/skills/pfd-ops/scripts/collect-report-environment.mjs`
- Test: `scripts/lib/collect-report-environment.test.mjs`
- Modify: `scripts/lib/harness-inventory.mjs`（`SKILL_SOURCE_FILES` の `pfd-ops` エントリ）

**Interfaces:**
- Consumes: なし
- Produces: `collectReportEnvironment(skillRoot, options)` を export する。`options.runCommand` は `(command, args) => string | null` で、既定は spawnSync 実装。返り値は `{ installation, pluginVersion, bundleContentHash, cliVersion, repoCommit, installProvenance, unavailable }`。`unavailable` は `{ field, reason }` の配列

- [ ] **Step 1: 失敗するテストを書く**

`scripts/lib/collect-report-environment.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { collectReportEnvironment } from "../../.claude/skills/pfd-ops/scripts/collect-report-environment.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "collect-report-environment-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

const noCommands = () => null;

describe("collectReportEnvironment", () => {
	it("reports version and bundle hash for a Claude plugin installation", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "0.4.2" });
		writeJson(join(tmp, ".claude-plugin", "bundle-manifest.json"), {
			contentHash: "abc123",
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "claude-plugin");
		assert.equal(env.pluginVersion, "0.4.2");
		assert.equal(env.bundleContentHash, "abc123");
	});
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: FAIL（`Cannot find module .../collect-report-environment.mjs`）

- [ ] **Step 3: 最小実装を書く**

`.claude/skills/pfd-ops/scripts/collect-report-environment.mjs`:

```js
#!/usr/bin/env node
// Collects the environment block of an upstream report (pfd-upstream-report).
//
// This file ships inside the pfd-ops skill and travels with the whole skill
// tree into every plugin bundle, so it must not import anything outside
// itself — Node stdlib only.
//
// Unlike plugin-version-check.mjs, which returns null and stays silent when a
// manifest is missing, this reports what it could not obtain. A reader of the
// issue has to be able to tell "not available in this installation shape"
// from "collection failed".

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** @param {string} path */
function readJsonOrNull(path) {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

/**
 * @param {string} skillRoot
 * @param {{ runCommand?: (command: string, args: string[]) => string | null }} [options]
 */
export function collectReportEnvironment(skillRoot, options = {}) {
	const bundleRoot = resolve(skillRoot, "../..");
	const unavailable = [];
	const claudeManifest = readJsonOrNull(
		resolve(bundleRoot, ".claude-plugin/plugin.json"),
	);
	const bundleManifest = readJsonOrNull(
		resolve(bundleRoot, ".claude-plugin/bundle-manifest.json"),
	);
	return {
		installation: "claude-plugin",
		pluginVersion: claudeManifest?.version ?? null,
		bundleContentHash: bundleManifest?.contentHash ?? null,
		cliVersion: null,
		repoCommit: null,
		installProvenance: null,
		unavailable,
	};
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: PASS（1 test）

- [ ] **Step 5: 配布経路へ登録する**

`.claude/skills/pfd-ops/` 配下に `SKILL_SOURCE_FILES` へ列挙されていないファイルが1つでもあると、`scripts/lib/harness-source-decoder.mjs` の `decodeHarnessSources` が `source-topology: ...: unclassified ...` で生成そのものを拒否する。
pre-commit の drift ゲートはこの再生成を呼ぶため、登録前のコミットは失敗する。
したがって登録を後続タスクへ先送りできない。

`scripts/lib/harness-inventory.mjs` の `SKILL_SOURCE_FILES` の `pfd-ops` 配列で、`"references/work-cycle.md",` と `"scripts/check-install-sync.mjs",` の間へ挿入する（配列は文字列のソート順に並んでいる）:

```js
		"scripts/collect-report-environment.mjs",
```

- [ ] **Step 6: 配布物を再生成する**

Run: `node scripts/gen-plugin-dist-independent.mjs`
Expected: exit 0。末尾に `Dist-independent Claude and Codex plugin outputs assembled.` が出る

- [ ] **Step 7: 4ターゲットへ出力されたことを確認する**

Run: `git status --short | grep -c 'collect-report-environment'`
Expected: 3 以上（一次ソース・`plugin/pfdsl/skills/pfd-ops/scripts/`・`.agents/skills/pfd-ops/scripts/` に現れる）

- [ ] **Step 8: コミット**

```bash
git add -A && git commit -m "feat(pfd-ops): resolve the Claude plugin report environment"
```

---

### Task 2: Codex plugin 形態と取得不能項目の報告

**Files:**
- Modify: `.claude/skills/pfd-ops/scripts/collect-report-environment.mjs`
- Test: `scripts/lib/collect-report-environment.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `collectReportEnvironment`
- Produces: `installation` が `"codex-plugin"` を取りうる。`unavailable` に `{ field: "bundleContentHash", reason: ... }` が入る

Codex 変換は `CLAUDE_PLUGIN_ROOT` を `PLUGIN_ROOT` へ置換するだけで `.claude-plugin` という文字列は変換しない（`scripts/lib/gen-codex-assets.mjs:214`）。
Codex plugin の manifest は `.codex-plugin/plugin.json` に生成され（`scripts/lib/harness-inventory.mjs` の `plugin-metadata` capability）、その outputs に bundle manifest は含まれない。
したがって Codex plugin では contentHash が原理的に取得できない。

- [ ] **Step 1: 失敗するテストを追加する**

`scripts/lib/collect-report-environment.test.mjs` の `describe` ブロックへ追加:

```js
	it("reports the Codex plugin version and records the missing bundle hash", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".codex-plugin", "plugin.json"), { version: "0.4.2" });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "codex-plugin");
		assert.equal(env.pluginVersion, "0.4.2");
		assert.equal(env.bundleContentHash, null);
		assert.deepEqual(
			env.unavailable.map(({ field }) => field),
			["bundleContentHash"],
		);
		assert.match(env.unavailable[0].reason, /Codex/);
	});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: FAIL（`installation` が `"claude-plugin"` のまま）

- [ ] **Step 3: 形態の分岐を実装する**

`collectReportEnvironment` の本体を差し替える:

```js
/** @param {string} skillRoot */
function detectInstallation(skillRoot) {
	const bundleRoot = resolve(skillRoot, "../..");
	if (existsSync(resolve(bundleRoot, ".claude-plugin/plugin.json"))) {
		return { installation: "claude-plugin", bundleRoot };
	}
	if (existsSync(resolve(bundleRoot, ".codex-plugin/plugin.json"))) {
		return { installation: "codex-plugin", bundleRoot };
	}
	return { installation: "unknown", bundleRoot };
}

export function collectReportEnvironment(skillRoot, options = {}) {
	const { installation, bundleRoot } = detectInstallation(skillRoot);
	const unavailable = [];
	let pluginVersion = null;
	let bundleContentHash = null;

	if (installation === "claude-plugin") {
		pluginVersion =
			readJsonOrNull(resolve(bundleRoot, ".claude-plugin/plugin.json"))
				?.version ?? null;
		bundleContentHash =
			readJsonOrNull(resolve(bundleRoot, ".claude-plugin/bundle-manifest.json"))
				?.contentHash ?? null;
	}
	if (installation === "codex-plugin") {
		pluginVersion =
			readJsonOrNull(resolve(bundleRoot, ".codex-plugin/plugin.json"))
				?.version ?? null;
		unavailable.push({
			field: "bundleContentHash",
			reason:
				"Codex plugin bundles do not carry a bundle manifest, so the content hash cannot be read.",
		});
	}

	return {
		installation,
		pluginVersion,
		bundleContentHash,
		cliVersion: null,
		repoCommit: null,
		installProvenance: null,
		unavailable,
	};
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: 配布物を再生成する**

Run: `node scripts/gen-plugin-dist-independent.mjs`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add -A && git commit -m "feat(pfd-ops): report the Codex plugin's missing bundle hash"
```

---

### Task 3: repo-local install と上流 checkout の区別

**Files:**
- Modify: `.claude/skills/pfd-ops/scripts/collect-report-environment.mjs`
- Test: `scripts/lib/collect-report-environment.test.mjs`

**Interfaces:**
- Consumes: Task 2 の `detectInstallation`
- Produces: `installation` が `"repo-local"` と `"upstream-checkout"` を取りうる。`installProvenance` に install provenance が入る（読み方と型は「実装後の逸脱」節が最終形を示す）

上流判定に `git remote` を使わない。
採用リポが参照用に pfdsl の remote を登録しているだけでも条件を満たし、その誤判定は一般化のスキップを通じて採用リポの固有名詞の公開へ直結する。
このスクリプトは作業ツリーの構造だけを見る。
remote の確認はスキル本文が別の証拠として行う。

- [ ] **Step 1: 失敗するテストを追加する**

```js
	it("classifies a repo-local install and carries its provenance", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		writeJson(join(repoRoot, "pfd-ops-install-manifest.json"), {
			version: "0.4.2",
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "repo-local");
		assert.equal(env.pluginVersion, null);
		assert.deepEqual(env.installProvenance, { version: "0.4.2" });
	});

	it("classifies the upstream checkout by its own distribution sources", () => {
		const repoRoot = join(tmp, "pfdsl");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		writeJson(join(repoRoot, "plugin/pfdsl/.claude-plugin/plugin.json"), {
			version: "0.4.2",
		});
		mkdirSync(join(repoRoot, "scripts", "lib"), { recursive: true });
		writeFileSync(join(repoRoot, "scripts/lib/harness-inventory.mjs"), "");

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "upstream-checkout");
	});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: FAIL（両方とも `installation` が `"unknown"`）

- [ ] **Step 3: リポルート探索と分類を実装する**

`import { resolve } from "node:path";` を `import { dirname, resolve } from "node:path";` へ変える。
`detectInstallation` の `unknown` 分岐を差し替える:

```js
/** @param {string} from */
function findRepoRoot(from) {
	let current = resolve(from);
	for (;;) {
		if (existsSync(resolve(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function detectInstallation(skillRoot) {
	const bundleRoot = resolve(skillRoot, "../..");
	if (existsSync(resolve(bundleRoot, ".claude-plugin/plugin.json"))) {
		return { installation: "claude-plugin", bundleRoot, repoRoot: null };
	}
	if (existsSync(resolve(bundleRoot, ".codex-plugin/plugin.json"))) {
		return { installation: "codex-plugin", bundleRoot, repoRoot: null };
	}
	const repoRoot = findRepoRoot(skillRoot);
	if (repoRoot === null) {
		return { installation: "unknown", bundleRoot, repoRoot: null };
	}
	if (
		existsSync(resolve(repoRoot, "plugin/pfdsl/.claude-plugin/plugin.json")) &&
		existsSync(resolve(repoRoot, "scripts/lib/harness-inventory.mjs"))
	) {
		return { installation: "upstream-checkout", bundleRoot, repoRoot };
	}
	return { installation: "repo-local", bundleRoot, repoRoot };
}
```

`collectReportEnvironment` で `repoRoot` を受け取り、repo-local の provenance を読む:

```js
	const { installation, bundleRoot, repoRoot } = detectInstallation(skillRoot);
	let installProvenance = null;
	if (installation === "repo-local") {
		installProvenance = readJsonOrNull(
			resolve(repoRoot, "pfd-ops-install-manifest.json"),
		);
		unavailable.push({
			field: "pluginVersion",
			reason:
				"A repo-local install carries no plugin manifest; the install provenance identifies the bundle instead.",
		});
	}
```

返り値の `installProvenance: null` を `installProvenance` へ変える。

- [ ] **Step 4: テストを実行して通過を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: 配布物を再生成する**

Run: `node scripts/gen-plugin-dist-independent.mjs`
Expected: exit 0

- [ ] **Step 6: コミット**

```bash
git add -A && git commit -m "feat(pfd-ops): separate repo-local installs from the upstream checkout"
```

---

### Task 4: CLI version と git commit の採取

**Files:**
- Modify: `.claude/skills/pfd-ops/scripts/collect-report-environment.mjs`
- Test: `scripts/lib/collect-report-environment.test.mjs`

**Interfaces:**
- Consumes: Task 3 の `collectReportEnvironment`
- Produces: `cliVersion` と `repoCommit` が `options.runCommand` 経由で埋まる。既定の `runCommand` は `spawnSync` 実装で、失敗時は `null` を返す

- [ ] **Step 1: 失敗するテストを追加する**

```js
	it("collects the CLI version and the repository commit through runCommand", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });

		const calls = [];
		const runCommand = (command, args) => {
			calls.push([command, ...args]);
			if (command === "pfdsl") return "0.4.2";
			if (command === "git") return "0123456789abcdef";
			return null;
		};

		const env = collectReportEnvironment(skillRoot, { runCommand });

		assert.equal(env.cliVersion, "0.4.2");
		assert.equal(env.repoCommit, "0123456789abcdef");
		assert.deepEqual(calls[0], ["pfdsl", "--version"]);
	});

	it("records the CLI version as unavailable when the command fails", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "0.4.2" });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.cliVersion, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "cliVersion"),
			"cliVersion should be recorded as unavailable",
		);
	});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: FAIL（`cliVersion` が常に `null` で、`unavailable` にも入らない）

- [ ] **Step 3: コマンド実行を実装する**

`import { spawnSync } from "node:child_process";` を追加し、既定実装と採取を書く:

```js
/**
 * @param {string} command
 * @param {string[]} args
 * @returns {string | null}
 */
function defaultRunCommand(command, args) {
	try {
		const result = spawnSync(command, args, { encoding: "utf-8" });
		if (result.status !== 0) return null;
		const out = result.stdout?.trim();
		return out ? out : null;
	} catch {
		return null;
	}
}
```

`collectReportEnvironment` の末尾で採取する:

```js
	const runCommand = options.runCommand ?? defaultRunCommand;
	const cliVersion = runCommand("pfdsl", ["--version"]);
	if (cliVersion === null) {
		unavailable.push({
			field: "cliVersion",
			reason: "`pfdsl --version` did not run or returned no output.",
		});
	}
	const repoCommit =
		repoRoot === null
			? null
			: runCommand("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
```

返り値の `cliVersion: null` と `repoCommit: null` を採取した値へ変える。

- [ ] **Step 4: Task 2 のアサーションを意図に合わせて緩める**

`cliVersion` の採取は導入形態に関わらず走るため、`runCommand` が `null` を返すテストでは `unavailable` に `cliVersion` も入る。
Task 2 のテストは `unavailable` の配列全体が `["bundleContentHash"]` と一致することを要求していて、これが壊れる。
そのテストが確かめたいのは「Codex plugin では bundleContentHash が取得できないと記録される」であり、`unavailable` に他の項目が入らないことではない。
アサーションを意図に合わせる。

`scripts/lib/collect-report-environment.test.mjs` の `"reports the Codex plugin version and records the missing bundle hash"` で、次の2つのアサーションを差し替える:

```js
		assert.deepEqual(
			env.unavailable.map(({ field }) => field),
			["bundleContentHash"],
		);
		assert.match(env.unavailable[0].reason, /Codex/);
```

差し替え後:

```js
		const missingHash = env.unavailable.find(
			({ field }) => field === "bundleContentHash",
		);
		assert.ok(missingHash, "bundleContentHash should be recorded as unavailable");
		assert.match(missingHash.reason, /Codex/);
```

コミット済みの Task 2 を amend しない。
この差し替えは Task 4 の変更が要求したものなので、Task 4 のコミットへ含める。

- [ ] **Step 5: テストを実行して通過を確認する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: PASS（6 tests）

- [ ] **Step 6: 配布物を再生成する**

Run: `node scripts/gen-plugin-dist-independent.mjs`
Expected: exit 0

- [ ] **Step 7: コミット**

```bash
git add -A && git commit -m "feat(pfd-ops): collect the CLI version and repository commit"
```

---

### Task 5: pfd-upstream-report スキル本体

**Files:**
- Create: `.claude/skills/pfd-upstream-report/SKILL.md`
- Modify: `scripts/lib/harness-inventory.mjs`（`SKILL_SOURCE_FILES` と `HARNESS_CAPABILITY_CONTRACT`）

**Interfaces:**
- Consumes: Task 1 で配布された `collect-report-environment.mjs`（スキル本文が呼び出す）
- Produces: `skill:pfd-upstream-report` capability

- [ ] **Step 1: SKILL.md を書く**

frontmatter は既存の pfd-* スキルに合わせ、`name` / `summary` / `description` を持つ。
`description` は英語で、次を発火条件として書く。

- 採用リポの利用者が配布物（pfd-* スキル本文・reference・agent・command・hook・pfdsl CLI・gate script）の欠陥に気付いたとき
- 配布物に無い能力を要望として上流へ伝えたいとき
- pfd-retro の上流変更ルールが配布層の finding を検出したとき
- 採用リポ自身の PFD やコードの欠陥には使わない（そちらは pfd-ops）

本文は日本語で、設計文書の「実行フロー」6工程をそのまま節にする。
各節が規定する内容は設計文書 [2026-08-29-upstream-report-skill-design.md](../specs/2026-08-29-upstream-report-skill-design.md) の該当節を一次情報とし、本文へ写すのは実行手順に必要な範囲だけとする。

本文が必ず含む要素:

- 工程1: 外部報告モードが既定であること。自リポモードは remote と作業ツリー構造の両方が揃った場合に限ること。判定が付かなければ外部報告モードのままにすること
- 工程2: `collect-report-environment.mjs` の呼び出し方（導入形態ごとのパス分岐を含む）と、`unavailable` を本文へそのまま載せること。種別ごとの追加項目（プロンプト欠陥・CLI/gate・要望）
- 工程3: 所在の探索はスキルが行い、利用者へは候補の確認だけを求めること。探索の起点は工程2が解決した skill root であること
- 工程4: 既定は一般化であること。生の抜粋は候補として列挙し個別に確認すること。自リポモードではこの工程を行わないこと
- 工程5: 複数語検索・open と closed の両方・`--limit` の明示・同一性の判断は利用者が行うこと
- 工程6: `github-issues-backend.md` の「複数行本文の外部書込み」規約に従うこと。body file・`--body-file`・stable identifier での readback・完全一致確認・不一致なら停止。外部報告モードではラベルを付けないこと。自リポモードの起票後処理は pfd-ops の GitHub Issues バックエンドへ委譲すること。gh が未認証・権限不足なら本文ファイルのパスと手動投稿コマンドを提示して停止し、別経路へ迂回しないこと
- issue 本文の形式: タイトルは `<type>(<scope>): <症状>` で、scope は所在の由来。所在を特定できなかった場合は scope を省略する。本文は症状・環境・再現手順または該当箇所・期待した挙動・一般化の注記の順に並べる

- [ ] **Step 2: 散文の改行規約を確認する**

Run: `node scripts/check-md-linebreaks.mjs .claude/skills/pfd-upstream-report/SKILL.md`
Expected: `check-md-linebreaks: OK`

- [ ] **Step 3: capability を登録する**

`scripts/lib/harness-inventory.mjs` の `SKILL_SOURCE_FILES` へ追加する（オブジェクトのキーはアルファベット順で、`pfd-retro` の後になる）:

```js
	"pfd-upstream-report": Object.freeze(["SKILL.md"]),
```

`HARNESS_CAPABILITY_CONTRACT` の配列へ、`skillCapability("pfd-ecosystem"),` の後に追加する:

```js
	skillCapability("pfd-upstream-report"),
```

- [ ] **Step 4: 配布物を再生成する**

Run: `node scripts/gen-plugin-dist-independent.mjs`
Expected: exit 0

- [ ] **Step 5: 4ターゲットへ出力されたことを確認する**

Run: `git status --short | grep -c 'pfd-upstream-report'`
Expected: 1 以上。`plugin/pfdsl/skills/pfd-upstream-report/`・`.agents/skills/pfd-upstream-report/`・`plugin/pfdsl-codex/skills/pfd-upstream-report/` が現れる

- [ ] **Step 6: コミット**

```bash
git add -A && git commit -m "feat(skills): add the pfd-upstream-report skill"
```

---

### Task 6: pfd-retro の上流変更ルールを新スキルへ接続する

**Files:**
- Modify: `.claude/skills/pfd-retro/SKILL.md`（「上流変更ルール」節）

**Interfaces:**
- Consumes: Task 5 の `pfd-upstream-report` スキル
- Produces: なし

現行の該当文は次の一文で、採用リポ自身の issue バックエンドと上流リポへの起票が同居しており、どちらへ立てるのかが読み取れない。

> issue バックエンドを採用しているリポでは上流リポへの変更提案として起票する — 検出結果を捨てない。

- [ ] **Step 1: 該当文を書き換える**

上流リポへの起票を `pfd-upstream-report` スキルへのポインタにする。
書き換え後が満たす条件は次の3つ。

- 上流リポへの起票は `pfd-upstream-report` が手順を持つと示すこと
- 採用リポ自身の companion への記録と、上流への起票が別の宛先であると読めること
- スキルが利用できない環境（bundle の部分コピー等）では、ユーザーへの報告に留めるという既存の縮退が残ること

- [ ] **Step 2: 散文の改行規約を確認する**

Run: `node scripts/check-md-linebreaks.mjs .claude/skills/pfd-retro/SKILL.md`
Expected: `check-md-linebreaks: OK`

- [ ] **Step 3: 配布物を再生成する**

Run: `node scripts/gen-plugin-dist-independent.mjs`
Expected: exit 0

- [ ] **Step 4: コミット**

```bash
git add -A && git commit -m "docs(pfd-retro): route upstream findings to the report skill"
```

---

### Task 7: 全体検査と配布レビュー

**Files:**
- Modify: なし（検査と、指摘に応じた修正）

**Interfaces:**
- Consumes: Task 6 までの全成果物
- Produces: distribution-review のレビュー記録

- [ ] **Step 1: テストを実行する**

Run: `node --test scripts/lib/collect-report-environment.test.mjs`
Expected: PASS（6 tests）

- [ ] **Step 2: 配布物の drift が無いことを確認する**

Run: `node scripts/gen-plugin-dist-independent.mjs && git status --short`
Expected: 生成物に差分が出ない

- [ ] **Step 3: distribution-review を実行する**

`distribution-review` スキルを起動する。
新規配布物（`pfd-upstream-report` スキルと `collect-report-environment.mjs`）が対象になる。
採用リポの読み手視点で、上流にしか存在しない前提へ依存していないかを検証する。

- [ ] **Step 4: 指摘に対応する**

レビューの指摘ごとに1コミットで修正する。
配布物を変更したら `node scripts/gen-plugin-dist-independent.mjs` で再生成し、同じコミットへ含める。

- [ ] **Step 5: PR を作成する**

```bash
git push -u origin feat/upstream-report-skill
```

PR 本文には設計文書と本計画へのリンクを含める。
レビューとマージは人間の作業であり、この計画には含まれない。

---

## 実装後の逸脱

各タスクのコード片は着手時点の姿であり、実装後の敵対的検証で次を変えた。
最終形は成果物そのものと設計文書を見ること。

- **環境ブロックの欠落報告**: 形態が原理的に持たない項目（`MISSING_IDENTIFIERS`）と、読めるはずが読めなかった項目（`recordFailure`）を別々に記録する。全形態 × 全識別項目を埋め、テストは field 集合の完全一致で検査する
- **値の妥当性**: `asIdentifier` が非空（trim 後）の文字列だけを通す。空文字・空白・数値・配列は採取失敗として記録される
- **install provenance**: パスと entry の妥当性条件を複製せず、`check-install-sync.mjs` の `readManifest` を通して読む。値は installer が有効と認めた entry の配列で、0件なら採取失敗
- **CLI エントリ**: `process.argv[1]` を `realpathSync` で比較する。symlink 経由の起動でも出力する
- **リポルート解決**: `options.findRepoRoot` で注入できる。`unknown` 形態のテストが TMPDIR の祖先に依存しないようにするため
- **投稿と readback**: 新規起票とコメントで対象が違うことを明示し、`--jq` を禁止して JSON を decode して比較する。コマンドは変数へ代入して閉じ、`gh` の preflight を工程1へ置いた

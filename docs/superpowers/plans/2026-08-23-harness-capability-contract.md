# Symmetric Harness Capability Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` で、この計画をタスク単位に実行する。各 production-code 変更では `superpowers:test-driven-development` を使い、完了宣言前に `superpowers:verification-before-completion` を使う。

**Goal:** Claude Code と Codex の四つの delivery target を同じ capability contract で分類し、片側だけの未分類入力・出力・probe 欠落を生成前に失敗させる。

**Architecture:** 現在の `.claude` 表現を読む source decoder、中立 capability contract、並列な Claude/Codex adapter の三層へ分ける。`assemblePluginDistIndependent()` は decoder を一度だけ実行し、同じ検証済み records を両 adapter へ渡す。Codex adapter は生成済み Claude root や Claude manifest を読まず、既存の atomic publish と両 root の一括 rollback は維持する。

**Tech Stack:** Node.js 24 ESM、`node:test`、既存の `yaml` parser、JSON/TOML text generation、PFDSL CLI 0.0.25。

**Spec:** `docs/superpowers/specs/2026-08-23-codex-adapter-contract-design.md`

## Global constraints

- `.claude`、`CLAUDE.md`、`hooks/` はこの issue では maintained source encoding のまま残す。
- `claude-repository`、`claude-plugin`、`codex-repository`、`codex-plugin` のどれにも既定 disposition を設けず、全 capability が四 mapping を明示する。
- `native` と `transform` は target-local consumer probe を宣言し、`intentional-exclusion` は空でない理由と影響範囲を宣言する。
- Adapter は Claude/Codex 固有の source schema を再解釈せず、decoder が返す semantic record だけを使う。
- 既存 Claude plugin の tracked bytes、Codex plugin の validator/runtime 契約、generator transaction、dist independence を維持する。
- `claude-repository` は maintained source 上で検証するだけで、source path へ書き戻さない。
- Plugin、CLI、VS Code extension の publish は行わない。
- 実装は Red → Green → Refactor で進め、各論理単位を Conventional Commit にする。
- Worker はファイル編集とテストだけを担当し、親 agent が stage、commit、push、PR、issue 操作を担当する。

## Target model and public interfaces

新しい contract API は次を提供する。

```js
export const DELIVERY_TARGETS = Object.freeze([
	"claude-repository",
	"claude-plugin",
	"codex-repository",
	"codex-plugin",
]);

export function validateCapabilityContract(capabilities, { probeKinds });
export function capabilitiesForTarget(capabilities, target);
export function assertTargetOutputClosure({ target, declared, observed });
```

Source decoder API は filesystem 依存を注入可能にする。

```js
export function decodeHarnessCapabilities({
	root,
	contract = HARNESS_CAPABILITY_CONTRACT,
	deps = { lstatSync, readdirSync, readFileSync },
});
```

各 record は少なくとも次の形を持つ。

```js
{
	id: "command:pfd-cycle",
	kind: "command",
	source: { encoding: "claude-command", path: ".claude/commands/pfd-cycle.md" },
	semantic: { name: "pfd-cycle", description, body },
	mappings: {
		"claude-repository": { disposition: "native", outputs, probe },
		"claude-plugin": { disposition: "native", outputs, probe },
		"codex-repository": { disposition: "transform", outputs, probe },
		"codex-plugin": { disposition: "transform", outputs, probe },
	},
}
```

`outputs` は target root から見た論理 surface を列挙する。Manifest は file surface と field surface を分け、たとえば `manifest:.codex-plugin/plugin.json:skills` のように宣言する。Directory mapping は top-level capability root を surface とし、配下ファイルの closure は decoder が source tree として検査する。

## File structure

- Create `scripts/lib/harness-capability-contract.mjs` — 四 target の mapping schema、contract validation、target selection、output closure。
- Create `scripts/lib/harness-capability-contract.test.mjs` — mapping 対称性、disposition metadata、probe coverage、output closure の単体テスト。
- Create `scripts/lib/harness-source-decoder.mjs` — `.claude` topology、frontmatter、settings、hook、plugin metadata を semantic records へ変換する decoder。
- Create `scripts/lib/harness-source-decoder.test.mjs` — 未知 root・entry・field・hook event の closure fixtures。
- Modify `scripts/lib/harness-inventory.mjs` — 既存配布一覧を stable capability IDs と四 target mappings を持つ contract declaration へ拡張する。
- Modify `scripts/lib/harness-inventory.test.mjs` — 実在 source 集合との突合と、全 declaration の freeze/一意性を検査する。
- Modify `scripts/lib/gen-codex-assets.mjs` and its test — raw Claude text の parse を decoder へ移し、semantic records を Codex 表現へ encode する。
- Modify `scripts/lib/gen-plugin.mjs` and its test — 一回の decode 結果から Claude/Codex adapter を並列組み立てし、target output closure を publish 前に検査する。
- Modify `scripts/lib/gen-plugin-trigger.mjs` and its test — 新しい contract/decoder modules を drift trigger の closure に含める。
- Generate `AGENTS.md`, `.agents/skills/**`, `.codex/**`, `plugin/pfdsl/**`, `plugin/pfdsl-codex/**`, and `.claude-plugin/marketplace.json` through `make gen-plugin`。
- Modify `.pfdsl/runtime-pipeline.pfdsl` and `.pfdsl/runtime-pipeline.md` — source decoding と兄弟 adapter の実在依存を記録する。
- Modify `.pfdsl/bindings/pfd-retro-patterns/manual-enumeration-check-target.md` — #956/#981 の四 target mapping と output closure の具体例を既存 pattern に統合する。

---

### Task 1: Add the symmetric contract validator

**Files:**

- Create: `scripts/lib/harness-capability-contract.mjs`
- Create: `scripts/lib/harness-capability-contract.test.mjs`

**Interfaces:**

- Consumes: decoded capability records and the finite set of registered probe kinds。
- Produces: validated records, target-specific mappings, and deterministic closure errors before any filesystem publication。

- [ ] **Step 1: Write the four-way missing-mapping RED fixture**

一つの complete capability から各 target mapping を一件ずつ削除し、四ケースすべてが同じ error shape を返すことをテストする。

```js
for (const target of DELIVERY_TARGETS) {
	const capability = withoutMapping(completeCapability(), target);
	assert.throws(
		() => validateCapabilityContract([capability], { probeKinds }),
		new RegExp(`capability:test: missing mapping for ${target}`),
	);
}
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/lib/harness-capability-contract.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `harness-capability-contract.mjs`。

- [ ] **Step 3: Implement the minimum target and disposition validation**

`DELIVERY_TARGETS` を唯一の target 集合として export し、missing target、unknown target、unknown disposition、同一 target の重複 mapping を capability ID 付きで拒否する。Object key では重複を表せないため、declaration input は `{ target, disposition, ... }[]` とし、validation 後の record だけを target-keyed object に正規化する。

- [ ] **Step 4: Add metadata and probe RED fixtures**

`native`/`transform` の `probe` または `outputs` が空、`intentional-exclusion` の `reason` または `impact` が空、未登録 probe kind、同一 target の二 disposition をそれぞれ失敗させる。

- [ ] **Step 5: Implement metadata validation and output closure**

`assertTargetOutputClosure()` は declared/observed surface を集合比較し、余剰 surface では target、surface、生成元 capability ID を返し、欠落 surface では target と宣言元 capability ID を返す。同じ helper を四 target へ適用し、harness 別分岐を持たせない。

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test scripts/lib/harness-capability-contract.test.mjs`

Expected: all tests pass。

Commit: `feat(plugin): validate symmetric harness contract`

Review trailer: `Review: tool=correctness`

### Task 2: Declare the four target mappings in the neutral inventory

**Files:**

- Modify: `scripts/lib/harness-inventory.mjs`
- Modify: `scripts/lib/harness-inventory.test.mjs`

**Interfaces:**

- Consumes: current explicit distributed/excluded/generated skill, command, and agent lists。
- Produces: `HARNESS_CAPABILITY_CONTRACT` with stable IDs, source encodings, four explicit mappings, output surfaces, probe kinds, and exclusion metadata。

- [ ] **Step 1: Write RED tests for exact current declarations**

次の current capability families が stable ID で一意に現れることを検査する。

```text
skill:pfd-grill, skill:pfd-ops, skill:pfd-retro, skill:pfd-ecosystem, skill:pfdsl
command:pfd-cycle, command:pfd-init, command:pfd-retro
agent:pfd-lens, agent:pfd-implementer
repository-instructions, repository-hooks, plugin-hooks, plugin-metadata
```

Command は両 Claude target で native、両 Codex target で skill transform とする。Agent は両 Claude target で native、`codex-repository` で TOML transform、`codex-plugin` で intentional exclusion とする。各 mapping の引数を四つ必須にする helper は使ってよいが、target 固有の default を持たせない。

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/lib/harness-inventory.test.mjs scripts/lib/harness-capability-contract.test.mjs`

Expected: FAIL because `HARNESS_CAPABILITY_CONTRACT` and its mappings do not exist。

- [ ] **Step 3: Implement declarations without deleting compatibility exports**

既存の `DISTRIBUTED_*`、`SOURCE_EXCLUSIONS`、`GENERATED_SOURCES` は contract declaration から導出するか、移行中の compatibility view として再 export する。`CLAUDE_PLUGIN_MIRRORS` を独立した意味の一次情報にせず、`claude-plugin` mappings から導出する。

- [ ] **Step 4: Strengthen real-set accounting**

既存の `.claude/skills`、`.claude/commands`、`.claude/agents` 全件突合を維持し、contract capability ID、source path、target output surface の重複も拒否する。`.claude/skills/pfdsl` の generated symlink と maintainer-only exclusions は理由付き分類のまま残す。

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test scripts/lib/harness-inventory.test.mjs scripts/lib/harness-capability-contract.test.mjs scripts/lib/gen-plugin-trigger.test.mjs`

Expected: all tests pass and legacy imports remain valid。

Commit: `refactor(plugin): declare four target mappings`

Review trailer: `Review: tool=design`

### Task 3: Decode the maintained source encoding fail-closed

**Files:**

- Create: `scripts/lib/harness-source-decoder.mjs`
- Create: `scripts/lib/harness-source-decoder.test.mjs`
- Modify: `scripts/lib/harness-inventory.mjs`

**Interfaces:**

- Consumes: `HARNESS_CAPABILITY_CONTRACT`, `.claude` source topology, `CLAUDE.md`, `hooks/`, and `packages/cli/package.json` through injected filesystem dependencies。
- Produces: frozen semantic records with parsed command/agent/hook/metadata data and no adapter-specific output text。

- [ ] **Step 1: Write topology closure RED fixtures**

In-memory filesystem fixture に未知の `.claude/new-surface/`、未知 skill/command/agent entry、未分類 `.claude` root file を一つずつ追加する。Error は source path、`source-topology`、未分類名を含むことを検査する。既存 `.claude/pfd-ops-install-manifest.json` と generated `skills/pfdsl` は contract 上の明示分類として通す。

- [ ] **Step 2: Implement minimum topology decoding**

`lstatSync` で generated symlink と file/directory を区別し、`readdirSync` の実在集合を inventory と突合する。Filesystem traversal は declaration が許可した roots だけを読み、未知 root を無視しない。

- [ ] **Step 3: Write schema closure RED fixtures**

Command/agent frontmatter、`.claude/settings.json` top-level field、permissions field、hook event、matcher entry field、hook command field、`hooks/hooks.json` の同じ階層へ未知 key を一件ずつ加える。各 error が source path、surface kind、unknown key/event を含むことを検査する。

- [ ] **Step 4: Implement semantic decoding**

既存 `yaml.parse` frontmatter parser を decoder へ移す。Command は `description` と body、agent は `name`、`description`、`tools`、`model`、body、hook は event/matcher/command/timeout/statusMessage、plugin metadata は version と両 manifest に共通な identity fields を返す。Decoder は Codex TOML、Codex argument wording、Claude manifest JSON を生成しない。

- [ ] **Step 5: Add known normal cases and freeze checks**

実リポジトリを decode し、全 record が contract validation を通ること、semantic records が frozen であること、同じ入力から決定的な値を返すことを検査する。

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test scripts/lib/harness-source-decoder.test.mjs scripts/lib/harness-inventory.test.mjs scripts/lib/harness-capability-contract.test.mjs`

Expected: all tests pass。

Commit: `feat(plugin): decode harness sources fail closed`

Review trailer: `Review: tool=correctness`

### Task 4: Make the Codex encoder consume semantic records

**Files:**

- Modify: `scripts/lib/gen-codex-assets.mjs`
- Modify: `scripts/lib/gen-codex-assets.test.mjs`

**Interfaces:**

- Replaces raw-text APIs with `commandCapabilityToCodexSkill(record, outputName)`, `agentCapabilityToCodexToml(record)`, and `hookCapabilityToCodexHooks(record)`。
- Keeps pure ownership-notice and repository-instruction transforms where their input is already neutral text content rather than source schema。

- [ ] **Step 1: Rewrite unit fixtures to semantic-record inputs and verify RED**

Command fixture は parsed `description`/`body` を渡し、agent fixture は parsed `name`/`description`/`tools`/`model`/`body` を渡す。Unknown frontmatter tests は Task 3 へ移し、encoder tests は unsupported semantic values と target transformation だけを扱う。

- [ ] **Step 2: Implement record-based command and agent encoding**

既存の output bytes と source-path付き error を保つ。`$ARGUMENTS` の既知変換、agent sandbox mapping、`pfd-implementer` の Codex-only責務境界は encoder の明示 transform として残す。

- [ ] **Step 3: Refactor hook and manifest inputs**

`hookCapabilityToCodexHooks()` は parsed hook semantic value を JSON 化する。`buildCodexPluginManifest()` は decoder が返す shared plugin metadata と `codex-plugin` mapping の manifest field surfaces を入力にし、生成済み Claude manifest を読まない。

- [ ] **Step 4: Verify output identity and commit**

Run: `node --test scripts/lib/gen-codex-assets.test.mjs scripts/lib/harness-source-decoder.test.mjs`

Expected: all tests pass and existing expected Codex text remains unchanged except for newly required repository command skills。

Commit: `refactor(codex): encode neutral capability records`

Review trailer: `Review: tool=design`

### Task 5: Assemble sibling adapters from one decoded record set

**Files:**

- Modify: `scripts/lib/gen-plugin.mjs`
- Modify: `scripts/lib/gen-plugin.test.mjs`
- Modify: `scripts/gen-codex-assets.mjs`

**Interfaces:**

- `assemblePluginDistIndependent()` decodes and validates once, then passes the same `capabilities` value to `assembleClaudeAssets()` and `assembleCodexAssets()`。
- `assembleCodexAssets({ root, codexPluginRoot, capabilities, ... })` no longer accepts or reads `pluginRoot` as a source dependency。
- Both adapter stages return observed logical surfaces for `assertTargetOutputClosure()` before publication。

- [ ] **Step 1: Write orchestration RED tests**

Injected `decodeHarnessCapabilities` を一回だけ呼ぶこと、両 adapter が同一 object identity の records を受け取ること、Codex call options に `pluginRoot` または Claude manifest content が存在しないことを検査する。旧 `assembles Codex assets after the Claude plugin output` test は時間順依存ではなく sibling-input identity test に置き換える。

- [ ] **Step 2: Write direct-source Codex skill staging RED test**

`cpSync` calls に `plugin/pfdsl/skills` を source とするものが一件もないことを検査する。Codex plugin と repository skill tree は capability の source path または generated neutral target から別々に stage し、両方へ command-derived skills を生成することを期待する。

- [ ] **Step 3: Implement parallel adapter staging**

`stageCodexPluginSkillTrees(claudePluginRoot, ...)` を削除し、target mappings を受ける共通 `stageTargetSkillTree()` に置き換える。Generated `pfdsl` skill は declared generated source target から両 Codex target へコピーするが、Claude adapter output object や Claude manifest は入力にしない。

- [ ] **Step 4: Preserve the shared transaction without reintroducing data dependency**

Claude と Codex の stage/publish は同じ top-level transaction で rollback できるままにする。実行順が逐次でも、Codex stage の引数と read paths が Claude output に依存しないことを unit test で固定する。Claude bundle manifest は Claude root のみを hash し、Codex adapter の開始条件として使わない。

- [ ] **Step 5: Add all four target output closure checks**

Maintained source 上の `claude-repository` observed surfaces、Claude stage の `claude-plugin` surfaces、Codex repository stage、Codex plugin stage を同じ helper へ渡す。未知 manifest field、未知 root write、宣言済み output 欠落を publish 前に止める injected fixture を target ごとに一件ずつ追加する。

- [ ] **Step 6: Verify transaction GREEN**

Run: `node --test scripts/lib/gen-plugin.test.mjs scripts/lib/gen-codex-assets.test.mjs scripts/lib/harness-capability-contract.test.mjs scripts/lib/harness-source-decoder.test.mjs`

Expected: current atomic publication/rollback/lock tests pass, Codex source reads never enter `plugin/pfdsl`, and `.agents/skills` includes `pfd-cycle`, `pfd-init`, and `source-command-pfd-retro`。

- [ ] **Step 7: Commit**

Commit: `refactor(plugin): assemble sibling harness adapters`

Review trailers: `Review: tool=design` and `Review: tool=correctness`

### Task 6: Bind every mapping to a target-local consumer probe

**Files:**

- Modify: `scripts/lib/harness-capability-contract.test.mjs`
- Modify: `scripts/lib/gen-plugin.test.mjs`
- Modify: `scripts/lib/gen-codex-assets.test.mjs`

**Interfaces:**

- Test-only `PROBE_FIXTURES` registry maps each declared probe kind to a consumer fixture implementation。
- Contract tests ensure every native/transform mapping references a registered probe kind and no fixture kind is orphaned。

- [ ] **Step 1: Add probe registry coverage RED test**

Contract 全件から probe kinds を抽出し、`PROBE_FIXTURES` keys と集合一致させる。Probe metadata は target を含み、mapping target と異なる target の fixture を参照したら失敗させる。

- [ ] **Step 2: Split current consumer checks by delivery target**

`claude-repository` は maintained source fixture、`claude-plugin` は一時 consumer にコピーした Claude root、`codex-repository` は `.agents/.codex` だけの fixture、`codex-plugin` は Codex plugin root だけの fixtureを読む。各 fixture は sibling root が存在しない状態で走らせる。

- [ ] **Step 3: Add intentional exclusion fixture**

`agent:pfd-lens` と `agent:pfd-implementer` の `codex-plugin` exclusion が非空 reason/impact を返し、Codex plugin root に agent output が混入しないことを検査する。Mapping 自体を除いた variant は Task 1 と同じ missing-mapping error になることも確認する。

- [ ] **Step 4: Verify consumer GREEN and commit**

Run: `node --test scripts/lib/harness-capability-contract.test.mjs scripts/lib/gen-plugin.test.mjs scripts/lib/gen-codex-assets.test.mjs`

Expected: all target-local probes pass without reading a sibling target root。

Commit: `test(plugin): bind target-local consumer probes`

Review trailer: `Review: tool=correctness`

### Task 7: Regenerate outputs and keep drift closure complete

**Files:**

- Modify: `scripts/lib/gen-plugin-trigger.mjs`
- Modify: `scripts/lib/gen-plugin-trigger.test.mjs`
- Generate: `AGENTS.md`
- Generate: `.agents/skills/**`
- Generate: `.codex/**`
- Generate: `plugin/pfdsl/**`
- Generate: `plugin/pfdsl-codex/**`
- Generate: `.claude-plugin/marketplace.json`

**Interfaces:**

- New contract and decoder modules trigger the same `gen-plugin-bulk` drift gate as their generated outputs。
- Tracked generated files are one complete current projection, not manually patched subsets。

- [ ] **Step 1: Add trigger RED assertions**

`scripts/lib/harness-capability-contract.mjs` と `scripts/lib/harness-source-decoder.mjs` が `GEN_PLUGIN_TRIGGER` に一致し、dist-independent import closure coverage test が新 modules を到達可能と判定することを期待する。

- [ ] **Step 2: Extend trigger and verify GREEN**

Run: `node --test scripts/lib/gen-plugin-trigger.test.mjs`

Expected: all tests pass。

- [ ] **Step 3: Regenerate both harness projections**

Run: `make gen-plugin`

Expected: Claude root、Codex root、repository assets が一回の生成で更新される。`git diff -- plugin/pfdsl .claude-plugin/marketplace.json` を確認し、意図しない Claude identity diff があれば実装を修正してから再生成する。

- [ ] **Step 4: Run validator and drift checks**

Run: `claude plugin validate --strict plugin/pfdsl`

Expected: validation succeeds。

Run: `node --test --test-name-pattern='ships a self-contained native skill tree|runs the generated plugin hook through Codex' scripts/lib/gen-plugin.test.mjs`

Expected: the Codex-only consumer validation succeeds without a `.claude` tree or sibling Claude plugin root in the consumer fixture。

Run: `node scripts/gen-plugin-dist-independent.mjs && git diff --exit-code -- AGENTS.md .agents .codex plugin/pfdsl plugin/pfdsl-codex .claude-plugin/marketplace.json`

Expected: exit 0 after tracked generated changes are staged for the commit。

- [ ] **Step 5: Commit source and generated projections together**

Commit: `feat(plugin): enforce harness delivery closure`

Review trailers: `Review: tool=design` and `Review: tool=experience`

### Task 8: Update the runtime PFD and maintenance guidance

**Files:**

- Modify: `.pfdsl/runtime-pipeline.pfdsl`
- Modify: `.pfdsl/runtime-pipeline.md`
- Modify: `.pfdsl/bindings/pfd-retro-patterns/manual-enumeration-check-target.md`
- Generate: `plugin/pfdsl/skills/pfd-retro/references/patterns/manual-enumeration-check-target.md`
- Generate: `plugin/pfdsl-codex/skills/pfd-retro/references/patterns/manual-enumeration-check-target.md`
- Generate: `.agents/skills/pfd-retro/references/patterns/manual-enumeration-check-target.md`

**PFD model:**

- Add artifact `harness_capability_model` for decoded and contract-validated semantic records。
- Add process `decode_harness_capabilities` that consumes `claude_harness_sources`, `harness_inventory`, and `toolchain`, then produces `harness_capability_model`。
- Change `gen_plugin` to consume `harness_capability_model` plus the non-harness generated source artifacts it actually copies, then produce `claude_adapter_output`。
- Change `assemble_codex_plugin` to consume the same `harness_capability_model` plus the generated `pfdsl_skill`/toolchain artifacts it actually copies, then produce `codex_adapter_output` and `codex_repo_assets`。
- Remove `claude_adapter_output >> assemble_codex_plugin`。
- Keep the two adapter outputs converging only at `check_plugin_drift`。

- [ ] **Step 1: Inspect current graph IO before editing**

Run: `node packages/cli/dist/cli.js graph io .pfdsl/runtime-pipeline.pfdsl gen_plugin`

Run: `node packages/cli/dist/cli.js graph io .pfdsl/runtime-pipeline.pfdsl assemble_codex_plugin`

Expected: current output shows the obsolete `claude_adapter_output` input to `assemble_codex_plugin` that this task removes。

- [ ] **Step 2: Edit the PFD backward from adapter outputs**

`codex_adapter_output` と `codex_repo_assets` の実装上の直接入力から edge を再構成する。Process description は逐次実行順でなく、関数引数と filesystem read path で確認した data dependency を記述する。`harness_capability_model` の criteria は contract unit tests と source decoder closure tests で判定可能な形にする。

- [ ] **Step 3: Add the symmetric pre-artifact procedure**

`.pfdsl/runtime-pipeline.md` に、source topology、semantic schema、delivery mapping、output surface を変更する前に四 target の disposition と target-local probe を決める手順を追加する。Claude 起点と Codex 起点の条件を同じ文で扱う。

- [ ] **Step 4: Extend the existing retro pattern instead of adding a new one**

`manual-enumeration-check-target.md` に #956 の generated-output漏れと #981 の四 target mapping/output closure を一つの concrete example として追記する。問いは「宣言集合と実在集合が一致するか」のまま維持する。

- [ ] **Step 5: Validate PFD and prose**

Run: `node packages/cli/dist/cli.js fmt .pfdsl/runtime-pipeline.pfdsl`

Run: `node packages/cli/dist/cli.js check --strict .pfdsl/runtime-pipeline.pfdsl`

Run: `node packages/cli/dist/cli.js graph io .pfdsl/runtime-pipeline.pfdsl decode_harness_capabilities`

Run: `node packages/cli/dist/cli.js graph io .pfdsl/runtime-pipeline.pfdsl gen_plugin`

Run: `node packages/cli/dist/cli.js graph io .pfdsl/runtime-pipeline.pfdsl assemble_codex_plugin`

Run: `node packages/cli/dist/cli.js meta check-links .pfdsl/runtime-pipeline.pfdsl`

Run: `node scripts/check-md-linebreaks.mjs .pfdsl/runtime-pipeline.md .pfdsl/bindings/pfd-retro-patterns/manual-enumeration-check-target.md`

Expected: strict/link/linebreak checks pass, both adapters list `harness_capability_model` as an input, and `assemble_codex_plugin` no longer lists `claude_adapter_output`。

- [ ] **Step 6: Regenerate distributed mirrors and commit**

Run: `make gen-plugin`

Run: `node scripts/check-retro-patterns.mjs`

Expected: pattern canonical and all generated copies agree。

Commit: `docs(pfd): model symmetric harness adapters`

Review trailer: `Review: tool=design`

### Task 9: Final review and acceptance gates

**Files:**

- Review all branch changes against issue #981 and the approved spec。

- [ ] **Step 1: Run focused tests**

Run: `node --test scripts/lib/harness-capability-contract.test.mjs scripts/lib/harness-source-decoder.test.mjs scripts/lib/harness-inventory.test.mjs scripts/lib/gen-codex-assets.test.mjs scripts/lib/gen-plugin.test.mjs scripts/lib/gen-plugin-trigger.test.mjs`

Expected: all tests pass。

- [ ] **Step 2: Run repository build and full relevant checks with bounded logs**

Run: `pnpm -r build > /tmp/issue-981-build-$$.log 2>&1; tail -n 30 /tmp/issue-981-build-$$.log`

Run: `make test`

Run: `make typecheck`

Run: `make check-docs`

Expected: build, tests, typecheck, and documentation checks pass。

- [ ] **Step 3: Run generation identity and consumer validation**

Run: `make gen-plugin > /tmp/issue-981-gen-plugin-$$.log 2>&1; tail -n 30 /tmp/issue-981-gen-plugin-$$.log`

Run: `claude plugin validate --strict plugin/pfdsl`

Run: `git diff --check`

Run: `git status --short`

Expected: generation is deterministic, validators pass, no whitespace error exists, and only issue #981 paths are changed。

- [ ] **Step 4: Perform independent scoped review before the final code commit**

Review the meaningful source diff rather than mechanically generated mirrors. Verify specifically that no Codex read path enters `plugin/pfdsl`, no adapter parses the other's output schema, all four missing-mapping fixtures share one validator, output closure runs before publish, and each probe fixture is target-local。

- [ ] **Step 5: Run pfd-ops terminal gates**

Run: `GH_HOST=github.com node scripts/cycle-status.mjs --issue 981`

Run: the exact `gateCheckCommand` emitted by that fresh `cycle-status` result。

Expected: issue reference, artifact gates, and cycle status are green; no release or issue-close action is taken。

- [ ] **Step 6: Prepare branch handoff**

Parent agent stages any final review-only adjustment, creates the final logical commit if needed, pushes the existing issue branch, and previews the PR body before any new PR creation. Stop at a reviewable PR; merge and issue close remain human actions。

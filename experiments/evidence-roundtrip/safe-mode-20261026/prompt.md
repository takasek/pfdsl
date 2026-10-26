# E0 safe-mode trial protocol (2026-10-26)

Generate a small Node ES module driver (aim for at most 90 nonblank lines). Return only executable JavaScript source, without Markdown fences. Do not call tools, read other material, consult skills, or delegate while generating it.
The file will be saved as experiments/evidence-roundtrip/safe-mode-20261026/driver.mjs in the target checkout. The parent will inspect it before execution.
Target checkout: `CHECKOUT_ROOT`.
Selected process: i542_migrate_spec_id_refs; work item: 542; output: spec_id_refs. Do not select a different process.
The task is a real, limited part of issue #542's staged migration: add (SPEC_single_producer_constraint) to the exact heading `### 15.1 単一生成元制約` in docs/spec/spec.md, and replace exactly the two section references whose literal text is §15.1 and which are not followed by another digit or a period (never match §15.10 through §15.17) with [[SPEC_single_producer_constraint]]. Preserve the section's normative text and every other reference. This does not complete Stage 1 or issue #542. The output must remain wip, never done; its unchanged criteria still require all section references to be migrated.

Only these target files may change: docs/spec/spec.md and .pfdsl/roadmap.pfdsl. Only your own trial directory may receive execution records (checks.json, evidence.json, result.json). Do not overwrite snapshot.json, ready.json, capture-plan.json, protocol.md, prompt.md, or pins.json. Do not perform any Git mutation or external write.
Execution data type: snapshot.json and captureResult both have {modelSource, ready, artifacts, versions}; artifacts is a map from relative path to SHA-256 digest or null. There is no manifest field. Compare preSnapshot.artifacts[path] with postSnapshot.artifacts[path] for each frozen key. Do not save or create a new snapshot file.
Use Node fs, path, crypto, child_process modules; use execFileSync/spawnSync with argument arrays, never a shell. Derive the trial directory from import.meta.url. Import snapshot and captureResult from ../check.mjs (the existing read-only checker).
Before work: read frozen snapshot.json and ready.json beside the driver; independently run `node packages/cli/dist/cli.js status ready .pfdsl/roadmap.pfdsl --json` in the target checkout and require ok=true and the selected process in both ready sets. Require captureResult(preSnapshot,target).versions to match all three preSnapshot.versions before writing anything. CaptureResult reads only the frozen manifest; snapshot(source,[],artifacts) computes the three hashes. If a precondition fails, stop with nonzero exit; do not change any target file or return a fabricated success.
Verify the new ID is absent before changing the spec: `node scripts/get-spec-id.mjs SPEC_single_producer_constraint` must exit 1 with a not-defined diagnostic; `node scripts/mint-check.mjs single_producer_constraint` must exit 0. Record both results. Require the heading and two replacement sites to occur exactly once and twice respectively.
At the start of actual work, use the existing CLI `node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl spec_id_refs status wip`. Apply the heading and reference changes to the spec. Then require `node scripts/check-spec-ids.mjs` and `node scripts/get-spec-id.mjs SPEC_single_producer_constraint` to exit 0, and verify that the fetched block contains the unchanged single-producer rule and stops before section 15.2. Save command arguments, statuses, stdout/stderr and these assertions in checks.json. A failed check must stop the run; do not claim criteria acceptance.
Capture the actual final snapshot with captureResult(preSnapshot,target); compute changedPaths by comparing pre/post manifest values. Evidence JSON must contain schemaVersion:0, nonempty runId, processId, workItemIds:['542'], versions:preSnapshot.versions, resultVersions:postSnapshot.versions, changedPaths, transitions:[{artifactId:'spec_id_refs',from:'todo',to:'wip'}], acceptanceEvidence:['experiments/evidence-roundtrip/safe-mode-20261026/checks.json'], and deviations:[{type:'unchanged',reason:'No model revision is requested: issue #542 explicitly allows staged migration; only the section 15.1 cluster was migrated and the complete artifact criteria remain unmet, so spec_id_refs stays wip.'}].
Write evidence.json, then execute the actual checker `node experiments/evidence-roundtrip/check.mjs <trial-evidence.json> <trial-snapshot.json> <target-checkout>`. The second checker argument MUST be the original frozen snapshot.json beside the driver, never an after snapshot. Save its JSON output in result.json and require exit 0 and status PASS. This PASS verifies the recorded run, not the full artifact's acceptance. Print a brief result and propagate failures with a nonzero exit.
The checker matches the fixed ready process, criteria presence, work item, pre/post versions, changed paths, ordered experimental status transitions and final status. It does not prove semantic criteria fulfillment, unreported changes outside the capture scope, authorization, or actor causality. The parent separately reviews the actual diff and generation input. No new CLI status-changing verb is allowed.

## Frozen CLI outputs

CLI --version:

```text
0.2.0
```

CLI meta get selected process and output:

```text
i542_migrate_spec_id_refs.label: spec.md 仕様ID参照移行
i542_migrate_spec_id_refs.description: spec.md の節番号相互参照を仕様ID参照へ段階移行する。クラスタ単位の段階計画（§15 制約 → §2.x 意味論 → 残り）は #542 が一次情報
i542_migrate_spec_id_refs.location: https://github.com/takasek/pfdsl/issues/542
i542_migrate_spec_id_refs.location.resolved: https://github.com/takasek/pfdsl/issues/542
spec_id_refs.label: 仕様ID相互参照化済み spec.md
spec_id_refs.description: 節番号直書きの相互参照を仕様ID参照へ段階移行した spec.md。ADR 確定後に別 issue として起票する（#328 移行方針）。後続門番のプレースホルダ（ADR-0018）
spec_id_refs.status: todo
spec_id_refs.criteria: docs/spec/spec.md の節番号相互参照が仕様ID参照に置換され、node scripts/check-spec-ids.mjs が dangling 参照なしで通過する
spec_id_refs.location: ../docs/spec/spec.md
spec_id_refs.location.resolved: CHECKOUT_ROOT/docs/spec/spec.md
```

CLI status ready --json:

```json
{
  "ok": true,
  "ready": [
    {
      "id": "publish_cli_ready_counts",
      "label": "新規 ready 数を示す CLI と plugin を公開する",
      "inputs": [
        "boundary_transition_release_policy",
        "ready_counts_cli"
      ],
      "outputs": [
        "cli_release_ready_counts"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "i542_migrate_spec_id_refs",
      "label": "spec.md 仕様ID参照移行",
      "inputs": [
        "get_by_id_tool",
        "mint_check_tool",
        "spec_id_syntax",
        "spec_v0011"
      ],
      "outputs": [
        "spec_id_refs"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "publish_cli_group_delete",
      "label": "CLI group 削除公開",
      "inputs": [
        "boundary_transition_release_policy",
        "group_delete_cli"
      ],
      "outputs": [
        "cli_release_group_delete"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "publish_cli_meta_set_extension",
      "label": "CLI 拡張フィールド更新公開",
      "inputs": [
        "boundary_transition_release_policy",
        "meta_set_extension_fields"
      ],
      "outputs": [
        "cli_release_meta_set_extension"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "publish_cli_group_node_clash",
      "label": "CLI 同名診断公開",
      "inputs": [
        "boundary_transition_release_policy",
        "group_node_clash_diagnostic"
      ],
      "outputs": [
        "cli_release_group_node_clash"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "publish_cli_edge_kind_conflict",
      "label": "CLI input / feedback 併記診断公開",
      "inputs": [
        "boundary_transition_release_policy",
        "edge_kind_conflict_diagnostic"
      ],
      "outputs": [
        "cli_release_edge_kind_conflict"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "i1262_i1445_accept_mac_candidate",
      "label": "Mac の受入済み候補を作る",
      "inputs": [
        "preview_editing_usability",
        "standalone_pfd_features"
      ],
      "outputs": [
        "gui_mac_acceptance"
      ],
      "newlyReadyCount": 1
    },
    {
      "id": "i1445_accept_gui_vscode",
      "label": "VS Code 統合版の公開範囲を実機受入する",
      "inputs": [
        "gui_vscode_candidate"
      ],
      "outputs": [
        "gui_vscode_acceptance"
      ],
      "newlyReadyCount": 1
    },
    {
      "id": "narrow_retro_to_model",
      "label": "pfd-retro を model retro に絞る",
      "inputs": [
        "responsibility_boundary_adr",
        "root_loaded_work_rules"
      ],
      "outputs": [
        "three_valued_model_retro"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "move_writer_rules_out_of_github_preset",
      "label": "GitHub Issues プリセットから書込み規律と PR 運用を外す",
      "inputs": [
        "responsibility_boundary_adr",
        "root_loaded_work_rules"
      ],
      "outputs": [
        "writer_free_github_preset"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "add_prune_cli",
      "label": "完了チェーン回収を CLI 動詞にする",
      "inputs": [
        "responsibility_boundary_adr"
      ],
      "outputs": [
        "prune_cli"
      ],
      "newlyReadyCount": 0
    },
    {
      "id": "i1542_define_artifact_reference",
      "label": "モデルと artifact の参照先の仕様を定める",
      "inputs": [
        "responsibility_boundary_adr",
        "toolchain"
      ],
      "outputs": [
        "artifact_reference_spec"
      ],
      "newlyReadyCount": 1
    }
  ]
}
```

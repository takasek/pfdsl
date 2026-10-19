# Native ownership acceptance: issue #1398

Public acceptance summary, finalized on 2026-10-19.
This report covers the current five acceptance criteria of [#1398](https://github.com/takasek/pfdsl/issues/1398).
The separate file/MCP policy acceptance in [#1404](https://github.com/takasek/pfdsl/issues/1404) remains open.
Local evidence paths, account names and native conversation identifiers are omitted.

## Contract and tested versions

The old PR #1413 contract was compared with the replacement PR #1437 decision table before live acceptance.
The accepted contract is [ADR-0047](adr/0047-agent-operation-decision-table.md), with native evidence defined in [ADR-0046](adr/0046-native-worktree-ownership.md).
PR #1437 was already merged; this publication adds acceptance records and regression tests, not a new guard implementation.

The initial tested main revision was `266cbb3196de6d274353b9d6ce91befb424e45f2`.
The final Claude capture used `b8302af901c696f01b55e640b0510142ac282989`.
The 20 guard dependency files matched across these tested revisions and both final Claude worktrees.
Claude Desktop executions used Claude Code 2.1.295 for the earlier parent/child commits and 2.1.299 for the final native Git input capture.
The Desktop application version was not collected for the final capture.
The initial Codex Desktop execution used application 26.1007.30912 and runtime 0.162.0-alpha.17.2; later lifecycle runs were recorded separately, including application 26.1007.71326.

## Acceptance criteria

| Criterion | Observed evidence and result |
| --- | --- |
| Claude parent and subagent own add/commit | Fresh native EnterWorktree allocation allowed parent and foreground general-purpose child file creation, normal add/commit, and parent cleanup commit. The final tree and index were clean. Three additional Git calls captured parent add, child add and a peer negative with unchanged tracked README content. |
| Codex parent/child ownership and responsibility | Native hook session identity matched version 1 ownerThreadId. Shell child identity was distinguished from the parent session. Child ordinary file operations succeeded; Git metadata and outward changes were returned to the parent. Child Git success was not required. |
| Own work and protected destinations | Both harnesses allowed representative own work and denied other-owner changes, default/main operations and verification bypass. A separate live Codex owner was correlated with its current identity and active turn. Final Claude peer PID/start and locks were checked before and after the negative call. |
| Evidence states and lifecycle fallback | Representative fresh, resumed, managed-outside, fork and handoff paths were measured. Missing, unreadable, malformed, unknown-version and mismatched evidence were distinguished from positive ownership. Known failures and the selected manual fallback are retained below. |
| Regression fixtures and evidence separation | Three normalized fixture files retain captured field presence and identity relationships. Guard-entry replay and native-owner unit tests pass: 21 tests. Independent reviews checked source captures, native tool IDs, normalization, test consumers and the five-criterion mapping. |

## Final Claude Git capture

Two separate fresh native sessions created an owner and a live peer.
Their native lock PID/start values matched the corresponding live processes before and after the observation window.
Both worktrees retained their original HEAD and branch, with empty status and index.
A permission-neutral temporary observer captured exactly three selected inputs.

1. Parent: literal absolute-C add of the unchanged tracked README succeeded.
2. Foreground general-purpose child: the same own add succeeded.
3. Parent: one literal cd-to-peer AND-list with absolute-C peer add was denied by PreToolUse with the assigned-worktree reason and human-terminal recovery.

All three inputs shared the native session_id and own cwd; only the child had agent_id and agent_type.
CLAUDE_PROJECT_DIR remained the primary checkout, while the observer process cwd was own.
The observer's direct parent matched the owner lock PID; the peer used a different live PID/start.
All three tool-use identities were matched to native parent or child transcript calls and results.
The peer Git command was not executed; the entire AND-list was denied before execution.

The successful native results had is_error:false and no numeric exit-code field.
README was unchanged according to Git; independent before/after byte hashes were not collected.
Parent read calls were batched, the final worktree-list command added a grep pipe, and the native auto-mode classifier denied the post-operation PPID read.
Strict sequential reading and the parent's own post-PPID confirmation therefore remain unestablished.
Other post-read calls were issued before that denial returned; coordinator poststate checks are separate evidence.
No additional Git attempts or permission changes were used to repair these deviations.
The observer was removed and original local-setting bytes/mode and formal guard files were verified unchanged.

## Known limits and accepted fallback

Claude Desktop direct resume into the old worktree still failed own Write; subsequent checks found no native assignment lock.
ExitWorktree keep followed by EnterWorktree with an existing path did not restore a lock at the observation point.
The user selected a manual fallback: preserve the old worktree/history, allocate a fresh native name, and transfer the preserved work.
That fallback was verified by importing one preserved commit's content, normal commit, cleanup commit and final-tree equality.
It does not establish recovery of direct same-worktree resume.

Malformed/unreadable metadata, unknown versions and PID/start mismatch retain conservative denial in local tests; a live Cartesian product of every malformed state was not run.
Native current assignment remains necessary; current cwd, arbitrary ancestors and handmade ownership evidence are not substitutes.
Codex version 1 metadata identifies the owner but does not alone establish its liveness.
Fresh/resumed managed-outside sessions, same-directory fork, worktree fork and both handoff directions were measured as representative paths, not universal future compatibility.
Claude read-only cd was reset by the harness; denied cd-and-add calls do not prove an actual or persistent cwd change.

## Reproducible regression coverage

Normalized captures are in `scripts/lib/__fixtures__/claude-native-git-hook-inputs-2026-10-19.json`, `codex-managed-outside-hook-inputs-2026-10-15.json` and `codex-resumed-child-hook-inputs-2026-10-15.json`.
The guard integration test consumes the captured Claude lock-reason structure and rebinds physical roots and current test-process PID/start in disposable repositories.
Missing/removed ownership evidence denies; qualifying own parent/child operations allow; the different peer target denies.
This replay is synthetic regression evidence, not another Desktop lifecycle run or a CI result.

After normal setup, the focused local verification command is:

```sh
node --test scripts/agent-operation-guard.test.mjs scripts/lib/native-worktree-owner.test.mjs
```

The final local result was 21/21 passing, with independent review and a normal pre-commit check.
Private raw evidence remains local; source-capture hashes and normalization limits are retained in the fixtures.

## Separate work in #1404

#1404 retains MCP integration-class decisions and individual-hook aggregation/contribution evidence, plus the remaining file/content-policy coverage.
An earlier merge-tool refusal was attributable to the personal publication guard and is not evidence of the repository hook's individual contribution.
Foreign file writes preempted by native isolation are not upgraded to repository-hook-only refusals.
The user-selected isolated fault lab completed policy-import failure, supervisor-import failure and synchronous-stall denial, human restoration and successful recovered Write.
That result does not establish fault injection into the live production configuration or cure Claude's direct-resume failure.
Remaining #1404 work is handed off separately; it is not an additional condition for closing #1398.

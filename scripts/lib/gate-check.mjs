/**
 * Pure functions for terminal-gate aggregate checking.
 * Process/git I/O lives in the main script; this module stays testable.
 */

import { isGhUnavailableError } from "../pfdsl/lib/gh-compat.mjs";
import { trailerLines } from "./commit-trailers.mjs";
import { PATTERN_DIR_RELATIVE } from "./retro-patterns.mjs";

/**
 * Every repo-relative path an adopted PFD claims to model, via the `location:`
 * field its artifacts and processes carry (#778). This is what lets the
 * terminal gate's "did you reflect the change in the PFD that models it" item
 * say which of a cycle's changed files any PFD models at all — without that,
 * a change in an unmodeled area (the check scripts, historically) and a change
 * someone judged irrelevant both come out as the same silent "N/A".
 *
 * `resolveLocation` is injected rather than written here because spec §15.8
 * owns what a `location:` resolves to (the file's own directory, or the
 * frontmatter's `basePath` when it has one) and @pfdsl/core already implements
 * it — a second reading of that rule here would be free to drift from the one
 * the CLI applies. It returns null for anything that names nothing in the tree
 * (a URL), which is also core's classification.
 * @param {Array<{file: string, frontmatter: {artifact?: object, process?: object, basePath?: string}}>} analyzed
 * @param {(file: string, location: string, basePath?: string) => string|null} resolveLocation
 * @returns {Array<{path: string, file: string, id: string}>}
 */
export function collectModeledLocations(analyzed, resolveLocation) {
	const modeled = [];
	for (const { file, frontmatter } of analyzed) {
		const nodes = {
			...(frontmatter?.artifact ?? {}),
			...(frontmatter?.process ?? {}),
		};
		for (const [id, meta] of Object.entries(nodes)) {
			if (!meta?.location) continue;
			const locations = Array.isArray(meta.location)
				? meta.location
				: [meta.location];
			for (const location of locations) {
				const resolved = resolveLocation(file, location, frontmatter?.basePath);
				if (resolved === null) continue;
				// Path resolution normalizes a trailing slash away, and that slash
				// is the only mark distinguishing a directory location from a file
				// one, so it is carried over from what was written.
				modeled.push({
					path: location.endsWith("/") ? `${resolved}/` : resolved,
					file,
					id,
				});
			}
		}
	}
	return modeled;
}

/**
 * Split a cycle's changed files by whether any adopted PFD models them (#778).
 * Report material, not a verdict: whether a modeled path's change actually
 * needed the PFD updated, and whether an unmodeled one should have been in a
 * PFD at all, are both judgments the gate leaves to the reader.
 * @param {string[]} changedFiles repo-relative
 * @param {Array<{path: string, file: string, id: string}>} modeledLocations
 * @returns {{modeled: Array<{path: string, models: Array<{file: string, id: string}>}>, unmodeled: string[]}}
 */
export function classifyChangedFilesByModeling(changedFiles, modeledLocations) {
	const modeled = [];
	const unmodeled = [];
	for (const path of changedFiles) {
		const models = modeledLocations
			.filter((location) =>
				location.path.endsWith("/")
					? path.startsWith(location.path)
					: path === location.path,
			)
			.map(({ file, id }) => ({ file, id }));
		if (models.length > 0) modeled.push({ path, models });
		else unmodeled.push(path);
	}
	return { modeled, unmodeled };
}

/**
 * @param {string[]} files
 * @param {RegExp} pattern
 * @returns {boolean}
 */
export function matchesTrigger(files, pattern) {
	return files.some((f) => pattern.test(f));
}

// audit-issues-flow.mjs exits with this code when the gh CLI is unavailable
// (ENOENT), distinct from exit code 1 (real findings) — see #489, #492.
export const AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE = 2;

/**
 * Map an `node scripts/pfdsl/audit-issues-flow.mjs` subprocess result to a
 * gate-check row. Exit code 2 (gh CLI unavailable) degrades to SKIP instead
 * of FAIL, so a missing gh binary doesn't get conflated with an actual
 * roadmap/issue sync drift.
 * @param {boolean} ok
 * @param {number|undefined} exitStatus
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifyAuditIssuesFlowResult(ok, exitStatus) {
	if (ok) return { status: "PASS" };
	if (exitStatus === AUDIT_ISSUES_FLOW_GH_UNAVAILABLE_EXIT_CODE) {
		return {
			status: "SKIP",
			detail: "gh CLI unavailable; GitHub-dependent checks skipped (see #492)",
		};
	}
	return {
		status: "FAIL",
		detail: "re-run: node scripts/pfdsl/audit-issues-flow.mjs (findings)",
	};
}

/**
 * @param {Array<{name: string, status: 'PASS'|'FAIL'|'SKIP', detail?: string}>} results
 * @returns {string}
 */
export function formatGateTable(results) {
	const symbol = (status) =>
		status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "-";
	return results
		.map(
			(r) =>
				`  ${symbol(r.status)} ${r.status.padEnd(4)} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`,
		)
		.join("\n");
}

/**
 * One line reporting which tree this gate actually ran against (#840).
 *
 * A worktree session's shell cwd can drift back to the main checkout between
 * commands; a gate run there is silently checking a tree without the
 * branch's changes, and a PASS from it reads exactly like a PASS from the
 * worktree. This does not stop that run (verification-tree-guard.mjs's
 * PreToolUse hook does, for the paths it can see) — it prints where the run
 * happened, so a run that slipped past that guard (e.g. inside a subagent) is
 * still checkable after the fact.
 * @param {{root: string, mainRoot: string, branch: string | null}} params
 *   - root: the tree gate-check actually inspected (its own script location,
 *     not cwd — see the call site for why those can differ).
 *   - mainRoot: the repo's main checkout, from `git rev-parse --git-common-dir`.
 *   - branch: the branch checked out at `root`, or null when it could not be
 *     resolved (detached HEAD, or the git calls failed).
 * @returns {string}
 */
export function formatRunTreeLine({ root, mainRoot, branch }) {
	const treeKind = root === mainRoot ? "main checkout" : "linked worktree";
	const branchLabel = branch ? `branch ${branch}` : "branch unresolved";
	return `gate-check: running in ${treeKind} (${root}), ${branchLabel}`;
}

/** Shared by both checks scoped to the output artifact, so they cannot drift apart. */
export const NO_ARTIFACT_DETAIL =
	"cycle declared it has no roadmap output artifact (--no-artifact)";

/** Shared by both checks that read the linked issue, for the same reason. */
export const NO_ISSUE_DETAIL =
	"no --issue given; pass --issue <n> to check this against the linked issue";

/**
 * Why an issue lookup failed, and what that costs the issue's rows.
 *
 * Every failure used to read "gh CLI unavailable", which is true of exactly one
 * of them. The other two — gh running and answering with an error, and the REST
 * fallback returning a shape JSON.parse rejects — wore a sentence naming a
 * cause that was not theirs, and took a SKIP that the reader had every reason
 * to attribute to their environment (#745).
 *
 * Only a missing binary degrades to SKIP, matching the vocabulary
 * classifyAuditIssuesFlowResult already uses for the same environment (#489):
 * a repo whose sessions have no gh cannot be asked to fail on its absence.
 * Anything else FAILs — the check did not run, and a row nobody acts on is how
 * that goes unnoticed for a whole cycle.
 * @param {{code?: string, message?: string}} error
 * @returns {{status: 'SKIP'|'FAIL', detail: string}}
 */
export function classifyIssueLookupFailure(error) {
	// The same predicate execGh uses to decide whether a REST fallback is even
	// possible, rather than a second spelling of ENOENT that could drift from it.
	if (isGhUnavailableError(error)) {
		return { status: "SKIP", detail: "gh CLI unavailable" };
	}
	return {
		status: "FAIL",
		detail: `issue lookup failed: ${error?.message ?? String(error)}`,
	};
}

/**
 * Classify the output-artifact status-update gate (item 6). No new states:
 * this reuses the existing reasoned-SKIP vocabulary the same way item 9
 * (wip transition) already does for the no-roadmap-change case.
 * @param {{artifactKey?: string, noArtifact?: boolean, roadmapChanged?: boolean, changed?: boolean}} params
 *   - artifactKey: the --artifact CLI flag value, if given.
 *   - noArtifact: the cycle declared it owns no output artifact (--no-artifact).
 *     Wins over everything else — it is a statement about the work, not the diff.
 *   - roadmapChanged: whether .pfdsl/roadmap.pfdsl appears in the changed-files list.
 *     Only consulted when artifactKey is absent.
 *   - changed: whether a status: change was detected (precise per-artifact
 *     check when artifactKey is set, presence-only fallback otherwise).
 *     Not evaluated (may be undefined) in the SKIP case.
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifyOutputArtifactStatus({
	artifactKey,
	noArtifact,
	roadmapChanged,
	changed,
}) {
	// A declaration beats inference. Bookkeeping cycles (a rename, a location:)
	// touch roadmap.pfdsl without owning an output artifact, and no reading of
	// the diff distinguishes those from a cycle that forgot its status update —
	// the check FAILed on every one of them, which is how a gate stops being read.
	if (noArtifact) {
		return { status: "SKIP", detail: NO_ARTIFACT_DETAIL };
	}
	if (!artifactKey && !roadmapChanged) {
		return {
			status: "SKIP",
			detail:
				"work item has no roadmap output artifact (roadmap.pfdsl untouched); " +
				"if this is roadmap-managed work, pass --artifact <key> for a strict check",
		};
	}
	if (artifactKey) {
		return {
			status: changed ? "PASS" : "FAIL",
			detail: changed
				? undefined
				: `no status: change detected for artifact '${artifactKey}'`,
		};
	}
	return {
		status: changed ? "PASS" : "FAIL",
		detail: changed
			? "presence-only check; pass --artifact <key> to verify the specific output artifact"
			: "no status: line changed in .pfdsl/roadmap.pfdsl — pass --artifact <key>, or --no-artifact if this cycle produces none",
	};
}

/**
 * Coarse fallback: true if *any* status: line changed anywhere in the diff.
 * Does not verify the change belongs to a specific artifact — pass an
 * --artifact key to the CLI and use statusChangedForArtifact for that.
 * @param {string} diffText - unified diff of .pfdsl/roadmap.pfdsl
 * @returns {boolean}
 */
export function hasStatusChange(diffText) {
	return diffText.split("\n").some((line) => {
		if (line.startsWith("--- ") || line.startsWith("+++ ")) return false;
		return /^[+-]/.test(line) && /status:/.test(line);
	});
}

/**
 * Extract a specific artifact's status: value from a full-file snapshot of
 * .pfdsl/roadmap.pfdsl.
 * @param {string} text
 * @param {string} artifactKey
 * @returns {string | undefined}
 */
export function extractArtifactStatus(text, artifactKey) {
	const block = text.match(
		new RegExp(`\\n {2}${artifactKey}:\\n([\\s\\S]*?)(?=\\n {2}\\S+:\\n|$)`),
	);
	if (!block) return undefined;
	const status = block[1].match(/status:\s*(\S+)/);
	return status ? status[1] : undefined;
}

/**
 * Precise check: did a specific artifact's status: value change between two
 * full-file snapshots of .pfdsl/roadmap.pfdsl?
 * @param {string} beforeText
 * @param {string} afterText
 * @param {string} artifactKey
 * @returns {boolean}
 */
export function statusChangedForArtifact(beforeText, afterText, artifactKey) {
	return (
		extractArtifactStatus(beforeText, artifactKey) !==
		extractArtifactStatus(afterText, artifactKey)
	);
}

/**
 * Was the artifact (or, without a key, any artifact) ever in status: wip
 * across a sequence of full-file snapshots of .pfdsl/roadmap.pfdsl — one
 * per commit that touched the file? Verifies protocol4's "todo→wip at
 * start" step was actually exercised, not just the final done transition.
 * @param {string[]} fileSnapshots
 * @param {string} [artifactKey]
 * @returns {boolean}
 */
export function wipTransitionDetected(fileSnapshots, artifactKey) {
	if (artifactKey) {
		return fileSnapshots.some(
			(text) => extractArtifactStatus(text, artifactKey) === "wip",
		);
	}
	return fileSnapshots.some((text) => /status:\s*wip/.test(text));
}

/**
 * Path trigger for the vscode-extension typecheck gate (roadmap.md
 * "vscode-extension を変更した場合" note). Mirrors GEN_PLUGIN_TRIGGER's
 * trigger-then-run shape.
 */
export const VSCODE_EXT_TRIGGER = /^packages\/vscode-extension\//;

// Conventional Commits subject line: type(scope)!: description.
// Scope and ! are optional; type must be one of the conventional set.
const CONVENTIONAL_COMMIT_PATTERN =
	/^(feat|fix|refactor|docs|chore|test|style|perf|build|ci|revert)(\([\w.,/-]+\))?!?: .+/;

// CJK punctuation through unified ideographs, plus fullwidth forms — the
// marker this repo's commit-language rule (CLAUDE.md: messages are English)
// can be checked by. "Is this English" is not mechanically decidable; "does
// this carry Japanese" is. One contiguous range rather than kana and
// ideographs separately: what sits between the obvious blocks — iteration
// marks, halfwidth katakana — is just as Japanese as the blocks.
//
// Deliberately not shared with graphviz-exporter's CJK_RE, which spans a
// similar range for an unrelated reason (the wasm Graphviz measures these
// glyphs at ASCII width). Tying the two together would drag this rule along
// whenever font metrics change.
const CJK_PATTERN = /[　-鿿＀-￯]/u;

// Backtick and double-quote spans are exempt: a subject may legitimately quote
// a Japanese identifier or heading that exists in the tree. Measured over this
// repo's 1795 non-merge subjects, 7 carry CJK and 1 of those is such a quote.
const QUOTED_SPAN_PATTERN = /`[^`]*`|"[^"]*"/g;

/**
 * Lint commit subjects against the Conventional Commits format and the
 * English-language rule (message format and language only — commit
 * granularity is a judgment call left to code review).
 * @param {string[]} subjects
 * @returns {Array<{subject: string, ok: boolean, reason?: string}>}
 */
export function lintCommitSubjects(subjects) {
	return subjects.map((subject) => {
		if (!CONVENTIONAL_COMMIT_PATTERN.test(subject)) {
			return { subject, ok: false, reason: "not Conventional Commits" };
		}
		if (CJK_PATTERN.test(subject.replace(QUOTED_SPAN_PATTERN, ""))) {
			return {
				subject,
				ok: false,
				reason: "non-English text outside quoted spans",
			};
		}
		return { subject, ok: true };
	});
}

/**
 * Parse a `<label> a, b, c` list line out of `pfdsl graph io` text output.
 * @param {string} auditText
 * @param {string} label line prefix, including its trailing colon
 * @returns {string[]}
 */
function parseAuditLine(auditText, label) {
	const line = auditText.split("\n").find((l) => l.startsWith(label));
	if (!line) return [];
	return line
		.slice(label.length)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Parse the `terminal artifacts: a, b, c` line out of `pfdsl graph io`
 * text output.
 * @param {string} auditText
 * @returns {string[]}
 */
export function parseAuditTerminals(auditText) {
	return parseAuditLine(auditText, "terminal artifacts:");
}

/**
 * Parse the `external-stakeholder terminals: a, b, c` line out of
 * `pfdsl graph io` text output — terminals kept out of the plain
 * `terminal artifacts:` line solely because they declare a non-empty
 * externalStakeholders.
 * @param {string} auditText
 * @returns {string[]}
 */
export function parseAuditExternalTerminals(auditText) {
	return parseAuditLine(auditText, "external-stakeholder terminals:");
}

/**
 * Terminal artifacts present after a change but not before — candidates for
 * the follow-up gatekeeper (protocol5(b)): classify each as means or
 * deliverable, and register a todo consumer if a means artifact lacks one.
 * @param {string[]} beforeTerminals
 * @param {string[]} afterTerminals
 * @returns {string[]}
 */
export function diffNewTerminals(beforeTerminals, afterTerminals) {
	const before = new Set(beforeTerminals);
	return afterTerminals.filter((t) => !before.has(t));
}

/**
 * Artifact ids consumed by a normal `>>` input edge, read out of a
 * `pfdsl graph edges --json` payload (#671).
 *
 * Feedback (`>>?`) edges are deliberately excluded: `graph io`'s `terminals`
 * is the spec's **audit-terminal** (§15.11), which ignores feedback
 * consumption, so counting a sibling's feedback edge as consumption would
 * classify the same artifact differently depending on which file its
 * feedback consumer happens to sit in.
 *
 * An unparseable or failed payload yields no consumers, which leaves the
 * caller's terminals reported as terminal — the pre-#671 behaviour, i.e. the
 * side that asks for a look rather than the side that stays silent.
 * @param {string} edgesJson stdout of `pfdsl graph edges <file> --json`
 * @returns {string[]} consumed artifact ids, first-seen order, deduplicated
 */
export function parseInputConsumedArtifacts(edgesJson) {
	let payload;
	try {
		payload = JSON.parse(edgesJson);
	} catch {
		return [];
	}
	if (!payload?.ok || !Array.isArray(payload.edges)) return [];
	const consumed = new Set();
	for (const e of payload.edges) {
		if (e?.kind === "input" && typeof e.artifact === "string") {
			consumed.add(e.artifact);
		}
	}
	return [...consumed];
}

/**
 * Directories whose sibling `.pfdsl` files share one artifact-id namespace,
 * i.e. where "same id means the same artifact" holds (#671).
 *
 * This is a convention of *this repo's* operational PFD set, not a spec rule
 * — spec §2.9.1 keeps ids file-local precisely so that unrelated graphs may
 * reuse a name. `docs/samples/` is the counterexample that forces the list to
 * exist rather than composing every directory: its diagrams are mutually
 * unrelated tutorials that reuse `spec` / `code` freely, so composing them
 * would file a genuine gatekeeper violation under the sibling heading.
 */
export const SIBLING_ID_NAMESPACE_DIRS = [".pfdsl"];

/**
 * Whether sibling `.pfdsl` files in `dir` may be composed for the terminal
 * report (#671).
 * @param {string} dir repo-relative directory, as `path.dirname` yields it
 * @returns {boolean}
 */
export function sharesSiblingIdNamespace(dir) {
	return SIBLING_ID_NAMESPACE_DIRS.includes(dir);
}

/**
 * For each file, the artifacts consumed by *every other* file in the set
 * (#671). Callers hand over the already-parsed per-file consumer lists, so
 * the N graphs are parsed N times rather than N² — and so this stays a pure
 * function the tests can drive without git or the CLI.
 * @param {Iterable<[string, string[]]>} perFileConsumed file → consumed ids
 * @returns {Map<string, string[]>} file → ids consumed by the other files
 */
export function buildSiblingConsumedMap(perFileConsumed) {
	const entries = [...perFileConsumed];
	const byFile = new Map();
	for (const [file] of entries) {
		const union = new Set();
		for (const [other, consumed] of entries) {
			if (other === file) continue;
			for (const a of consumed) union.add(a);
		}
		byFile.set(file, [...union]);
	}
	return byFile;
}

/**
 * Split new terminal artifacts by whether a sibling graph consumes them
 * (#671). Splitting the report is the whole point: ADR-0035 moved the
 * generation chain into `pipeline.pfdsl`, so a generation source
 * declared in `workflow.pfdsl` is terminal *in its own file* while its real
 * consumer sits next door. Reporting those together with genuinely
 * unconsumed artifacts buries real gatekeeper violations among known-benign
 * entries.
 *
 * Neither partition is a PASS/FAIL: classifying an artifact as means vs.
 * deliverable stays MANUAL, and a sibling-consumed entry still needs the
 * claimed edge confirmed before it is recorded as N/A.
 * @param {string[]} newTerminals
 * @param {string[]} consumedInSiblings artifact ids consumed by sibling graphs
 * @returns {{terminal: string[], consumedInSibling: string[]}}
 */
export function partitionNewTerminals(newTerminals, consumedInSiblings) {
	const consumed = new Set(consumedInSiblings);
	return {
		terminal: newTerminals.filter((t) => !consumed.has(t)),
		consumedInSibling: newTerminals.filter((t) => consumed.has(t)),
	};
}

/**
 * Diff two `ready --json` process-id sets (workcycle step 4's "released
 * follow-up processes / updated ready set" report), derived mechanically
 * instead of via AI graph traversal.
 * @param {string[]} beforeIds
 * @param {string[]} afterIds
 * @returns {{newlyReady: string[], noLongerReady: string[]}}
 */
export function diffReadySets(beforeIds, afterIds) {
	const before = new Set(beforeIds);
	const after = new Set(afterIds);
	return {
		newlyReady: afterIds.filter((id) => !before.has(id)),
		noLongerReady: beforeIds.filter((id) => !after.has(id)),
	};
}

export const MANUAL_GUIDANCE_LINES = [
	"MANUAL: Before creating the PR, review `3. 反映 — 終端ゲート` in `.claude/skills/pfd-ops/references/work-cycle.md`.",
	"MANUAL: After creating the PR, review the `PR 作成後` items in the same section.",
];

/**
 * Print the final manual-check directions before applying the gate exit code.
 * @param {Array<{status: string}>} results
 * @param {{log?: (line: string) => void, exit?: (code: number) => void}} io
 */
export function finishGateCheck(
	results,
	{ log = console.log, exit = process.exit } = {},
) {
	log("\nManual checks:");
	for (const line of MANUAL_GUIDANCE_LINES) log(`  ${line}`);
	if (results.some((result) => result.status === "FAIL")) exit(1);
}

/**
 * The selected design-selection record's own `lastEditedAt` (#737 案2),
 * matched by id rather than by array position — `gh` and GraphQL are not
 * guaranteed to return comments in the same order, and a position-based
 * match could silently attribute one comment's edit to another's.
 *
 * Three conditions make edit detection impossible rather than merely absent,
 * and all three are reported as a note rather than folded into `editedAtIso`
 * (which stays a plain timestamp-or-null so classifyDesignRecordTiming does
 * not have to parse a sentinel out of it): the GraphQL lookup itself failing
 * (`editInfo` is null), the issue carrying more comments than the single
 * page fetched (`totalCount` exceeds the fetched `nodes`), and the selected
 * record's own id having no match among the fetched nodes — without a note
 * this last case is indistinguishable from "confirmed unedited", when it is
 * actually "could not be checked".
 *
 * A record with no id at all falls into that last case rather than reading the
 * issue's own `lastEditedAt`. It used to mean "the body was elected", which
 * made the issue's edit history the right history to read; since #927 the body
 * is not a candidate, so an id-less record is a comment whose id the lookup did
 * not carry, and the issue's edit history is somebody else's.
 * @param {{id?: string}} record - selectDesignRecord's return value
 * @param {{issueLastEditedAt: string | null, comments: {totalCount: number, nodes: Array<{id: string, lastEditedAt: string | null}>}} | null} editInfo
 * @returns {{editedAtIso: string | null, note?: string}}
 */
export function resolveRecordEditedAt(record, editInfo) {
	if (!editInfo) return { editedAtIso: null, note: "edit history unavailable" };
	if (editInfo.comments.totalCount > editInfo.comments.nodes.length) {
		return {
			editedAtIso: null,
			note: "more comments than fetched; edit detection skipped",
		};
	}
	const match = record.id
		? editInfo.comments.nodes.find((c) => c.id === record.id)
		: undefined;
	if (!match) {
		return {
			editedAtIso: null,
			note: "record id not found among fetched comments; edit detection skipped",
		};
	}
	return { editedAtIso: match.lastEditedAt };
}

/**
 * Classify the timing of a design-selection record against the branch's
 * first commit (issue #669's protection against "the decision record is
 * written after the fact"). A record posted after work already started
 * documents a choice that was made retroactively, not one that guided it.
 *
 * Only one side of the comparison is server-side: GitHub records the record's
 * `createdAt`/`lastEditedAt`, which the runner cannot forge (#824). The commit
 * side is a git author date, which the runner does set — `git commit --date=`,
 * `GIT_AUTHOR_DATE`, or a rebase reaching the first commit all move it (#950).
 * `%aI` is still the right anchor (`%cI` is rewritten by every rebase, erasing
 * the cycle window), so the asymmetry is not removed here; it is disclosed.
 * PASS therefore carries `TIMING_ANCHOR_CAVEAT`, and the residual belongs to
 * the "機械が守らない範囲" human review already owns.
 * @param {string | null | undefined} recordIso - createdAt of the record comment.
 * @param {string | null | undefined} firstCommitIso - authorDate of the range's first commit.
 * @param {{editedAtIso?: string | null, noImplementation?: boolean, recordPresent?: boolean}} [options]
 *   - editedAtIso: the record's own lastEditedAt (#737 案2), or null/undefined
 *     when it was never edited or edit history could not be read.
 *   - noImplementation: the record itself declared no implementation (#768) —
 *     wins over every other check, since a cycle with no implementation
 *     commits in this range has nothing for timing to compare against, even
 *     when the range is not literally empty (the #757 shape: commits present,
 *     but belonging to a different, derived PR). Status still SKIPs, but the
 *     posted-time comparison still runs: a record that both declares no
 *     implementation and was posted after the first commit is evidence of a
 *     retroactive record, and #824's forgeability tradeoff for this
 *     disposition assumes a reviewer can see that evidence rather than have
 *     it silently dropped (review A-1).
 *   - recordPresent: distinguishes an elected comment with a missing createdAt
 *     from the ordinary no-record call, while leaving the timestamp-free pure
 *     function API backward-compatible.
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifyDesignRecordTiming(
	recordIso,
	firstCommitIso,
	{ editedAtIso, noImplementation, recordPresent = false } = {},
) {
	if (!recordIso)
		return recordPresent
			? {
					status: "FAIL",
					detail: "missing design-selection record timestamp",
				}
			: { status: "FAIL", detail: "no design-selection record found" };
	if (!isValidDesignRecordTimestamp(recordIso))
		return {
			status: "FAIL",
			detail: `invalid design-selection record timestamp: ${recordIso}`,
		};
	if (editedAtIso && !isValidDesignRecordTimestamp(editedAtIso))
		return {
			status: "FAIL",
			detail: `invalid design-selection record edit timestamp: ${editedAtIso}`,
		};
	const effectiveRecordIso =
		editedAtIso &&
		new Date(editedAtIso).getTime() > new Date(recordIso).getTime()
			? editedAtIso
			: recordIso;
	if (noImplementation) {
		const postedAfterFirstCommit =
			firstCommitIso &&
			new Date(effectiveRecordIso).getTime() >
				new Date(firstCommitIso).getTime();
		return {
			status: "SKIP",
			detail: postedAfterFirstCommit
				? `${NO_IMPLEMENTATION_COMMITS_DETAIL}; WARN: record ${effectiveRecordIso === recordIso ? "posted" : "edited"} at ${effectiveRecordIso}, after the first commit at ${firstCommitIso}`
				: NO_IMPLEMENTATION_COMMITS_DETAIL,
		};
	}
	if (!firstCommitIso)
		return { status: "SKIP", detail: NO_IMPLEMENTATION_COMMITS_DETAIL };
	if (
		new Date(effectiveRecordIso).getTime() > new Date(firstCommitIso).getTime()
	) {
		return {
			status: "FAIL",
			detail:
				effectiveRecordIso === editedAtIso
					? `record edited at ${editedAtIso}, after the first commit at ${firstCommitIso}`
					: `record posted at ${recordIso}, after the first commit at ${firstCommitIso}`,
		};
	}
	return { status: "PASS", detail: TIMING_ANCHOR_CAVEAT };
}

export const DESIGN_RECORD_V2_CUTOFF = "2026-08-30T09:32:50Z";
export const DESIGN_RECORD_V3_CUTOFF = "2026-08-31T01:30:24Z";
export const FORMAT_3_MARKER = "設計記録形式: 3";
export const FORMAT_3_DECISION_KINDS = [
	"実装",
	"調査のみ",
	"待機",
	"実装しない",
];
export const FORMAT_3_DISPOSITIONS = ["採用", "部分採用", "保留", "却下"];
// Kept for callers that still name the format 1-to-2 migration boundary.
export const DESIGN_RECORD_FORMAT_CUTOFF = DESIGN_RECORD_V2_CUTOFF;
export const READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES = [
	"提案:",
	"理由:",
	"前提を外した対案:",
	"対案を採らない理由:",
];
export const LEGACY_DESIGN_RECORD_REQUIRED_PREFIXES = [
	"前提:",
	"否定案:",
	"却下理由:",
];
// Kept for callers that build a legacy record without its comment timestamp.
export const DESIGN_RECORD_REQUIRED_PREFIXES =
	LEGACY_DESIGN_RECORD_REQUIRED_PREFIXES;
export const DISPOSITION_TOKENS = ["採用", "却下", "保留"];

/**
 * Whether a comment timestamp can safely decide both migration format and
 * record/commit ordering. GitHub supplies ISO timestamps, but finite parsing is
 * the actual property every comparison below relies on.
 * @param {unknown} timestamp
 * @returns {boolean}
 */
export function isValidDesignRecordTimestamp(timestamp) {
	return (
		typeof timestamp === "string" &&
		timestamp.length > 0 &&
		Number.isFinite(new Date(timestamp).getTime())
	);
}

// #768: a design-selection record can settle on not implementing at all (the
// #757 shape — the decision led elsewhere, and any commits later found in
// range belong to a different, derived PR). A line-head declaration, the
// same design as `Size-Intent: shrink` (SIZE_INTENT_PATTERN below): the
// record's prose is free to discuss "not implementing" as a topic — #768's
// own record did, inside its 前提 line, describing the very rule this token
// enacts — without that discussion being mistaken for the declaration
// itself. A plain substring match could not tell the two apart and SKIPped
// timing on a record that never made the disposition (#768's reported
// defect); requiring a matched line head, via the same lineHeadPattern /
// normalizeRecordLine machinery presentRequiredPrefixes uses, can.
export const NO_IMPLEMENTATION_TOKEN = "実装しない:";

/** Shared by both timing SKIP paths that mean "there is nothing to compare". */
export const NO_IMPLEMENTATION_COMMITS_DETAIL =
	"no implementation commits — timing unverifiable";

/**
 * Printed with every timing PASS (#950). The record side is server-recorded,
 * but the commit side is a git author date the runner sets, so a PASS is
 * evidence rather than proof — and a reader who only sees the verdict has no
 * other place to learn that.
 */
export const TIMING_ANCHOR_CAVEAT =
	"the commit side is a git author date the runner can set — evidence, not proof";

/** Markdown line-head decoration: blockquote, heading, or list marker. */
const LINE_HEAD_DECORATION = /^(?:>+|#{1,6}|[-*+]|\d+[.)])\s*/;

/**
 * A record line with its markdown stripped, ready for a line-head match.
 *
 * Emphasis goes first and everywhere, because it wraps the label in three
 * different places (`**前提:**`, `**前提**:`) and none of them is the label.
 * Then every layer of line-head decoration, not just the first: a record line
 * is as likely to read `> - 却下理由:` as `却下理由:`, and peeling one layer
 * leaves the rest unrecognisable.
 * @param {string} line
 * @returns {string}
 */
export function normalizeRecordLine(line) {
	let stripped = line.trim().replace(/\*\*/g, "");
	while (LINE_HEAD_DECORATION.test(stripped)) {
		stripped = stripped.replace(LINE_HEAD_DECORATION, "");
	}
	return stripped.trim();
}

const FORMAT_3_SECTION_HEADS = ["決定:", "理由:", "案の処分:", "改訂履歴:"];
const FORMAT_3_PREMISE_HEAD = /^前提検査\s+P(\d+)\s*[:：]$/;
const FORMAT_3_PLACEHOLDER_VOCABULARY = [
	"軸名",
	"実装 | 調査のみ | 待機 | 実装しない",
	"今回確定した範囲",
	"目的との対応",
	"候補名",
	"理由または条件",
	"軸名、決定、または元候補名",
	"候補群が共有する前提",
	"前提が成立しない場合の検査案",
	"一致、包含、組合せを含む具体的な差分",
	"採用 | 部分採用 | 保留 | 却下",
	"旧決定",
	"新決定",
	"変更理由",
	"URL",
];
const FORMAT_3_PLACEHOLDER = new RegExp(
	`[<＜]\\s*(?:${FORMAT_3_PLACEHOLDER_VOCABULARY.map((word) => word.replaceAll("|", "\\|")).join("|")})(?:\\s*[>＞]|$)`,
);

function parsePartialAdoption(value) {
	const match = value.match(
		/^採用部分\s*[:：]\s*(.+?)[;；]\s*残部\s*[:：]\s*(却下|保留)\s+—\s*(.+)$/,
	);
	if (!match) return null;
	const [, adoptedPart, remainderKind, remainderReason] = match;
	if (
		[adoptedPart, remainderKind, remainderReason].some(
			(part) => part.trim().length === 0,
		)
	)
		return null;
	return { adoptedPart, remainderKind, remainderReason };
}

function parseRevisionRow(line) {
	const match = line.match(
		/^(.+)\s+→\s+(.+)\s+—\s+(.+)\s+—\s+再承認\s*[:：]\s*(.+)$/,
	);
	if (!match) return null;
	const [, oldDecision, newDecision, reason, reapproval] = match;
	return [oldDecision, newDecision, reason, reapproval].every(
		(field) => field.trim().length > 0,
	)
		? { oldDecision, newDecision, reason, reapproval }
		: null;
}

/**
 * Validate only the structural parts of a format 3 design record. Its prose
 * stays opaque: the parser never infers candidate identity, rationale quality,
 * or whether a decision and a disposition make semantic sense.
 * @param {string | undefined | null} body
 * @returns {{status: "PASS", axes: string[], allNoImplementation: boolean}|{status: "FAIL", problems: string[]}}
 */
export function parseFormat3DesignRecord(body) {
	const lines = (body ?? "").split("\n").map(normalizeRecordLine);
	const problems = [];
	const markerIndexes = lines
		.map((line, index) => (line === FORMAT_3_MARKER ? index : -1))
		.filter((index) => index >= 0);
	if (markerIndexes.length !== 1)
		problems.push("format 3 marker must appear exactly once");
	const sectionIndexes = Object.fromEntries(
		FORMAT_3_SECTION_HEADS.map((head) => [
			head,
			lines
				.map((line, index) => (line === head ? index : -1))
				.filter((index) => index >= 0),
		]),
	);
	for (const head of FORMAT_3_SECTION_HEADS) {
		if (sectionIndexes[head].length !== 1)
			problems.push(`${head} must appear exactly once`);
	}
	const decisionIndex = sectionIndexes["決定:"][0];
	const rationaleIndex = sectionIndexes["理由:"][0];
	const dispositionIndex = sectionIndexes["案の処分:"][0];
	const historyIndex = sectionIndexes["改訂履歴:"][0];
	if (
		markerIndexes.length === 1 &&
		decisionIndex !== undefined &&
		lines.some(
			(line, index) =>
				index > markerIndexes[0] && index < decisionIndex && line.length > 0,
		)
	)
		problems.push("決定: must be the first content section");
	if (
		decisionIndex !== undefined &&
		rationaleIndex !== undefined &&
		dispositionIndex !== undefined &&
		historyIndex !== undefined &&
		!(
			decisionIndex < rationaleIndex &&
			rationaleIndex < dispositionIndex &&
			dispositionIndex < historyIndex
		)
	)
		problems.push("sections must appear in canonical order");

	const premiseHeaders = lines
		.map((line, index) => {
			const match = line.match(FORMAT_3_PREMISE_HEAD);
			return match ? { index, number: Number(match[1]) } : null;
		})
		.filter(Boolean);
	const sectionBoundaryIndexes = [
		...FORMAT_3_SECTION_HEADS.flatMap((head) => sectionIndexes[head]),
		...premiseHeaders.map(({ index }) => index),
	];
	const nextBoundary = (index) =>
		sectionBoundaryIndexes
			.filter((candidate) => candidate > index)
			.sort((a, b) => a - b)[0] ?? lines.length;
	const sectionLines = (index) =>
		index === undefined
			? []
			: lines.slice(index + 1, nextBoundary(index)).filter(Boolean);

	const decisionLines = sectionLines(decisionIndex);
	const decisionPattern = new RegExp(
		`^(.+?)\\s*（(${FORMAT_3_DECISION_KINDS.join("|")})）\\s*[:：]\\s*(.+)$`,
	);
	const decisions = decisionLines.map((line) => line.match(decisionPattern));
	if (decisionLines.length === 0)
		problems.push("決定: must contain a decision");
	if (decisions.some((decision) => !decision))
		problems.push("決定: contains an invalid decision line");
	const axes = decisions.filter(Boolean).map((decision) => decision[1].trim());
	if (new Set(axes).size !== axes.length)
		problems.push("duplicate decision axis");

	const rationaleLines = sectionLines(rationaleIndex);
	const rationalePattern = /^(.+?)\s*[:：]\s*(.+)$/;
	const rationales = rationaleLines.map((line) => line.match(rationalePattern));
	if (rationaleLines.length === 0)
		problems.push("理由: must contain a rationale");
	if (rationales.some((rationale) => !rationale))
		problems.push("理由: contains an invalid rationale line");
	const rationaleAxes = new Set(
		rationales.filter(Boolean).map((rationale) => rationale[1].trim()),
	);
	if (
		axes.length > 0 &&
		(axes.length !== rationaleAxes.size ||
			axes.some((axis) => !rationaleAxes.has(axis)))
	)
		problems.push("decision and rationale axis sets must match");

	const dispositionLines = sectionLines(dispositionIndex);
	const dispositionPattern = new RegExp(
		`^(${FORMAT_3_DISPOSITIONS.join("|")})\\s+—\\s+元候補「([^」]+)」\\s*—\\s*(.+)$`,
	);
	if (dispositionLines.length === 0)
		problems.push("案の処分: must contain a disposition");
	for (const line of dispositionLines) {
		const match = line.match(dispositionPattern);
		if (!match) {
			problems.push("案の処分: contains an invalid disposition");
			continue;
		}
		if (match[2].trim().length === 0)
			problems.push("案の処分: contains an empty original candidate");
		if (match[1] === "部分採用" && !parsePartialAdoption(match[3]))
			problems.push("部分採用 requires non-empty 採用部分 and 残部: 却下|保留");
	}

	const premiseNumbers = premiseHeaders.map(({ number }) => number);
	if (
		dispositionIndex !== undefined &&
		historyIndex !== undefined &&
		premiseHeaders.some(
			({ index }) => index <= dispositionIndex || index >= historyIndex,
		)
	)
		problems.push(
			"前提検査 Pn: blocks must appear after 案の処分: and before 改訂履歴:",
		);
	if (new Set(premiseNumbers).size !== premiseNumbers.length)
		problems.push("duplicate premise-test number");
	if (
		premiseNumbers.some((number, index) => number !== index + 1) ||
		premiseNumbers.length === 0
	)
		problems.push("premise-test numbers must be consecutive from P1");
	const premiseFieldHeads = [
		"対象:",
		"前提:",
		"前提を外した案:",
		"既存候補との差分:",
	];
	for (const premise of premiseHeaders) {
		const premiseLines = sectionLines(premise.index);
		const dispositionHead = `検査案の処分 P${premise.number}:`;
		const expectedHeads = [...premiseFieldHeads, dispositionHead];
		const fields = premiseLines.map((line) => {
			const head = expectedHeads.find((candidate) =>
				lineHeadPattern(candidate).test(line),
			);
			if (!head) return null;
			const value = line.replace(lineHeadPattern(head), "").trim();
			return { head, value };
		});
		if (fields.some((field) => !field)) {
			problems.push(`前提検査 P${premise.number}: contains an invalid field`);
			continue;
		}
		if (
			fields.length !== expectedHeads.length ||
			fields.some((field, index) => field.head !== expectedHeads[index])
		)
			problems.push(
				`前提検査 P${premise.number}: fields must appear once in canonical order`,
			);
		for (const field of fields.filter((field) => field.value.length === 0))
			problems.push(`${field.head} contains an empty value`);
		const disposition = fields
			.at(-1)
			?.value.match(
				new RegExp(`^(${FORMAT_3_DISPOSITIONS.join("|")})\\s+—\\s+(.+)$`),
			);
		if (!disposition)
			problems.push(
				`検査案の処分 P${premise.number}: must declare a disposition and reason`,
			);
		else if (
			disposition[1] === "部分採用" &&
			!parsePartialAdoption(disposition[2])
		)
			problems.push(
				`検査案の処分 P${premise.number}: 部分採用 requires non-empty 採用部分 and 残部: 却下|保留`,
			);
	}

	const historyLines = sectionLines(historyIndex);
	const hasNone = historyLines.includes("なし");
	const revisionRows = historyLines.filter((line) => line !== "なし");
	if (historyLines.length === 0 || (hasNone && revisionRows.length > 0))
		problems.push(
			"改訂履歴: must contain either - なし or revision rows, not both",
		);
	if (!hasNone) {
		if (revisionRows.some((line) => !parseRevisionRow(line)))
			problems.push(
				"改訂履歴: revision rows need old decision, new decision, reason, and 再承認",
			);
	}
	if (lines.some((line) => FORMAT_3_PLACEHOLDER.test(line)))
		problems.push("template placeholder remains");
	if (problems.length > 0)
		return { status: "FAIL", problems: [...new Set(problems)] };
	return {
		status: "PASS",
		axes,
		allNoImplementation: decisions.every(
			(decision) => decision[2] === "実装しない",
		),
	};
}

const REGEXP_METACHARS = /[.*+?^${}()|[\]\\]/g;

/**
 * A line head that carries `prefix`, for a line already through
 * normalizeRecordLine. The label text itself is fixed — a record saying
 * `前提条件:` has not written a `前提:` line — but two things around it are not
 * part of the label and must not decide the verdict: a parenthesised qualifier
 * (`却下理由（外部制約）:`, whose parenthetical carries the exemption clause's
 * required attribution) and a full-width colon.
 * @param {string} prefix - a design-record line-head token, colon included
 * @returns {RegExp}
 */
export function lineHeadPattern(prefix) {
	const label = prefix.replace(/[:：]$/, "").replace(REGEXP_METACHARS, "\\$&");
	return new RegExp(`^${label}\\s*(?:（[^）]*）|\\([^)]*\\))?\\s*[:：]`);
}

/**
 * Which of the required line heads this text carries, in canonical order.
 * Serves both the content verdict and the record's identification, so the two
 * cannot disagree about what counts as a required line.
 * @param {string} recordBody
 * @param {string[]} requiredPrefixes
 * @returns {string[]} a subset of requiredPrefixes
 */
function presentPrefixes(recordBody, requiredPrefixes) {
	const lines = (recordBody ?? "").split("\n").map(normalizeRecordLine);
	return requiredPrefixes.filter((prefix) => {
		const pattern = lineHeadPattern(prefix);
		return lines.some((line) => pattern.test(line));
	});
}

/**
 * The normalized first line index of every required prefix. First occurrences
 * matter because a misplaced declaration is not repaired by repeating it later.
 * @param {string} recordBody
 * @param {string[]} requiredPrefixes
 * @returns {number[]}
 */
function firstPrefixIndexes(recordBody, requiredPrefixes) {
	const lines = (recordBody ?? "").split("\n").map(normalizeRecordLine);
	return requiredPrefixes.map((prefix) => {
		const pattern = lineHeadPattern(prefix);
		return lines.findIndex((line) => pattern.test(line));
	});
}

/**
 * Required line heads for a comment. A reader-first line is always reader-first;
 * legacy-only records are accepted only when their server timestamp predates the
 * format cutoff. A missing timestamp preserves the legacy pure-function caller
 * contract; comment entries always carry their timestamp.
 * @param {{body?: string, createdAt?: string}} record
 * @returns {string[]}
 */
export function resolveDesignRecordRequiredPrefixes({ body, createdAt }) {
	if (
		presentPrefixes(body, READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES).length >
		0
	)
		return READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES;
	if (
		!createdAt ||
		new Date(createdAt).getTime() <
			new Date(DESIGN_RECORD_FORMAT_CUTOFF).getTime()
	)
		return LEGACY_DESIGN_RECORD_REQUIRED_PREFIXES;
	return READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES;
}

/**
 * Which of this record's required line heads it carries, in canonical order.
 * @param {string} recordBody
 * @param {string} [createdAt]
 * @returns {string[]}
 */
export function presentRequiredPrefixes(recordBody, createdAt) {
	const requiredPrefixes = resolveDesignRecordRequiredPrefixes({
		body: recordBody,
		createdAt,
	});
	return presentPrefixes(recordBody, requiredPrefixes);
}

/**
 * Classify only the required record format. Disposition semantics stay in
 * classifyDesignRecordContent so the terminal step can keep those advisory
 * without weakening format recognition.
 * @param {string} recordBody
 * @param {string} [createdAt]
 * @returns {{status: 'PASS'|'FAIL', detail?: string}}
 */
export function classifyDesignRecordRequiredFormat(recordBody, createdAt) {
	const body = recordBody ?? "";
	if (
		isValidDesignRecordTimestamp(createdAt) &&
		new Date(createdAt).getTime() >= new Date(DESIGN_RECORD_V3_CUTOFF).getTime()
	) {
		const parsed = parseFormat3DesignRecord(body);
		return parsed.status === "PASS"
			? { status: "PASS" }
			: { status: "FAIL", detail: parsed.problems.join("; ") };
	}
	const requiredPrefixes = resolveDesignRecordRequiredPrefixes({
		body,
		createdAt,
	});
	const indexes = firstPrefixIndexes(body, requiredPrefixes);
	const missing = requiredPrefixes.filter((_, index) => indexes[index] < 0);
	const problems = [];
	if (missing.length > 0)
		problems.push(`missing required line(s): ${missing.join(", ")}`);
	if (
		missing.length === 0 &&
		requiredPrefixes === READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES &&
		indexes.some(
			(index, position) => position > 0 && index <= indexes[position - 1],
		)
	)
		problems.push(
			`required lines must appear in canonical order: ${requiredPrefixes.join(" ")}`,
		);
	return problems.length > 0
		? { status: "FAIL", detail: problems.join("; ") }
		: { status: "PASS" };
}

const NO_IMPLEMENTATION_LINE_HEAD_PATTERN = lineHeadPattern(
	NO_IMPLEMENTATION_TOKEN,
);

/**
 * Did the selected design-selection record itself declare the disposition
 * "not implementing" (#768)? A line-head match, not a substring search over
 * the whole body — a record's 前提/否定案/却下理由 prose is free to discuss
 * this token as a topic (#768's own record did) without that discussion
 * being read as the declaration. Forgeable by a runner that implemented
 * anyway and mislabels the record — accepted (#824): the PR diff would then
 * contradict the label, and that contradiction is what human review catches.
 * No detector is added to close this, on purpose.
 * @param {string | undefined | null} recordBody
 * @returns {boolean}
 */
export function hasNoImplementationDisposition(recordBody) {
	const lines = (recordBody ?? "").split("\n").map(normalizeRecordLine);
	return lines.some((line) => NO_IMPLEMENTATION_LINE_HEAD_PATTERN.test(line));
}

/**
 * Shapes an issue into the flat entry list selectDesignRecord scans: one entry
 * per comment. `author` is left out on purpose — selectDesignRecord identifies
 * the record by required line heads alone and never reads it, so carrying it
 * here would read as a check that is still looking at who posted the record,
 * when none of this repo's design-record logic does anymore (#824).
 *
 * The issue body is not a candidate (#927). roadmap.md defines the record as a
 * comment posted before work starts, so a body carrying the same line heads is
 * a discussion of the same shape rather than the record — #927's own body has a
 * 「前提と、それを否定する案」section and was elected by it. Admitting the body
 * also made the terminal gate's timing check unconditional for anything it
 * elected: the body's createdAt is the issue's, which predates every commit on
 * the branch that closes it, so "posted before the first commit" was true by
 * construction rather than by the record having been written first.
 *
 * A comment entry carries `id` — the GraphQL node id `gh issue view` already
 * returns on every comment — so resolveRecordEditedAt can match the selected
 * record to its GraphQL edit-info node without depending on array order
 * (#737 案2).
 * @param {{body?: string, createdAt?: string, comments?: Array<{id?: string, body?: string, createdAt?: string}>}} issue
 * @returns {Array<{id?: string, body?: string, createdAt?: string}>}
 */
export function toDesignRecordEntries({ comments }) {
	return (comments ?? []).map((c) => ({
		id: c.id,
		body: c.body,
		createdAt: c.createdAt,
	}));
}

/**
 * The entry that is this issue's selection record, or undefined.
 *
 * Identified by its own required line heads rather than by any external
 * marker — nothing else has to agree on which entry the record is.
 *
 * A complete, ordered reader-first record takes precedence over a complete
 * grandfathered legacy record. Incomplete or timestamp-invalid fragments are
 * considered only when neither valid record exists, so they remain selectable
 * for diagnostics without shadowing a valid record. Within either diagnostic
 * format, most matches wins rather than first match.
 * Measured over this repo's issues, bodies carry a stray required line head often enough that a first-match search would elect the body and never examine the real record in a comment — a check aimed at the wrong text, which reads exactly like a check that ran.
 * @param {Array<{author?: string, body?: string, createdAt?: string}>} entries
 */
/**
 * Resolve a comment list through the three generation windows. Invalid new
 * fragments remain inspectable only when no complete timestamped record won.
 * @param {Array<{body?: string, createdAt?: string}>} entries
 * @returns {{status: "selected", record: object}|{status: "invalid", record: object, problems: string[]}|{status: "none"}|{status: "ambiguous", detail: string}}
 */
export function resolveDesignRecord(entries) {
	const complete = { 1: [], 2: [], 3: [] };
	const invalid = [];
	for (const entry of entries ?? []) {
		const body = entry.body ?? "";
		const normalized = body.split("\n").map(normalizeRecordLine);
		const hasFormat3Marker = normalized.includes(FORMAT_3_MARKER);
		const readerFirstCount = presentPrefixes(
			body,
			READER_FIRST_DESIGN_RECORD_REQUIRED_PREFIXES,
		).length;
		const legacyCount = presentPrefixes(
			body,
			LEGACY_DESIGN_RECORD_REQUIRED_PREFIXES,
		).length;
		const looksLikeRecord =
			hasFormat3Marker || readerFirstCount > 0 || legacyCount > 0;
		if (!looksLikeRecord) continue;
		if (!isValidDesignRecordTimestamp(entry.createdAt)) {
			invalid.push({
				record: entry,
				problems: [
					`invalid design-selection record timestamp: ${entry.createdAt ?? "missing"}`,
				],
			});
			continue;
		}
		const timestamp = new Date(entry.createdAt).getTime();
		if (timestamp >= new Date(DESIGN_RECORD_V3_CUTOFF).getTime()) {
			const parsed = parseFormat3DesignRecord(body);
			if (parsed.status === "PASS") complete[3].push(entry);
			else invalid.push({ record: entry, problems: parsed.problems });
			continue;
		}
		if (timestamp >= new Date(DESIGN_RECORD_V2_CUTOFF).getTime()) {
			const result = classifyDesignRecordRequiredFormat(body, entry.createdAt);
			if (result.status === "PASS") complete[2].push(entry);
			else invalid.push({ record: entry, problems: [result.detail] });
			continue;
		}
		const result = classifyDesignRecordRequiredFormat(body, entry.createdAt);
		if (result.status === "PASS") complete[1].push(entry);
		else invalid.push({ record: entry, problems: [result.detail] });
	}
	if (complete[3].length > 1)
		return {
			status: "ambiguous",
			detail: "multiple complete format 3 design records",
		};
	for (const format of [3, 2, 1]) {
		if (complete[format].length > 0)
			return { status: "selected", record: complete[format][0] };
	}
	if (invalid.length > 0)
		return {
			status: "invalid",
			record: invalid[0].record,
			problems: invalid[0].problems.filter(Boolean),
		};
	return { status: "none" };
}

/**
 * Compatibility wrapper for callers that only need the selected entry. The
 * diagnostic candidate remains returned so existing format-detail consumers
 * can continue to print why it failed.
 * @param {Array<{body?: string, createdAt?: string}>} entries
 */
export function selectDesignRecord(entries) {
	const result = resolveDesignRecord(entries);
	return result.status === "selected" || result.status === "invalid"
		? result.record
		: undefined;
}

const NUMBERED_DISPOSITION_LINE_PATTERN = new RegExp(
	`^案の処分\\s+(\\d+)\\s*[:：]\\s*(${DISPOSITION_TOKENS.join("|")})\\s+—\\s+\\S`,
);
const NUMBERED_DISPOSITION_HEAD_PATTERN = /^案の処分\s+(\d+)\s*[:：]/;

/**
 * Explicit numbered option-disposition declarations. The shared line-head
 * normalization keeps Markdown decoration and colon forms consistent with the
 * required-prefix checks. The em dash separates the single declaration token
 * from unrestricted option-and-reason prose.
 * @param {string} body
 * @returns {Array<{number: number, validToken: boolean}>}
 */
function numberedDispositionDeclarations(body) {
	return body.split("\n").flatMap((line) => {
		const normalized = normalizeRecordLine(line);
		const head = normalized.match(NUMBERED_DISPOSITION_HEAD_PATTERN);
		if (!head) return [];
		return [
			{
				number: Number(head[1]),
				validToken: NUMBERED_DISPOSITION_LINE_PATTERN.test(normalized),
			},
		];
	});
}

/**
 * Classify the content of a design-selection record. Two independent checks:
 * required line-head tokens are present, and the numbered disposition lines
 * form the exact set 1..optionCount with one declaration token apiece.
 * @param {string} recordBody
 * @param {number} optionCount
 * @returns {{status: 'PASS'|'FAIL', detail?: string}}
 */
export function classifyDesignRecordContent(
	recordBody,
	optionCount,
	createdAt,
) {
	const body = recordBody ?? "";
	if (
		isValidDesignRecordTimestamp(createdAt) &&
		new Date(createdAt).getTime() >= new Date(DESIGN_RECORD_V3_CUTOFF).getTime()
	) {
		const parsed = parseFormat3DesignRecord(body);
		return parsed.status === "PASS"
			? { status: "PASS" }
			: { status: "FAIL", detail: parsed.problems.join("; ") };
	}
	const problems = [];
	const requiredFormat = classifyDesignRecordRequiredFormat(body, createdAt);
	if (requiredFormat.status === "FAIL") problems.push(requiredFormat.detail);

	if (optionCount > 0) {
		const declarations = numberedDispositionDeclarations(body);
		const numbers = declarations.map((declaration) => declaration.number);
		const duplicateNumbers = [
			...new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i)),
		];
		const outsideNumbers = [
			...new Set(numbers.filter((n) => n < 1 || n > optionCount)),
		];
		const validNumbers = new Set(
			declarations
				.filter((declaration) => declaration.validToken)
				.map((declaration) => declaration.number),
		);
		const missingNumbers = Array.from(
			{ length: optionCount },
			(_, index) => index + 1,
		).filter((number) => !validNumbers.has(number));
		const invalidTokenNumbers = declarations
			.filter((declaration) => !declaration.validToken)
			.map((declaration) => declaration.number);
		if (duplicateNumbers.length > 0)
			problems.push(
				`duplicate numbered disposition(s): ${duplicateNumbers.join(", ")}`,
			);
		if (outsideNumbers.length > 0)
			problems.push(
				`numbered disposition(s) outside 1..${optionCount}: ${outsideNumbers.join(", ")}`,
			);
		if (invalidTokenNumbers.length > 0)
			problems.push(
				`numbered disposition(s) ${invalidTokenNumbers.join(", ")} must declare exactly one of ${DISPOSITION_TOKENS.join("/")} followed by — and option/reason prose`,
			);
		if (missingNumbers.length > 0)
			problems.push(
				`numbered dispositions must cover exactly 1..${optionCount}; missing: ${missingNumbers.join(", ")}`,
			);
	}

	if (problems.length > 0)
		return { status: "FAIL", detail: problems.join("; ") };
	return { status: "PASS" };
}

// A declaration, not a reading. Scanning the body for shrink vocabulary fired
// on issues that merely quoted another issue's option name, which is the same
// "the machine guesses what the prose meant" failure the other #669 checks
// replaced with a token the filer writes.
export const SIZE_INTENT_PATTERN = /^Size-Intent:\s*shrink\b/m;
// Prose that accumulates procedure, wherever this repo keeps it. #669 named
// the first three and left the reason for that particular list unwritten; the
// companions were the gap (#732/#752), and being the largest of the set they
// were the ones the audit most needed. `.pfdsl/*.md` covers them by shape
// rather than by name, so a fourth companion arrives already tracked, while
// the graphs beside them stay out — a .pfdsl file's size moves for reasons
// this audit is not about.
export const SIZE_TRACKED_PATTERNS = [
	/^\.pfdsl\/[^/]+\.md$/,
	/^\.pfdsl\/bindings\//,
	/^docs\/adr\//,
	/(^|\/)SKILL\.md$/,
];
export const SIZE_OVERRIDE_PATTERN = /^Size-Override:\s*\S/m;

/**
 * Did any commit in the range declare that the growth is intended?
 *
 * The declaration lives in a commit trailer rather than the PR body (#775).
 * The terminal gate runs before the PR is opened, so the body was unreadable
 * in the ordinary case — the check had to carry a whole SKIP-vs-FAIL split
 * (`classifyPrBodyFailure`) just to say so — and a body can be edited after
 * the verdict, which a commit message cannot.
 *
 * Scanning the trailer region rather than every line is what keeps a commit
 * whose prose explains the token from declaring one (#726), and the prefix
 * filter is what keeps the Conventional Commits subject, itself `Key: value`
 * shaped, out of the answer.
 * @param {string | undefined | null} commitMessages - RECORD_SEP between messages
 * @returns {boolean}
 */
export function hasSizeOverride(commitMessages) {
	return trailerLines(commitMessages).some((line) =>
		SIZE_OVERRIDE_PATTERN.test(line),
	);
}

/**
 * Does the linked issue declare that something should get smaller?
 * @param {string | undefined | null} issueBody
 * @returns {boolean}
 */
export function hasShrinkIntent(issueBody) {
	return SIZE_INTENT_PATTERN.test(issueBody ?? "");
}

/**
 * The package layers this branch touched, read off the diff.
 *
 * The companion used to require the runner to name these in the PR body, and
 * three cycles in a row forgot to (#801). The claim was never the evidence:
 * the diff is, and it is available at gate time while the PR body is not. So
 * this is report material — printed for whoever writes the PR, judged by
 * nobody. What the declaration was for (noticing a layer mismatch before
 * starting) is a planning-time concern, and a line written at PR time was
 * always past the point where it could serve that.
 * @param {string[]} changedFiles
 * @returns {string[]} package directory names, sorted and deduplicated
 */
export function derivePackageLayers(changedFiles) {
	const layers = new Set();
	for (const file of changedFiles) {
		const match = /^packages\/([^/]+)\//.exec(file);
		if (match) layers.add(match[1]);
	}
	return [...layers].sort();
}

/**
 * One tracked knowledge artifact's size across the range under review.
 * @typedef {{path: string, beforeBytes: number, afterBytes: number,
 *            beforeLines: number, afterLines: number}} SizeDelta
 */

/**
 * One line describing a delta, in the one shape both the verdict's detail and
 * the report block use — an operator seeing them back to back reads the same
 * sentence twice, not two wordings of the same numbers.
 * @param {SizeDelta} d
 * @returns {string}
 */
export function formatSizeDelta(d) {
	const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
	const bytes = sign(d.afterBytes - d.beforeBytes);
	const lines = sign(d.afterLines - d.beforeLines);
	return `${d.path}: ${bytes} bytes / ${lines} lines (${d.beforeBytes} → ${d.afterBytes} bytes)`;
}

/**
 * Classify whether tracked knowledge artifacts moved in the direction a
 * shrink-intent issue asked for (issue #669's protection against "the
 * countermeasure's effect on size is never measured"). Only the verdict is
 * gated on the declaration — the deltas themselves are reported either way, so
 * a missing declaration costs the numbers nothing.
 *
 * `overrideDeclared` comes from the branch's commit trailers, which are local
 * and always present. The distinction #749 had to draw — "no override was
 * written" versus "the override could not be read" — belonged to a PR-body
 * lookup that no longer happens, so both it and the SKIP/FAIL line it drew are
 * gone (#775).
 *
 * Both declarations are self-reported: the issue filer opts into the direction
 * check with `Size-Intent: shrink`, and the runner can accept non-retro growth
 * with a `Size-Override:` trailer. Retro pattern-catalogue growth remains in
 * detail but is excluded from the verdict because pfd-retro itself produces it.
 * This classifier evaluates the supplied measured deltas, not whether either
 * declaration reflects its author's real intent. No detector is added for that
 * semantic claim: the deltas are reported with or without the declarations,
 * leaving their justification visible to human review (#910).
 * @param {{issueBody?: string, deltas: SizeDelta[], overrideDeclared?: boolean}} params
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifySizeDirection({ issueBody, deltas, overrideDeclared }) {
	if (!hasShrinkIntent(issueBody)) {
		return {
			status: "SKIP",
			detail: "linked issue declares no Size-Intent: shrink",
		};
	}
	if (!deltas || deltas.length === 0) {
		return { status: "SKIP", detail: "no tracked knowledge-artifact changes" };
	}

	const grown = deltas.filter((d) => d.afterBytes > d.beforeBytes);
	if (grown.length === 0) return { status: "PASS" };

	const retroGrowth = grown.filter((d) =>
		d.path.startsWith(`${PATTERN_DIR_RELATIVE}/`),
	);
	const gatedGrowth = grown.filter(
		(d) => !d.path.startsWith(`${PATTERN_DIR_RELATIVE}/`),
	);
	const retroDetail =
		retroGrowth.length > 0
			? `excluded retro output: ${retroGrowth.map(formatSizeDelta).join(", ")}`
			: null;
	if (gatedGrowth.length === 0) {
		return { status: "PASS", detail: retroDetail };
	}

	const list = gatedGrowth.map(formatSizeDelta).join(", ");
	if (overrideDeclared) {
		return {
			status: "PASS",
			detail: [retroDetail, `growth accepted via Size-Override: ${list}`]
				.filter(Boolean)
				.join("; "),
		};
	}
	return {
		status: "FAIL",
		detail: [retroDetail, list].filter(Boolean).join("; "),
	};
}

/**
 * Parse `git log --format=%h%x09%s <range>` output into sha/subject records,
 * one per non-blank line (#834's cycle window: collectCycleWindow in
 * gate-check-steps.mjs is what runs the git calls this shape comes from).
 *
 * Splits on the first tab only. `%s` does not escape a tab that a subject
 * itself carries, so splitting on every tab would cut such a subject short
 * and drop its tail rather than keep it whole.
 * @param {string} text
 * @returns {{sha: string, subject: string}[]}
 */
export function parseCommitLogLines(text) {
	return text
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => {
			const i = line.indexOf("\t");
			return i === -1
				? { sha: line, subject: "" }
				: { sha: line.slice(0, i), subject: line.slice(i + 1) };
		});
}

/**
 * Union two parsed commit-log lists, de-duplicated by sha, first-seen order
 * preserved (#834). `a`'s entries win ties — collectCycleWindow calls this
 * with the "base commits this tree lacks" list first and the "base commits
 * landed since the branch started" list second, and the two can overlap.
 * @param {{sha: string, subject: string}[]} a
 * @param {{sha: string, subject: string}[]} b
 * @returns {{sha: string, subject: string}[]}
 */
export function unionCommitLogEntries(a, b) {
	const seen = new Set();
	const result = [];
	for (const entry of [...a, ...b]) {
		if (seen.has(entry.sha)) continue;
		seen.add(entry.sha);
		result.push(entry);
	}
	return result;
}

/**
 * Pure functions for terminal-gate aggregate checking.
 * Process/git I/O lives in the main script; this module stays testable.
 */

import { isGhUnavailableError } from "../pfdsl/lib/gh-compat.mjs";
import { trailerLines } from "./commit-trailers.mjs";

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
 * generation chain into `runtime-pipeline.pfdsl`, so a generation source
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

/**
 * Repo-relative path to the terminal-gate checklist (workcycle step 3). This
 * file is the single source of truth for wording — gate-check derives its
 * MANUAL: list from it instead of duplicating the text.
 */
export const GATE_CHECKLIST_SOURCE_PATH =
	".claude/skills/pfd-ops/references/work-cycle.md";

/**
 * Parse the terminal-gate checklist (workcycle step 3) into raw item strings.
 * @param {string} skillMdText
 * @returns {string[]}
 */
export function extractGateChecklist(skillMdText) {
	const lines = skillMdText.split("\n");
	const items = [];
	let inChecklist = false;
	for (const line of lines) {
		if (/^3\. \*\*反映/.test(line)) {
			inChecklist = true;
			continue;
		}
		if (inChecklist && /^4\. \*\*報告/.test(line)) break;
		if (!inChecklist) continue;
		const m = line.match(/^\s*-\s\[ \]\s(.+)$/);
		if (m) items.push(m[1].trim());
	}
	return items;
}

// Checklist items already covered by gate-check's own mechanized checks,
// matched by substring since the checklist source file's wording is the
// source of truth.
const COVERED_BY_GATE_CHECK = [
	"出力 artifact の status を更新した",
	"変更した全 .pfdsl が",
	"Conventional Commits 形式に従う",
];

/**
 * @param {string[]} checklistItems
 * @returns {string[]}
 */
export function deriveManualItems(checklistItems) {
	return checklistItems.filter(
		(item) => !COVERED_BY_GATE_CHECK.some((kw) => item.includes(kw)),
	);
}

// The checklist's own mark for an item that can only be done once the PR
// exists (#816). Matched at the item's head, not anywhere in it: an item that
// merely mentions the phrase is still an item to do before the PR.
const AFTER_PR_MARKER = /^\*\*PR 作成後\*\*/;

/**
 * Split the MANUAL items into the ones to walk before creating the PR and the
 * ones that can only be done after (#816). Printing them as one flat list puts
 * "write this into the PR body" in front of a reader who has no PR yet, which
 * is the timing defect the checklist's ordering was rearranged to fix — an
 * ordering no reader can act on if the list that reaches them is flat.
 * @param {string[]} manualItems
 * @returns {{beforePr: string[], afterPr: string[]}}
 */
export function partitionManualItemsByPhase(manualItems) {
	return {
		beforePr: manualItems.filter((item) => !AFTER_PR_MARKER.test(item)),
		afterPr: manualItems.filter((item) => AFTER_PR_MARKER.test(item)),
	};
}

/**
 * The GraphQL query that reads a design-selection record's edit history
 * (#737 案2): the issue's own `lastEditedAt`, and every comment's, in one
 * round trip. REST's `updated_at` is not used — it moves on new comments
 * alone, so it is not evidence the record's own text changed. `gh issue view
 * --json comments` doesn't carry `lastEditedAt` at all (verified against a
 * live issue), which is why this goes through `gh api graphql` instead.
 * @param {{owner: string, repo: string, number: number}} params
 * @returns {string[]} argv for execGh
 */
export function buildDesignRecordEditQuery({ owner, repo, number }) {
	return [
		"api",
		"graphql",
		"-F",
		`owner=${owner}`,
		"-F",
		`repo=${repo}`,
		"-F",
		`number=${number}`,
		"-f",
		"query=query($owner:String!,$repo:String!,$number:Int!){ repository(owner:$owner,name:$repo){ issue(number:$number){ lastEditedAt comments(first:100){ totalCount nodes { id lastEditedAt } } } } } ",
	];
}

/**
 * Parse `buildDesignRecordEditQuery`'s response into the shape
 * resolveRecordEditedAt reads.
 * @param {string} jsonText - execGh's stdout for the graphql call
 * @returns {{issueLastEditedAt: string | null, comments: {totalCount: number, nodes: Array<{id: string, lastEditedAt: string | null}>}}}
 */
export function parseDesignRecordEditResponse(jsonText) {
	const issueData = JSON.parse(jsonText)?.data?.repository?.issue;
	if (!issueData)
		throw new Error(
			"unexpected GraphQL response shape for design-record edit info",
		);
	return {
		issueLastEditedAt: issueData.lastEditedAt ?? null,
		comments: {
			totalCount: issueData.comments.totalCount,
			nodes: issueData.comments.nodes,
		},
	};
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
 * @param {{editedAtIso?: string | null, noImplementation?: boolean}} [options]
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
 * @returns {{status: 'PASS'|'FAIL'|'SKIP', detail?: string}}
 */
export function classifyDesignRecordTiming(
	recordIso,
	firstCommitIso,
	{ editedAtIso, noImplementation } = {},
) {
	if (!recordIso)
		return { status: "FAIL", detail: "no design-selection record found" };
	if (noImplementation) {
		const postedAfterFirstCommit =
			firstCommitIso &&
			new Date(recordIso).getTime() > new Date(firstCommitIso).getTime();
		return {
			status: "SKIP",
			detail: postedAfterFirstCommit
				? `${NO_IMPLEMENTATION_COMMITS_DETAIL}; WARN: record posted at ${recordIso}, after the first commit at ${firstCommitIso}`
				: NO_IMPLEMENTATION_COMMITS_DETAIL,
		};
	}
	if (!firstCommitIso)
		return { status: "SKIP", detail: NO_IMPLEMENTATION_COMMITS_DETAIL };
	if (new Date(recordIso).getTime() > new Date(firstCommitIso).getTime()) {
		return {
			status: "FAIL",
			detail: `record posted at ${recordIso}, after the first commit at ${firstCommitIso}`,
		};
	}
	if (
		editedAtIso &&
		new Date(editedAtIso).getTime() > new Date(firstCommitIso).getTime()
	) {
		return {
			status: "FAIL",
			detail: `record edited at ${editedAtIso}, after the first commit at ${firstCommitIso}`,
		};
	}
	return { status: "PASS", detail: TIMING_ANCHOR_CAVEAT };
}

export const DESIGN_RECORD_REQUIRED_PREFIXES = [
	"前提:",
	"否定案:",
	"却下理由:",
];
export const DISPOSITION_TOKENS = ["採用", "却下", "保留"];

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
 * @returns {string[]} a subset of DESIGN_RECORD_REQUIRED_PREFIXES
 */
export function presentRequiredPrefixes(recordBody) {
	const lines = (recordBody ?? "").split("\n").map(normalizeRecordLine);
	return DESIGN_RECORD_REQUIRED_PREFIXES.filter((prefix) => {
		const pattern = lineHeadPattern(prefix);
		return lines.some((line) => pattern.test(line));
	});
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
 * Most matches wins rather than first match. Measured over this repo's issues,
 * bodies carry a stray required line head often enough that a first-match
 * search would elect the body and never examine the real record in a comment —
 * a check aimed at the wrong text, which reads exactly like a check that ran.
 * @param {Array<{author?: string, body?: string, createdAt?: string}>} entries
 */
export function selectDesignRecord(entries) {
	let best;
	let bestCount = 0;
	for (const entry of entries ?? []) {
		const count = presentRequiredPrefixes(entry.body).length;
		if (count > bestCount) {
			best = entry;
			bestCount = count;
		}
	}
	return best;
}

const REQUIRED_LINE_HEAD_PATTERNS =
	DESIGN_RECORD_REQUIRED_PREFIXES.map(lineHeadPattern);

/**
 * The record with its required line heads removed, ready to be counted over.
 *
 * `却下理由:` contains `却下`, so a plain substring count over the whole body
 * hands every conforming record one disposition token for free — a token that
 * names no option's disposition, which made the count a complete no-op at
 * optionCount 1 (#949). Only the matched label is dropped, not the line: a
 * 却下理由 line's own prose routinely disposes of the option it is about
 * (「案Bは却下する」), and dropping the whole line loses that. Measured over
 * this repo's 128 records carrying all three required heads, the two differ on
 * 56 of them, always in that direction.
 * @param {string} body
 * @returns {string}
 */
function stripRequiredLineHeads(body) {
	return body
		.split("\n")
		.map((line) => {
			const normalized = normalizeRecordLine(line);
			for (const pattern of REQUIRED_LINE_HEAD_PATTERNS) {
				const match = normalized.match(pattern);
				if (match) return normalized.slice(match[0].length);
			}
			return normalized;
		})
		.join("\n");
}

/**
 * Classify the content of a design-selection record. Two independent checks:
 * required line-head tokens are present, and every enumerated option got a
 * disposition word somewhere in the record.
 *
 * The disposition-token count is checked as "at least optionCount", not an
 * exact match, because ordinary prose can name the same option's disposition
 * more than once (e.g. "案2は却下する。却下理由は…") — an exact-match check
 * would FAIL a correct record for that.
 * @param {string} recordBody
 * @param {number} optionCount
 * @returns {{status: 'PASS'|'FAIL', detail?: string}}
 */
export function classifyDesignRecordContent(recordBody, optionCount) {
	const body = recordBody ?? "";
	const present = presentRequiredPrefixes(body);
	const missing = DESIGN_RECORD_REQUIRED_PREFIXES.filter(
		(prefix) => !present.includes(prefix),
	);

	const problems = [];
	if (missing.length > 0)
		problems.push(`missing required line(s): ${missing.join(", ")}`);

	if (optionCount > 0) {
		const countable = stripRequiredLineHeads(body);
		const dispositionCount = DISPOSITION_TOKENS.reduce(
			(sum, token) => sum + (countable.split(token).length - 1),
			0,
		);
		if (dispositionCount < optionCount) {
			problems.push(
				`disposition tokens (${DISPOSITION_TOKENS.join("/")}) found ${dispositionCount} time(s), fewer than ${optionCount} enumerated option(s)`,
			);
		}
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
 * check with `Size-Intent: shrink`, and the runner can accept measured growth
 * with a `Size-Override:` trailer. This classifier evaluates the supplied
 * measured deltas, not whether either declaration reflects its author's real
 * intent. No detector is added for that semantic claim: the deltas are reported
 * with or without the declarations, leaving their justification visible to
 * human review (#910).
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

	const list = grown.map(formatSizeDelta).join(", ");
	if (overrideDeclared) {
		return {
			status: "PASS",
			detail: `growth accepted via Size-Override: ${list}`,
		};
	}
	return { status: "FAIL", detail: list };
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

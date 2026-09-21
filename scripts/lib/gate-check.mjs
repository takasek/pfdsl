/**
 * Pure functions for terminal-gate aggregate checking.
 * Process/git I/O lives in the main script; this module stays testable.
 */

import { isGhUnavailableError } from "../pfdsl/lib/gh-compat.mjs";

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
 * Path trigger for the vscode-extension typecheck gate (workflow.md
 * "vscode-extension を変更した場合" note). Mirrors GEN_PLUGIN_TRIGGER's
 * trigger-then-run shape.
 */
export const VSCODE_EXT_TRIGGER = /^packages\/vscode-extension\//;

// Conventional Commits subject line: type(scope)!: description.
// Scope and ! are optional; type must be one of the conventional set.
const CONVENTIONAL_COMMIT_PATTERN =
	/^(feat|fix|refactor|docs|chore|test|style|perf|build|ci|revert)(\([\w.,/-]+\))?!?: .+/;

/**
 * Lint commit subjects against the Conventional Commits format.
 * Language and commit granularity remain review guidance.
 * @param {string[]} subjects
 * @returns {Array<{subject: string, ok: boolean, reason?: string}>}
 */
export function lintCommitSubjects(subjects) {
	return subjects.map((subject) => {
		if (!CONVENTIONAL_COMMIT_PATTERN.test(subject)) {
			return { subject, ok: false, reason: "not Conventional Commits" };
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
 * @param {{issueNumbers?: number[], log?: (line: string) => void, exit?: (code: number) => void}} io
 */
export function finishGateCheck(
	results,
	{ issueNumbers = [], log = console.log, exit = process.exit } = {},
) {
	log("\nManual checks:");
	for (const line of MANUAL_GUIDANCE_LINES) log(`  ${line}`);
	log(
		issueNumbers.length > 0
			? `  MANUAL: Review the issue comments and approval evidence for ${issueNumbers.map((n) => `#${n}`).join(", ")} under .pfdsl/bindings/pfd-ops.md. No record or approval verdict is produced here.`
			: "  MANUAL: no --issue given; no issue review is implied. Pass every target explicitly for terminal review.",
	);
	if (results.some((result) => result.status === "FAIL")) exit(1);
}

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
 * One line describing a measured delta in the human-review report.
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

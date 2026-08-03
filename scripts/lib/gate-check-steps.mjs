/**
 * The gate-check steps that need to run other commands.
 *
 * gate-check.mjs itself is a top-level script: it reads argv, runs git, and
 * prints a table, so nothing inside it could be tested and its branch wiring
 * — which decides what CI accepts — was unverified (#612). Each step here
 * takes its subprocess runner as an argument, so a test supplies fake command
 * output and asserts the row that comes out. The predicates the steps call
 * (classifyOutputArtifactStatus, wipTransitionDetected, …) stay in
 * gate-check.mjs beside the rest of the pure logic.
 *
 * `exec`/`node` have the shape of lib/run-exec.mjs' tryRun: they never throw,
 * and report failure as `{ ok: false, out }`.
 */

import {
	classifyDesignRecordContent,
	classifyDesignRecordTiming,
	classifyOutputArtifactStatus,
	classifySizeDirection,
	hasShrinkIntent,
	hasStatusChange,
	matchesTrigger,
	NO_ARTIFACT_DETAIL,
	NO_ISSUE_DETAIL,
	SIZE_TRACKED_PATTERNS,
	statusChangedForArtifact,
	wipTransitionDetected,
} from "./gate-check.mjs";
import { detectEnumeratedOptions, findDecisionRecords } from "./cycle-status.mjs";
import { GEN_INSTALL_TRIGGER } from "./gen-install-trigger.mjs";
import { GEN_PLUGIN_TRIGGER } from "./gen-plugin-trigger.mjs";

const ROADMAP_PATH = ".pfdsl/roadmap.pfdsl";

/**
 * gen-plugin identity: regenerate the distributed trees and require no diff.
 *
 * GEN_INSTALL_TRIGGER is consulted too: install/ is generated from repo-root
 * sources (#547) that GEN_PLUGIN_TRIGGER doesn't match, so a PR editing only a
 * template source would otherwise report SKIP while in fact owing install/ and
 * plugin/ churn. gen-plugin.mjs runs gen-install internally, so one
 * regeneration covers both hops — hence both output trees are diffed.
 */
export function genPluginIdentityStep({ exec, node, changedFiles }) {
	const name = "gen-plugin identity";
	if (
		!matchesTrigger(changedFiles, GEN_PLUGIN_TRIGGER) &&
		!matchesTrigger(changedFiles, GEN_INSTALL_TRIGGER)
	) {
		return { name, status: "SKIP", detail: "no skill/plugin/install-source changes" };
	}
	const regenerated = node(["scripts/gen-plugin.mjs"]);
	const clean =
		regenerated.ok &&
		exec("git", ["diff", "--exit-code", "--", "plugin", ".claude/skills/pfd-ops/install"]).ok;
	return { name, status: clean ? "PASS" : "FAIL" };
}

/**
 * Output artifact status update: did this cycle move its artifact's status?
 * Three ways in, and which one applies is the point of the step: a declared
 * --no-artifact cycle skips, a named artifact is checked strictly against the
 * two roadmap snapshots, and everything else falls back to "some status: line
 * moved", which is all the diff can honestly say.
 */
export function outputArtifactStatusStep({ exec, base, artifactKey, noArtifact, changedFiles }) {
	const name = "output artifact status update";
	const roadmapChanged = changedFiles.includes(ROADMAP_PATH);

	if (noArtifact || (!artifactKey && !roadmapChanged)) {
		return { name, ...classifyOutputArtifactStatus({ artifactKey, noArtifact, roadmapChanged }) };
	}

	if (artifactKey) {
		const before = exec("git", ["show", `origin/${base}:${ROADMAP_PATH}`]);
		const after = exec("git", ["show", `HEAD:${ROADMAP_PATH}`]);
		if (!before.ok || !after.ok) {
			return {
				name,
				status: "FAIL",
				detail: `could not read ${ROADMAP_PATH} at origin/${base} or HEAD`,
			};
		}
		const changed = statusChangedForArtifact(before.out, after.out, artifactKey);
		return { name, ...classifyOutputArtifactStatus({ artifactKey, changed }) };
	}

	const diffResult = exec("git", ["diff", `origin/${base}...HEAD`, "--", ROADMAP_PATH]);
	if (!diffResult.ok) return { name, status: "FAIL", detail: diffResult.out.trim() };
	const changed = hasStatusChange(diffResult.out);
	return { name, ...classifyOutputArtifactStatus({ artifactKey, roadmapChanged, changed }) };
}

/**
 * wip transition: protocol 4 wants the artifact marked wip when work starts,
 * not only done at the end. Only the commits' own snapshots can show that, so
 * this walks the roadmap as each commit in the range left it.
 */
export function wipTransitionStep({ exec, base, artifactKey, noArtifact, changedFiles }) {
	const name = "wip transition";
	if (noArtifact) return { name, status: "SKIP", detail: NO_ARTIFACT_DETAIL };
	if (!changedFiles.includes(ROADMAP_PATH)) {
		return { name, status: "SKIP", detail: `no ${ROADMAP_PATH} changes` };
	}

	const shasOut = exec("git", ["log", "--format=%H", `origin/${base}..HEAD`, "--", ROADMAP_PATH]);
	if (!shasOut.ok) return { name, status: "FAIL", detail: shasOut.out.trim() };

	const snapshots = shasOut.out
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((sha) => exec("git", ["show", `${sha}:${ROADMAP_PATH}`]))
		.filter((r) => r.ok)
		.map((r) => r.out);

	const detected = wipTransitionDetected(snapshots, artifactKey);
	return {
		name,
		status: detected ? "PASS" : "FAIL",
		detail: detected
			? artifactKey
				? `wip found for '${artifactKey}'`
				: "presence-only check; pass --artifact <key> to verify the specific output artifact"
			: artifactKey
				? `no status: wip snapshot found for artifact '${artifactKey}'`
				: "no status: wip found in any commit snapshot",
	};
}

/**
 * design-selection record: was the design choice recorded before work
 * started, with the required structure (issue #669's protection against
 * "the record is written after the fact, or is unstructured prose")?
 */
export function designRecordStep({ exec, base, issue, issueError }) {
	const name = "design-selection record";
	if (!issue) return { name, status: "SKIP", detail: issueError ?? NO_ISSUE_DETAIL };

	const ownerLogin = issue.author?.login;
	const body = issue.body ?? "";
	const optionCount = detectEnumeratedOptions(body).count;

	// The issue body is one entry among the comments, not a special case that
	// bypasses the checks: a decision written into the body is still a record
	// whose timing and structure are judged the same way (its createdAt is the
	// issue's, so it passes timing on its own merits rather than by exemption).
	const entries = [
		{ author: ownerLogin, body, createdAt: issue.createdAt },
		...(issue.comments ?? []).map((c) => ({ author: c.author?.login, body: c.body, createdAt: c.createdAt })),
	];
	const record = entries.find((e) => e.author === ownerLogin && findDecisionRecords([e]).length > 0);

	if (!record) {
		return { name, ...classifyDesignRecordTiming(undefined, null) };
	}

	const firstCommitOut = exec("git", ["log", "--format=%aI", "--reverse", `origin/${base}..HEAD`]);
	const firstCommitIso = firstCommitOut.ok ? firstCommitOut.out.trim().split("\n")[0] || null : null;

	const timing = classifyDesignRecordTiming(record.createdAt, firstCommitIso);
	const content = classifyDesignRecordContent(record.body, optionCount);
	const detail = [timing.detail, content.detail].filter(Boolean).join("; ") || undefined;
	if (timing.status === "FAIL" || content.status === "FAIL") return { name, status: "FAIL", detail };
	if (timing.status === "SKIP") return { name, status: "SKIP", detail };
	return { name, status: "PASS", detail };
}

/**
 * knowledge-artifact size direction: did tracked knowledge artifacts
 * (bindings, ADRs, SKILL.md) grow without an explicit override, on a cycle
 * whose linked issue states shrink intent (issue #669's protection against
 * "the countermeasure's effect on size is never measured")?
 */
export function sizeDirectionStep({ exec, base, issue, issueError, changedFiles }) {
	const name = "knowledge-artifact size direction";
	if (!issue) return { name, status: "SKIP", detail: issueError ?? NO_ISSUE_DETAIL };

	const issueBody = issue.body ?? "";
	// Check the intent before spending a `git show` pair per tracked file and a
	// `gh pr view` — most cycles carry no shrink intent, and every one of those
	// subprocesses would be thrown away. classifySizeDirection reaches the same
	// verdict from the same predicate, so the two cannot disagree.
	if (!hasShrinkIntent(issueBody)) return { name, ...classifySizeDirection({ issueBody, deltas: [] }) };

	const tracked = changedFiles.filter((f) => SIZE_TRACKED_PATTERNS.some((p) => p.test(f)));
	const deltas = tracked.map((path) => {
		const before = exec("git", ["show", `origin/${base}:${path}`]);
		const after = exec("git", ["show", `HEAD:${path}`]);
		const beforeText = before.ok ? before.out : "";
		const afterText = after.ok ? after.out : "";
		return {
			path,
			beforeBytes: before.ok ? Buffer.byteLength(beforeText, "utf-8") : 0,
			afterBytes: Buffer.byteLength(afterText, "utf-8"),
			beforeLines: before.ok ? beforeText.split("\n").length : 0,
			afterLines: afterText.split("\n").length,
		};
	});

	const prBodyResult = exec("gh", ["pr", "view", "--json", "body", "--jq", ".body"]);
	const prBody = prBodyResult.ok ? prBodyResult.out : "";

	return { name, ...classifySizeDirection({ issueBody, deltas, prBody }) };
}

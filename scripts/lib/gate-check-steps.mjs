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
	hasStatusChange,
	matchesTrigger,
	NO_ARTIFACT_DETAIL,
	statusChangedForArtifact,
	wipTransitionDetected,
} from "./gate-check.mjs";
import { detectEnumeratedOptions } from "./cycle-status.mjs";
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
export function designRecordStep({ exec, base, issueNumber }) {
	const name = "design-selection record";
	if (issueNumber == null) {
		return { name, status: "SKIP", detail: "no --issue given; pass --issue <n> to check the design-selection record" };
	}

	const issueResult = exec("gh", ["issue", "view", String(issueNumber), "--json", "author,body,comments"]);
	if (!issueResult.ok) return { name, status: "SKIP", detail: "gh CLI unavailable" };

	let issueJson;
	try {
		issueJson = JSON.parse(issueResult.out);
	} catch {
		return { name, status: "SKIP", detail: "gh CLI unavailable" };
	}

	const ownerLogin = issueJson.author?.login;
	const body = issueJson.body ?? "";
	const optionCount = detectEnumeratedOptions(body).count;

	if (/^決定:/m.test(body)) {
		return { name, status: "PASS", detail: "decision recorded in the issue body" };
	}

	const recordComment = (issueJson.comments ?? []).find(
		(c) => c.author?.login === ownerLogin && /^決定:/m.test(c.body ?? ""),
	);

	const firstCommitOut = exec("git", ["log", "--format=%aI", "--reverse", `origin/${base}..HEAD`]);
	const firstCommitIso = firstCommitOut.ok ? firstCommitOut.out.trim().split("\n")[0] || null : null;

	const timing = classifyDesignRecordTiming(recordComment?.createdAt, firstCommitIso);
	if (!recordComment) return { name, status: timing.status, detail: timing.detail };

	const content = classifyDesignRecordContent(recordComment.body, optionCount);
	const detail = [timing.detail, content.detail].filter(Boolean).join("; ") || undefined;
	if (timing.status === "FAIL" || content.status === "FAIL") return { name, status: "FAIL", detail };
	if (timing.status === "SKIP") return { name, status: "SKIP", detail };
	return { name, status: "PASS", detail };
}

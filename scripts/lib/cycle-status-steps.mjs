/**
 * cycle-status orchestration: the try/catch sequencing that turns four
 * independent I/O calls (git fetch, git log, gh pr list, the built CLI's
 * `status ready`, and a conditional gh issue lookup) into one JSON payload.
 * None of this branch wiring was covered — only the pure helpers in
 * cycle-status.mjs were (#645). `sh`/`githubOps`/`existsSync`/`readFileSync`
 * are injected so a test can supply canned I/O and assert which error field
 * gets set for which failure, without a real git/gh/filesystem in play.
 *
 * `sh` has the shape of lib/run-exec.mjs' `run`: it throws on failure (unlike
 * `tryRun`), matching how the top-level script already calls it. `shTry` is
 * `tryRun` itself, for the one call whose non-zero exit is a reading rather
 * than a breakage (release-status, #814).
 */

import { resolve } from "node:path";
import {
	buildGateCheckCommand,
	countBehind,
	findProcessIdsForIssueNumber,
	isUnregisteredManagedIssue,
	parsePorcelainPaths,
	parseReadyOutput,
	quoteShellArgument,
	summarizeReleasePending,
} from "./cycle-status.mjs";
/**
 * Return the CLI exit code for a preflight result.
 * @param {{blocking?: boolean, staleTree?: unknown, dirtyTree?: unknown}} result
 * @returns {0 | 1}
 */
export function cycleStatusExitCode(result) {
	return result.staleTree || result.dirtyTree || result.blocking ? 1 : 0;
}

/**
 * @param {{
 *   sh: (file: string, args: string[]) => string,
 *   shTry: (file: string, args: string[]) => {ok: boolean, out: string, status: number|null},
 *   githubOps: {listOpenPrs: () => Promise<any[]>, viewIssue: (params: {number: number, fields: string[]}) => Promise<any>},
 *   existsSync: (path: string) => boolean,
 *   readFileSync: (path: string, encoding: string) => string,
 *   root: string,
 *   base: string,
 *   issueNumbers?: number[],
 *   artifact?: string,
 * }} deps
 */
export async function runCycleStatus({
	sh,
	shTry,
	githubOps,
	existsSync,
	readFileSync,
	root,
	base,
	issueNumbers = [],
	artifact: requestedArtifact,
}) {
	let fetched = true;
	try {
		sh("git", ["fetch", "origin"]);
	} catch {
		fetched = false;
	}

	let behindBase = null;
	let behindBaseError = null;
	try {
		behindBase = countBehind(
			sh("git", ["log", "--oneline", `HEAD..origin/${base}`]),
		);
	} catch (e) {
		behindBaseError = e.message;
	}

	// A tree behind base serves this script's own older version, so the output
	// would describe which checks that version has — and a check absent there is
	// indistinguishable from one that ran and found nothing (#716). Withhold
	// every judgment rather than annotate them: annotation leaves the reader the
	// same interpretation that already failed once.
	if (behindBase > 0) {
		return {
			fetched,
			behindBase,
			staleTree: {
				base,
				message:
					`This tree is ${behindBase} commits behind origin/${base}, so this preflight ran from that older version of itself. ` +
					"Its judgments — including which checks exist at all — would describe the old tree, not this cycle. " +
					`Start the cycle's branch from origin/${base} (git switch -c <branch> origin/${base}) and re-run.`,
			},
		};
	}

	// The same accident as behindBase, arriving through the working tree instead
	// of through commits (#744). Switching branches carries uncommitted edits
	// along, so the previous cycle's changes are still sitting there to be swept
	// into this cycle's first commit — and neither gate-check (which reads
	// committed diffs) nor the pre-commit hook (which sees a file only once it
	// is staged, by which time it is already in) is positioned to say so.
	//
	// Refused rather than reported, unlike commitsAheadOfBase: a cycle is
	// expected to start from a clean tree, and `git worktree add` produces one,
	// so the refusal is answered by making a worktree rather than by weighing it.
	let uncommittedFiles = null;
	let dirtyTreeError = null;
	try {
		uncommittedFiles = parsePorcelainPaths(
			sh("git", ["status", "--porcelain"]),
		);
	} catch (e) {
		dirtyTreeError = e.message;
	}

	if (uncommittedFiles && uncommittedFiles.length > 0) {
		return {
			fetched,
			behindBase,
			uncommittedFiles,
			dirtyTree: {
				message:
					`This tree has ${uncommittedFiles.length} uncommitted change(s), so work started here would mix them into this cycle's commits. ` +
					"Commit or stash them, or start the cycle in a fresh worktree (git worktree add), and re-run.",
			},
		};
	}

	// Where HEAD sits, for the "second cycle in one session lands on the previous
	// cycle's branch" accident (#629). Reported, not refused: continuing an
	// existing branch is sometimes deliberate, so the judgement stays with the
	// reader — but at selection time, not at the terminal gate where the commits
	// are already stacked.
	let currentBranch = null;
	let commitsAheadOfBase = null;
	let headStateError = null;
	try {
		currentBranch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
		commitsAheadOfBase = countBehind(
			sh("git", ["log", "--oneline", `origin/${base}..HEAD`]),
		);
	} catch (e) {
		headStateError = e.message;
	}

	let openPRs = [];
	let prError = null;
	try {
		const prJson = await githubOps.listOpenPrs();
		openPRs = prJson.map(({ number, title }) => ({ number, title }));
	} catch (e) {
		prError = e.message;
	}

	// The publishing backlog, re-derived here every cycle instead of written
	// down (#814). `.pfdsl/roadmap.md` used to ask a cycle that saw a pending
	// release to note it as the next cycle's first task, without naming a place
	// to note it in: the only surface that existed at that moment was the PR
	// body, which the next cycle's executor never reads. Since the backlog is a
	// fact the registries and git already hold, it is taken from there and no
	// ledger of it can go stale.
	//
	// shTry rather than sh: release-status exits 1 whenever anything is
	// unpublished, which is the ordinary state between releases, so a non-zero
	// exit here is the reading itself and not a failed run.
	let releasePending = null;
	let releasePendingError = null;
	try {
		releasePending = summarizeReleasePending(
			shTry(process.execPath, [resolve(root, "scripts/release-status.mjs")]),
		);
	} catch (e) {
		releasePendingError = e.message;
	}

	const cliPath = resolve(root, "packages/cli/dist/cli.js");
	let ready = [];
	let readyError = null;
	if (existsSync(cliPath)) {
		try {
			const readyJson = JSON.parse(
				sh(process.execPath, [
					cliPath,
					"status",
					"ready",
					".pfdsl/roadmap.pfdsl",
					"--json",
				]),
			);
			({ ready } = parseReadyOutput(readyJson));
		} catch (e) {
			readyError = e.message;
		}
	} else {
		readyError =
			"packages/cli/dist/cli.js not built; run 'pnpm -r build' first";
	}

	// The operator selects targets explicitly from the ready decision material.
	// These identify source material to read, not a design or approval verdict.
	let issueError = null;
	const targetIssues = issueNumbers;

	const issueLookupFailures = [];
	/** @type {Map<number, string[]>} label names of each issue actually fetched */
	const labelsByIssue = new Map();

	if (targetIssues.length > 0) {
		for (const targetIssue of targetIssues) {
			try {
				const issueJson = await githubOps.viewIssue({
					number: targetIssue,
					fields: ["title", "body", "comments", "createdAt", "labels"],
				});
				labelsByIssue.set(
					targetIssue,
					(issueJson.labels ?? []).map((l) => l?.name).filter(Boolean),
				);
			} catch (e) {
				issueLookupFailures.push({ issue: targetIssue, error: e.message });
			}
		}
		if (issueLookupFailures.length > 0) {
			const lookupError =
				issueLookupFailures.length === 1
					? issueLookupFailures[0].error
					: issueLookupFailures
							.map(({ issue, error }) => `issue ${issue}: ${error}`)
							.join("; ");
			issueError = lookupError;
		}
	} else {
		issueError =
			"No --issue given. Choose a target from the ready list and rerun with --issue <number>; counts do not rank priority.";
	}

	// The artifact comes from the process each explicit issue maps to in
	// roadmap.pfdsl. Exempt issues may have no corresponding process.
	// Multiple processes or outputs require explicit artifact selection. Only
	// confirmed exempt targets without a process may use --no-artifact.
	let artifactKey = null;
	const artifactCandidates = new Map();
	let gateCheckCommandError = null;
	/** @type {number[]} target issues labelled flow:managed with no process yet */
	const unregisteredManagedIssues = [];
	/** @type {number[]} target issues with no flow label and no process yet */
	const untriagedTargetIssues = [];
	if (targetIssues.length > 0) {
		let roadmapText = null;
		try {
			roadmapText = readFileSync(
				resolve(root, ".pfdsl/roadmap.pfdsl"),
				"utf-8",
			);
		} catch (e) {
			gateCheckCommandError = `failed to read .pfdsl/roadmap.pfdsl: ${e.message}`;
		}
		if (roadmapText !== null) {
			const processIdsByIssue = new Map(
				targetIssues.map((issue) => [
					issue,
					findProcessIdsForIssueNumber(roadmapText, issue),
				]),
			);
			// The one moment the missing roadmap entry is actionable (#963): this
			// cycle is starting this issue, so its inputs and outputs are in hand.
			// audit-issues-flow reports the same gap for every open issue, but only
			// as advisory — see isUnregisteredManagedIssue.
			// Only issues whose labels were actually fetched are judged as managed.
			// When both the process and labels are unknown, however, the command must
			// fail closed: `--no-artifact` is valid only for a confirmed exempt issue.
			for (const [issue, processIds] of processIdsByIssue) {
				const processId = processIds[0] ?? null; // Existence check only.
				const labels = labelsByIssue.get(issue);
				if (labels === undefined) {
					if (processId === null) {
						gateCheckCommandError = `cannot determine whether issue ${issue} is flow:exempt because its labels could not be fetched: ${issueError}`;
					}
					continue;
				}
				if (isUnregisteredManagedIssue(labels, processId)) {
					unregisteredManagedIssues.push(issue);
				}
				if (processId === null && !labels.includes("flow:exempt")) {
					if (!labels.includes("flow:managed")) {
						untriagedTargetIssues.push(issue);
					}
					gateCheckCommandError = labels.includes("flow:managed")
						? `issue ${issue} is flow:managed but has no process in .pfdsl/roadmap.pfdsl`
						: `issue ${issue} has no process in .pfdsl/roadmap.pfdsl and is not flow:exempt`;
				}
			}
			const resolvedProcessIds = new Set(
				[...processIdsByIssue.values()].flat(),
			);
			if (
				!gateCheckCommandError &&
				resolvedProcessIds.size > 0 &&
				!existsSync(cliPath)
			) {
				const [processId] = resolvedProcessIds;
				gateCheckCommandError = `failed to resolve the output artifact for process '${processId}': packages/cli/dist/cli.js not built; run 'pnpm -r build' first`;
			} else if (!gateCheckCommandError) {
				for (const processId of resolvedProcessIds) {
					try {
						const neighborsJson = JSON.parse(
							sh(process.execPath, [
								cliPath,
								"graph",
								"neighbors",
								".pfdsl/roadmap.pfdsl",
								processId,
								"--json",
							]),
						);
						// `neighbors` tags each element since #828, and the artifact
						// under gate is the process's output, so name the kind rather
						// than taking [0]. It selects rather than rejects: feedback
						// edges only run artifact -> process (computeNeighbors in
						// packages/core/src/graph-analysis.ts, and N001/N002 keep an id
						// from being both), so a process has no feedback successor to
						// drop.
						if (
							neighborsJson?.ok !== true ||
							!Array.isArray(neighborsJson.successors)
						) {
							throw new Error("graph neighbors returned an invalid response");
						}
						const outputs = neighborsJson.successors.filter(
							(n) => n?.kind === "primary",
						);
						if (
							!outputs?.length ||
							outputs.some((n) => typeof n.id !== "string" || !n.id)
						) {
							throw new Error("graph neighbors returned no primary successor");
						}
						for (const { id } of outputs) {
							const producers = artifactCandidates.get(id) ?? new Set();
							producers.add(processId);
							artifactCandidates.set(id, producers);
						}
					} catch (e) {
						gateCheckCommandError = `failed to resolve the output artifact for process '${processId}': ${e.message}`;
						break;
					}
				}
				if (!gateCheckCommandError) {
					const candidates = [...artifactCandidates.keys()].sort();
					const selected =
						requestedArtifact ??
						(candidates.length === 1 ? candidates[0] : undefined);
					if (
						requestedArtifact !== undefined &&
						!artifactCandidates.has(requestedArtifact)
					) {
						gateCheckCommandError = `Artifact '${requestedArtifact}' is not a primary output of the target issues; candidates: ${candidates.join(", ") || "none"}`;
					} else if (candidates.length > 1 && selected === undefined) {
						gateCheckCommandError = `Multiple output artifacts match the target issues; rerun with --artifact <id>: ${candidates.join(", ")}`;
					} else if (selected !== undefined) {
						const producers = artifactCandidates.get(selected);
						const unrelated = [...processIdsByIssue]
							.filter(
								([, ids]) =>
									ids.length > 0 && !ids.some((id) => producers.has(id)),
							)
							.map(([issue]) => issue);
						if (unrelated.length > 0) {
							gateCheckCommandError = `Artifact '${selected}' does not belong to the mapped processes for issues: ${unrelated.join(", ")}`;
						} else {
							artifactKey = selected;
						}
					}
				}
			}
		}
	} else {
		gateCheckCommandError =
			"Choose a target and rerun with --issue <number> to resolve a gate-check command.";
	}
	const gateCheckCommand = gateCheckCommandError
		? null
		: buildGateCheckCommand(artifactKey, base, targetIssues);
	const wipUpdateCommand =
		!gateCheckCommandError && artifactKey
			? `node packages/cli/dist/cli.js meta set .pfdsl/roadmap.pfdsl ${quoteShellArgument(artifactKey)} status wip`
			: undefined;

	const result = {
		fetched,
		behindBase,
		currentBranch,
		commitsAheadOfBase,
		openPRs,
		releasePending,
		ready,
		issueTargets: targetIssues.map((issue) => ({
			issue,
			source: "flag",
		})),
		manualChecks: [
			"MANUAL: Before starting, read the primary issue records for every issueTargets entry and follow 適用点 1 で採用案と対案を比較して設計を決める in .pfdsl/bindings/pfd-ops.md. Resolve missing targets or failed reads first; this output does not verify design decisions or approvals.",
		],
		issueLookupFailures,
		blocking: issueLookupFailures.length > 0,
		wipUpdateCommand,
		artifactCandidates: [...artifactCandidates.keys()].sort(),
		gateCheckCommand,
		unregisteredManagedIssues,
		untriagedTargetIssues,
	};
	if (behindBaseError) result.behindBaseError = behindBaseError;
	if (dirtyTreeError) result.dirtyTreeError = dirtyTreeError;
	if (headStateError) result.headStateError = headStateError;
	if (prError) result.prError = prError;
	if (releasePendingError) result.releasePendingError = releasePendingError;
	if (readyError) result.readyError = readyError;
	if (issueError) result.issueError = issueError;
	if (gateCheckCommandError)
		result.gateCheckCommandError = gateCheckCommandError;
	return result;
}

// Bidirectional canonical<->deployed sync for the pfd-ops "install/" tree
// (#547). check-install-sync.mjs (distributed inside the skill, canonical ->
// deployed only) assumes editors always start from the canonical copy, but
// the natural editing direction is the opposite: the deployed copy is what
// actually runs and what tests import. This module adds the "staged-side
// wins" resolution so a pre-commit hook can sync in whichever direction the
// human actually edited, without requiring them to remember which way to
// `cp`.
//
// Repo-local (scripts/lib/, not .claude/skills/pfd-ops/scripts/) per the
// design decision recorded at
// https://github.com/takasek/pfdsl/issues/547#issuecomment-5081730203: an
// adopting repo must never lift its own local edits here into the
// distributed skill tree, so this file intentionally does not import
// check-install-sync.mjs (and must not be imported by it either) — file
// enumeration is reimplemented locally instead of shared.
//
// Orphan handling (a file dropped from canonical install/ entirely) is out
// of scope here — that stays the job of check-install-sync.mjs --deploy.
// This module only ever reconciles files that currently exist under
// canonicalDir.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Recursively enumerate files under installDir, returning paths relative to
 * it (forward-slash separated, sorted). Mirrors listInstallFiles in
 * check-install-sync.mjs; reimplemented here rather than imported (see file
 * header) so this repo-local tool never depends on the distributed skill
 * tree.
 * @param {string} installDir
 * @returns {string[]}
 */
export function listInstallFiles(installDir) {
	if (!existsSync(installDir)) return [];
	const results = [];
	function walk(dir, relPrefix) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, rel);
			} else if (entry.isFile() || entry.isSymbolicLink()) {
				results.push(rel);
			}
		}
	}
	walk(installDir, "");
	return results.sort();
}

function filesEqual(pathA, pathB) {
	return readFileSync(pathA).equals(readFileSync(pathB));
}

function modesEqual(pathA, pathB) {
	return statSync(pathA).mode === statSync(pathB).mode;
}

/**
 * Build a reconciliation plan for the canonical (install/) <-> deployed
 * (repo root) file pairs. Each divergent pair resolves to exactly one of:
 *   - "lift": copy deployed -> canonical
 *   - "deploy": copy canonical -> deployed
 *   - "ambiguous": both sides staged with differing content; caller must
 *     stop and ask the human to pick a side
 *   - "unstagedSkipped": divergence exists only in the working tree; leave
 *     alone
 * Byte-identical pairs with identical file modes are in sync and omitted
 * from the plan entirely (#421: a mode-only difference still counts as
 * divergence, since copyFileSync doesn't reliably preserve mode on Linux).
 *
 * `stagedPaths` are repo-root-relative paths as produced by
 * `git diff --cached --name-only` (matches how canonicalRepoPath/
 * deployedRepoPath below are computed via `relative(targetRoot, ...)`).
 * When omitted/undefined/null, every divergence resolves as "lift" (manual
 * mode: the natural editing direction is deployed -> canonical) except when
 * the deployed side doesn't exist at all, in which case there is nothing to
 * lift from and "deploy" is used instead.
 *
 * @param {{canonicalDir: string, targetRoot: string, stagedPaths?: Iterable<string>|null}} options
 * @returns {Array<{rel: string, action: "lift"|"deploy"|"ambiguous"|"unstagedSkipped", canonicalPath: string, deployedPath: string, canonicalRepoPath: string, deployedRepoPath: string}>}
 */
export function planInstallSync({ canonicalDir, targetRoot, stagedPaths }) {
	const manual = stagedPaths === undefined || stagedPaths === null;
	const staged = manual ? null : new Set(stagedPaths);

	const plan = [];
	for (const rel of listInstallFiles(canonicalDir)) {
		const canonicalPath = join(canonicalDir, rel);
		const deployedPath = join(targetRoot, rel);
		const canonicalRepoPath = relative(targetRoot, canonicalPath);
		const deployedRepoPath = relative(targetRoot, deployedPath);
		const entry = { rel, canonicalPath, deployedPath, canonicalRepoPath, deployedRepoPath };

		const deployedExists = existsSync(deployedPath);
		if (deployedExists && filesEqual(canonicalPath, deployedPath) && modesEqual(canonicalPath, deployedPath)) {
			continue; // in sync — not part of the plan
		}

		const canonicalStaged = !manual && staged.has(canonicalRepoPath);

		if (!deployedExists) {
			// Nothing to lift from; the only sensible resolution is deploy,
			// gated by the same staged-side rule as everything else (manual
			// mode counts as "canonical wins" here too).
			plan.push({ ...entry, action: manual || canonicalStaged ? "deploy" : "unstagedSkipped" });
			continue;
		}

		if (manual) {
			plan.push({ ...entry, action: "lift" });
			continue;
		}

		const deployedStaged = staged.has(deployedRepoPath);
		if (canonicalStaged && deployedStaged) {
			plan.push({ ...entry, action: "ambiguous" });
		} else if (deployedStaged) {
			plan.push({ ...entry, action: "lift" });
		} else if (canonicalStaged) {
			plan.push({ ...entry, action: "deploy" });
		} else {
			plan.push({ ...entry, action: "unstagedSkipped" });
		}
	}
	return plan;
}

// After every copy, restore the source file's mode onto the destination —
// copyFileSync's mode handling is platform-dependent (preserved on
// macOS/APFS via clonefile, dropped to the umask default on Linux), so
// canonical and deployed would otherwise silently diverge in mode bits
// even right after a sync (#421).
function copyWithMode(srcPath, destPath) {
	mkdirSync(dirname(destPath), { recursive: true });
	copyFileSync(srcPath, destPath);
	chmodSync(destPath, statSync(srcPath).mode);
}

/**
 * Apply a plan built by planInstallSync: perform the "lift"/"deploy" copies
 * (with mode restoration), leaving "ambiguous"/"unstagedSkipped" entries
 * untouched. Safe to call with a plan that still contains ambiguous entries
 * — they're simply skipped — but callers driving a commit gate should check
 * for them first and refuse to proceed (see scripts/sync-install.mjs).
 * @param {ReturnType<typeof planInstallSync>} plan
 * @returns {Array<{rel: string, action: "lift"|"deploy", wrote: string, from: string}>}
 */
export function applyInstallSync(plan) {
	const changed = [];
	for (const entry of plan) {
		if (entry.action === "lift") {
			copyWithMode(entry.deployedPath, entry.canonicalPath);
			changed.push({ rel: entry.rel, action: "lift", wrote: entry.canonicalRepoPath, from: entry.deployedRepoPath });
		} else if (entry.action === "deploy") {
			copyWithMode(entry.canonicalPath, entry.deployedPath);
			changed.push({ rel: entry.rel, action: "deploy", wrote: entry.deployedRepoPath, from: entry.canonicalRepoPath });
		}
	}
	return changed;
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	checkInstallSync,
	classifyTarget,
	deployInstall,
	evaluateMigration,
	listInstallFiles,
	parseArgs,
	readManifest,
	UPSTREAM_MARKERS,
} from "../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs";
import { computeManifestAggregateHash } from "../../.claude/skills/pfd-ops/scripts/plugin-version-check.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "check-install-sync-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

// Shared fixture for checkInstallSync/deployInstall tests: a skill root with
// a two-file install/ tree (one top-level file, one nested).
function makeSkillRoot() {
	const skillRoot = join(tmp, "skill");
	writeFile(join(skillRoot, "install"), "a.txt", "canonical-a");
	writeFile(join(skillRoot, "install"), "sub/b.txt", "canonical-b");
	return skillRoot;
}

describe("listInstallFiles", () => {
	it("enumerates nested files under install/ as relative paths", () => {
		const installDir = join(tmp, "install");
		writeFile(installDir, ".github/workflows/flow-on-issue-close.yml", "a");
		writeFile(installDir, "scripts/audit-issues-flow.mjs", "b");
		writeFile(installDir, "scripts/lib/issues-flow-audit.mjs", "c");

		assert.deepEqual(listInstallFiles(installDir), [
			".github/workflows/flow-on-issue-close.yml",
			"scripts/audit-issues-flow.mjs",
			"scripts/lib/issues-flow-audit.mjs",
		]);
	});

	it("returns an empty array when install/ does not exist", () => {
		assert.deepEqual(listInstallFiles(join(tmp, "nonexistent")), []);
	});

	it("includes a symlinked file rather than silently dropping it", () => {
		const installDir = join(tmp, "install");
		writeFile(installDir, "real.txt", "a");
		symlinkSync(join(installDir, "real.txt"), join(installDir, "linked.txt"));

		assert.deepEqual(listInstallFiles(installDir), ["linked.txt", "real.txt"]);
	});
});

describe("checkInstallSync", () => {
	it("reports not-adopted when zero deployed files exist at target", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-empty");
		mkdirSync(targetRoot, { recursive: true });

		const { adopted, results } = checkInstallSync(skillRoot, targetRoot);
		assert.equal(adopted, false);
		assert.ok(results.every((r) => r.status === "missing"));
	});

	it("classifies ok/modified/missing per file", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-mixed");
		writeFile(targetRoot, "a.txt", "canonical-a"); // matches -> ok
		writeFile(targetRoot, "sub/b.txt", "locally-edited"); // differs -> modified
		// (no scripts/audit... third file expected: only 2 files declared above)

		const { adopted, results } = checkInstallSync(skillRoot, targetRoot);
		assert.equal(adopted, true);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r.status]));
		assert.equal(byPath["a.txt"], "ok");
		assert.equal(byPath["sub/b.txt"], "modified");
	});

	it("classifies a file as missing when absent from target", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-partial");
		writeFile(targetRoot, "a.txt", "canonical-a");

		const { results } = checkInstallSync(skillRoot, targetRoot);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r.status]));
		assert.equal(byPath["a.txt"], "ok");
		assert.equal(byPath["sub/b.txt"], "missing");
	});

	it("reports a file removed from canonical install/ as orphaned, using the deploy manifest", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-orphan");
		mkdirSync(targetRoot, { recursive: true });

		// Simulate a prior deploy when sub/b.txt was still canonical.
		deployInstall(skillRoot, targetRoot);

		// Simulate a future pfdsl release dropping sub/b.txt from canonical install/.
		rmSync(join(skillRoot, "install", "sub", "b.txt"));

		const { results } = checkInstallSync(skillRoot, targetRoot);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r.status]));
		assert.equal(byPath["a.txt"], "ok");
		assert.equal(byPath["sub/b.txt"], "orphaned");
	});

	it("does not report a file as orphaned when no manifest exists (never deployed via this tool)", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-no-manifest");
		// A file that merely happens to match a canonical filename, placed by
		// some other means (no prior --deploy, no manifest) is not "orphaned".
		writeFile(targetRoot, "unrelated.txt", "whatever");

		const { results } = checkInstallSync(skillRoot, targetRoot);
		assert.ok(!results.some((r) => r.path === "unrelated.txt"));
	});

	it("ignores malformed manifest entries instead of crashing", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-malformed-manifest");
		writeFile(targetRoot, "a.txt", "canonical-a");
		writeFile(
			targetRoot,
			".claude/pfd-ops-install-manifest.json",
			JSON.stringify({
				files: [
					{},
					"not-an-object",
					{ path: 123, hash: "x" },
					{ path: "a.txt", hash: "irrelevant" },
				],
			}),
		);

		const { results } = checkInstallSync(skillRoot, targetRoot);
		assert.ok(!results.some((r) => r.status === "orphaned"));
	});
});

describe("checkInstallSync rename candidates", () => {
	// Renaming a canonical file splits into an unrelated-looking "missing" and
	// "orphaned" pair, so a repo carrying a local edit on the old path gets the
	// bare upstream file at the new path with no hint that its customization
	// needs carrying over (#603).
	function deployThenRename(targetRoot, from, to, { newContent } = {}) {
		const skillRoot = join(tmp, "skill-rename");
		writeFile(join(skillRoot, "install"), from, "canonical-original");
		deployInstall(skillRoot, targetRoot);
		rmSync(join(skillRoot, "install", ...from.split("/")));
		writeFile(
			join(skillRoot, "install"),
			to,
			newContent ?? "canonical-original",
		);
		return skillRoot;
	}

	it("pairs an orphan with a missing file that carries the same canonical hash", () => {
		const targetRoot = join(tmp, "target-rename-hash");
		const skillRoot = deployThenRename(
			targetRoot,
			"scripts/old.mjs",
			"scripts/pfdsl/new.mjs",
		);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, [
			{
				from: "scripts/old.mjs",
				to: "scripts/pfdsl/new.mjs",
				reason: "same canonical hash",
			},
		]);
	});

	it("pairs a moved file whose content also changed, by basename", () => {
		const targetRoot = join(tmp, "target-rename-basename");
		const skillRoot = deployThenRename(
			targetRoot,
			"scripts/lib/gh-exec.mjs",
			"scripts/pfdsl/lib/gh-exec.mjs",
			{
				newContent: "canonical-rewritten",
			},
		);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, [
			{
				from: "scripts/lib/gh-exec.mjs",
				to: "scripts/pfdsl/lib/gh-exec.mjs",
				reason: "same basename",
			},
		]);
	});

	it("pairs a prefixed basename when the prefix ends at a separator", () => {
		const targetRoot = join(tmp, "target-rename-suffix");
		const skillRoot = deployThenRename(
			targetRoot,
			".github/workflows/sweep-completed-chains.yml",
			".github/workflows/pfdsl-sweep-completed-chains.yml",
			{ newContent: "canonical-rewritten" },
		);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, [
			{
				from: ".github/workflows/sweep-completed-chains.yml",
				to: ".github/workflows/pfdsl-sweep-completed-chains.yml",
				reason: "same basename suffix",
			},
		]);
	});

	it("does not pair an orphan with an unrelated missing file", () => {
		const targetRoot = join(tmp, "target-rename-unrelated");
		const skillRoot = deployThenRename(
			targetRoot,
			"scripts/old.mjs",
			"scripts/unrelated.mjs",
			{
				newContent: "canonical-rewritten",
			},
		);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, []);
	});

	it("does not treat a mid-word basename overlap as a suffix match", () => {
		const targetRoot = join(tmp, "target-rename-midword");
		const skillRoot = deployThenRename(
			targetRoot,
			"scripts/exec.mjs",
			"scripts/ghexec.mjs",
			{
				newContent: "canonical-rewritten",
			},
		);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, []);
	});

	it("reports no candidates when nothing was renamed", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-rename-none");
		deployInstall(skillRoot, targetRoot);

		const { renameCandidates } = checkInstallSync(skillRoot, targetRoot);
		assert.deepEqual(renameCandidates, []);
	});
});

describe("deployInstall", () => {
	it("updates an unedited deployment and records the installed canonical hash", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-upgrade");
		deployInstall(skillRoot, targetRoot);
		const previous = readManifest(targetRoot);
		writeFile(join(skillRoot, "install"), "a.txt", "new-canonical");
		const result = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(result.skipped, []);
		assert.equal(
			readFileSync(join(targetRoot, "a.txt"), "utf8"),
			"new-canonical",
		);
		assert.notDeepEqual(readManifest(targetRoot), previous);
		const fresh = join(tmp, "fresh-upgrade");
		deployInstall(skillRoot, fresh);
		assert.deepEqual(readManifest(targetRoot), readManifest(fresh));
	});

	it("retains the last deployed hash across skipped upgrades and later overwrites", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-skipped-upgrade");
		deployInstall(skillRoot, targetRoot);
		const previous = readManifest(targetRoot);
		writeFile(targetRoot, "a.txt", "local-edit");
		writeFile(join(skillRoot, "install"), "a.txt", "new-canonical");
		for (let n = 0; n < 2; n++) {
			assert.deepEqual(deployInstall(skillRoot, targetRoot).skipped, ["a.txt"]);
			assert.equal(
				readFileSync(join(targetRoot, "a.txt"), "utf8"),
				"local-edit",
			);
			assert.deepEqual(readManifest(targetRoot), previous);
		}
		deployInstall(skillRoot, targetRoot, { overwriteLocalEdits: true });
		assert.equal(
			readFileSync(join(targetRoot, "a.txt"), "utf8"),
			"new-canonical",
		);
		assert.notDeepEqual(readManifest(targetRoot), previous);
	});

	it("does not claim an untracked conflicting file, including on repeated deploys", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-untracked");
		writeFile(targetRoot, "a.txt", "existing-content");
		for (let n = 0; n < 2; n++) {
			assert.deepEqual(deployInstall(skillRoot, targetRoot).skipped, ["a.txt"]);
			assert.equal(
				readManifest(targetRoot).some((entry) => entry.path === "a.txt"),
				false,
			);
		}
	});

	it("adopts an existing file already equal to the new canonical", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-converged");
		deployInstall(skillRoot, targetRoot);
		writeFile(targetRoot, "a.txt", "new-canonical");
		writeFile(join(skillRoot, "install"), "a.txt", "new-canonical");
		assert.deepEqual(deployInstall(skillRoot, targetRoot).skipped, []);
		writeFile(join(skillRoot, "install"), "a.txt", "next-canonical");
		assert.deepEqual(deployInstall(skillRoot, targetRoot).skipped, []);
		assert.equal(
			readFileSync(join(targetRoot, "a.txt"), "utf8"),
			"next-canonical",
		);
	});

	it("copies every canonical file into an empty target, creating directories as needed", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-fresh");
		mkdirSync(targetRoot, { recursive: true });

		const { copied, skipped } = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(copied.sort(), ["a.txt", "sub/b.txt"]);
		assert.deepEqual(skipped, []);
		assert.equal(
			readFileSync(join(targetRoot, "a.txt"), "utf-8"),
			"canonical-a",
		);
		assert.equal(
			readFileSync(join(targetRoot, "sub", "b.txt"), "utf-8"),
			"canonical-b",
		);
	});

	it("skips a locally-edited file without --overwrite-local-edits and leaves it untouched", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-edited");
		writeFile(targetRoot, "a.txt", "locally-edited");

		const { copied, skipped } = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(copied.sort(), ["sub/b.txt"]);
		assert.deepEqual(skipped, ["a.txt"]);
		assert.equal(
			readFileSync(join(targetRoot, "a.txt"), "utf-8"),
			"locally-edited",
		);
	});

	it("overwrites a locally-edited file when overwriteLocalEdits is given", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-overwrite-edits");
		writeFile(targetRoot, "a.txt", "locally-edited");

		const { copied, skipped } = deployInstall(skillRoot, targetRoot, {
			overwriteLocalEdits: true,
		});
		assert.deepEqual(copied.sort(), ["a.txt", "sub/b.txt"]);
		assert.deepEqual(skipped, []);
		assert.equal(
			readFileSync(join(targetRoot, "a.txt"), "utf-8"),
			"canonical-a",
		);
	});

	it("keeps a locally-edited file when only deleteEditedOrphans is given", () => {
		// The #603 accident: sweeping an orphaned old path must not also revert
		// the customization just re-applied to the surviving canonical path.
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-delete-edited-orphans-only");
		deployInstall(skillRoot, targetRoot);
		writeFile(targetRoot, "a.txt", "locally-edited");
		writeFile(targetRoot, "sub/b.txt", "locally-edited-before-drop");
		rmSync(join(skillRoot, "install", "sub", "b.txt"));

		const { copied, skipped, removed } = deployInstall(skillRoot, targetRoot, {
			deleteEditedOrphans: true,
		});
		assert.deepEqual(copied, []);
		assert.deepEqual(skipped, ["a.txt"]);
		assert.deepEqual(removed, ["sub/b.txt"]);
		assert.equal(
			readFileSync(join(targetRoot, "a.txt"), "utf-8"),
			"locally-edited",
		);
	});

	it("keeps a locally-modified orphan when only overwriteLocalEdits is given", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-overwrite-edits-only");
		deployInstall(skillRoot, targetRoot);
		writeFile(targetRoot, "a.txt", "locally-edited");
		writeFile(targetRoot, "sub/b.txt", "locally-edited-before-drop");
		rmSync(join(skillRoot, "install", "sub", "b.txt"));

		const { copied, removed, orphanSkipped } = deployInstall(
			skillRoot,
			targetRoot,
			{
				overwriteLocalEdits: true,
			},
		);
		assert.deepEqual(copied, ["a.txt"]);
		assert.deepEqual(removed, []);
		assert.deepEqual(orphanSkipped, ["sub/b.txt"]);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), true);
	});

	it("removes an unmodified file that a later canonical release dropped from install/", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-orphan-cleanup");
		deployInstall(skillRoot, targetRoot);

		rmSync(join(skillRoot, "install", "sub", "b.txt"));
		const { removed, orphanSkipped } = deployInstall(skillRoot, targetRoot);

		assert.deepEqual(removed, ["sub/b.txt"]);
		assert.deepEqual(orphanSkipped, []);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), false);
	});

	it("skips removing an orphaned file that was locally modified, unless forced", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-orphan-edited");
		deployInstall(skillRoot, targetRoot);
		writeFile(targetRoot, "sub/b.txt", "locally-edited-before-drop");

		rmSync(join(skillRoot, "install", "sub", "b.txt"));
		const first = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(first.removed, []);
		assert.deepEqual(first.orphanSkipped, ["sub/b.txt"]);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), true);

		const forced = deployInstall(skillRoot, targetRoot, {
			deleteEditedOrphans: true,
		});
		assert.deepEqual(forced.removed, ["sub/b.txt"]);
		assert.equal(existsSync(join(targetRoot, "sub", "b.txt")), false);
	});

	it("ignores malformed manifest entries instead of crashing", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-malformed-manifest-deploy");
		writeFile(
			targetRoot,
			".claude/pfd-ops-install-manifest.json",
			JSON.stringify({
				files: [{}, "not-an-object", { path: 123, hash: "x" }],
			}),
		);

		const { copied } = deployInstall(skillRoot, targetRoot);
		assert.deepEqual(copied.sort(), ["a.txt", "sub/b.txt"]);
	});

	it("copies the canonical file's mode onto a freshly created target file", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-mode-fresh");
		mkdirSync(targetRoot, { recursive: true });
		chmodSync(join(skillRoot, "install", "a.txt"), 0o755);

		deployInstall(skillRoot, targetRoot);
		assert.equal(statSync(join(targetRoot, "a.txt")).mode & 0o777, 0o755);
	});

	it("re-applies the canonical mode onto a target file that already exists with a different mode", () => {
		const skillRoot = makeSkillRoot();
		const targetRoot = join(tmp, "target-mode-existing");
		writeFile(targetRoot, "a.txt", "canonical-a");
		chmodSync(join(targetRoot, "a.txt"), 0o644);
		chmodSync(join(skillRoot, "install", "a.txt"), 0o755);

		deployInstall(skillRoot, targetRoot);
		assert.equal(statSync(join(targetRoot, "a.txt")).mode & 0o777, 0o755);
	});
});

describe("classifyTarget", () => {
	// A repo root is where .git sits, so every fixture that stands for a real
	// repository gets one — that is also what lets a subdirectory target be
	// classified by the repo that contains it.
	function makeRepo(name, { markers = [], git = true } = {}) {
		const root = join(tmp, name);
		mkdirSync(root, { recursive: true });
		if (git) writeFile(root, ".git", "gitdir: elsewhere\n");
		for (const marker of markers) {
			writeFile(root, marker.path, `prelude\n${marker.mustContain}\n`);
		}
		return root;
	}

	function externalSkillRoot() {
		const skillRoot = join(tmp, "plugin-cache/skills/pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		return skillRoot;
	}

	it("classifies a repo carrying every upstream marker as upstream", () => {
		const target = makeRepo("upstream-repo", { markers: UPSTREAM_MARKERS });
		assert.equal(classifyTarget(externalSkillRoot(), target).kind, "upstream");
	});

	it("classifies a repo carrying no upstream marker as adopter", () => {
		const target = makeRepo("adopter-repo");
		assert.equal(classifyTarget(externalSkillRoot(), target).kind, "adopter");
	});

	it("ignores a marker path whose content is unrelated to pfd-ops", () => {
		// "scripts/gen-install.mjs" is an ordinary name. An adopting repo that
		// happens to own that path would otherwise be called ambiguous and lose
		// the ability to adopt at all — the primary flow, blocked by a filename
		// collision. Matching on what the file says removes that class entirely.
		const target = makeRepo("coincidental-name");
		writeFile(target, "scripts/gen-install.mjs", "// an unrelated generator\n");
		assert.equal(classifyTarget(externalSkillRoot(), target).kind, "adopter");
	});

	it("classifies a partial marker set as ambiguous rather than adopter", () => {
		// Sparse checkouts, half-finished vendoring and old branches all show up
		// as some-but-not-all. Treating a missing marker as proof of "not
		// upstream" is what would let a deploy overwrite a generator's sources.
		const target = makeRepo("partial-repo", {
			markers: UPSTREAM_MARKERS.slice(0, 1),
		});
		assert.equal(classifyTarget(externalSkillRoot(), target).kind, "ambiguous");
	});

	it("names every marker it found and every one it missed", () => {
		// The report has to let a reader check the verdict against their own
		// tree, so both halves are reported rather than just the count.
		const target = makeRepo("partial-report", {
			markers: UPSTREAM_MARKERS.slice(0, 1),
		});
		const result = classifyTarget(externalSkillRoot(), target);
		assert.deepEqual(result.presentMarkers, [UPSTREAM_MARKERS[0].path]);
		assert.deepEqual(
			result.missingMarkers,
			UPSTREAM_MARKERS.slice(1).map((m) => m.path),
		);
	});

	it("classifies an external skill root over a repo-local pfd-ops install/ as ambiguous", () => {
		const target = makeRepo("vendored-repo");
		writeFile(
			target,
			".claude/skills/pfd-ops/install/a.txt",
			"repo-local canonical\n",
		);
		const result = classifyTarget(externalSkillRoot(), target);
		assert.equal(result.kind, "ambiguous");
		assert.match(result.competingCanonical, /\.claude\/skills\/pfd-ops$/);
	});

	it("keeps a repo-local run over its own vendored copy an adopter", () => {
		// Same two entities as above, except this time the running script is the
		// repo-local one — there is no second claimant, only one seen twice.
		const target = makeRepo("self-hosted-repo");
		writeFile(
			target,
			".claude/skills/pfd-ops/install/a.txt",
			"repo-local canonical\n",
		);
		const skillRoot = join(target, ".claude/skills/pfd-ops");
		assert.equal(classifyTarget(skillRoot, target).kind, "adopter");
	});

	it("finds the markers from a subdirectory target by ascending to the repo root", () => {
		// --target defaults to cwd, so a run started anywhere below the repo root
		// would otherwise see no markers and classify the upstream repo as an
		// adopter — a bypass of the very stop this classification exists for.
		const repo = makeRepo("upstream-subdir", { markers: UPSTREAM_MARKERS });
		const sub = join(repo, "packages/cli");
		mkdirSync(sub, { recursive: true });
		assert.equal(classifyTarget(externalSkillRoot(), sub).kind, "upstream");
	});

	it("falls back to the target itself when no .git ancestor exists", () => {
		const target = makeRepo("no-git", { git: false });
		assert.equal(classifyTarget(externalSkillRoot(), target).kind, "adopter");
	});

	it("does not mistake a sibling directory whose path shares a prefix for a containing one", () => {
		// "/x/repo-a".startsWith("/x/repo") is true, so a string-prefix
		// containment test would call this skill root repo-local and skip the
		// competing-canonical check.
		const target = makeRepo("repo");
		writeFile(
			target,
			".claude/skills/pfd-ops/install/a.txt",
			"repo-local canonical\n",
		);
		const sibling = join(tmp, "repo-a/.claude/skills/pfd-ops");
		mkdirSync(sibling, { recursive: true });
		assert.equal(classifyTarget(sibling, target).kind, "ambiguous");
	});
});

describe("UPSTREAM_MARKERS against this repo", () => {
	// The list is hardcoded inside a distributed script that may not import
	// anything outside its own skill tree, so it cannot be derived from
	// scripts/lib/gen-install-trigger.mjs, which names the same paths for its
	// own purpose. Nothing else would notice the two drifting apart: renaming
	// the generator would leave the markers pointing at a path that no longer
	// exists, and this repo would silently classify as an adopter — the exact
	// misclassification the markers exist to prevent. This test is the join.
	it("every marker matches in this repo, which is the upstream one", () => {
		for (const marker of UPSTREAM_MARKERS) {
			const full = join(repoRoot, ...marker.path.split("/"));
			assert.ok(
				existsSync(full),
				`${marker.path} no longer exists in this repo`,
			);
			assert.ok(
				readFileSync(full, "utf-8").includes(marker.mustContain),
				`${marker.path} no longer contains ${marker.mustContain}`,
			);
		}
	});

	it("classifies this repo's own root as upstream", () => {
		const skillRoot = join(repoRoot, ".claude/skills/pfd-ops");
		assert.equal(classifyTarget(skillRoot, repoRoot).kind, "upstream");
	});
});

describe("CLI output", () => {
	const scriptPath = fileURLToPath(
		new URL(
			"../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs",
			import.meta.url,
		),
	);

	function runCli(skillRoot, targetRoot, extraArgs = []) {
		// The script resolves install/ from its own location, so it has to be
		// copied into the fixture skill root rather than symlinked there: the
		// ESM loader realpath-resolves import.meta.url (see the note at the
		// bottom of the script), so a symlink would silently point skillRoot at
		// the repository's own install/ tree and the fixture would go unread.
		// plugin-version-check.mjs comes along as the script's only sibling
		// import.
		const stubScripts = join(skillRoot, "scripts");
		mkdirSync(stubScripts, { recursive: true });
		const stubScript = join(stubScripts, "check-install-sync.mjs");
		copyFileSync(scriptPath, stubScript);
		copyFileSync(
			join(dirname(scriptPath), "plugin-version-check.mjs"),
			join(stubScripts, "plugin-version-check.mjs"),
		);
		return spawnSync(
			process.execPath,
			[stubScript, "--target", targetRoot, ...extraArgs],
			{
				encoding: "utf-8",
			},
		);
	}

	// The #971 reproduction: an old plugin cache pointed at the repo that
	// generates its install/ tree. Canonical runs the other way there, so every
	// --deploy this tool could suggest would regress the sources.
	function makeUpstreamTarget(name, markers = UPSTREAM_MARKERS) {
		const target = join(tmp, name);
		mkdirSync(target, { recursive: true });
		writeFile(target, ".git", "gitdir: elsewhere\n");
		for (const marker of markers) {
			writeFile(target, marker.path, `prelude\n${marker.mustContain}\n`);
		}
		return target;
	}

	it("does not offer adoption when the target is the upstream repo", () => {
		const skillRoot = join(tmp, "skill-upstream-adopt");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"cached\n",
		);
		const target = makeUpstreamTarget("target-upstream-adopt");

		const { stdout } = runCli(skillRoot, target);
		assert.doesNotMatch(stdout, /To adopt it/);
		assert.match(stdout, /upstream/i);
	});

	it("does not offer a refresh deploy when the target is the upstream repo", () => {
		const skillRoot = join(tmp, "skill-upstream-drift");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"cached\n",
		);
		const target = makeUpstreamTarget("target-upstream-drift");
		writeFile(target, "scripts/lib/fixture-tool.mjs", "newer than the cache\n");

		const { stdout } = runCli(skillRoot, target);
		assert.doesNotMatch(stdout, /--deploy/);
		// What the reader can actually do instead.
		assert.match(stdout, /repo-local|update the plugin/i);
	});

	it("refuses an explicit --deploy into the upstream repo without writing anything", () => {
		const skillRoot = join(tmp, "skill-upstream-deploy");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"cached\n",
		);
		const target = makeUpstreamTarget("target-upstream-deploy");
		writeFile(target, "scripts/lib/fixture-tool.mjs", "newer than the cache\n");

		for (const extra of [
			[],
			["--overwrite-local-edits"],
			["--delete-edited-orphans"],
		]) {
			const result = runCli(skillRoot, target, ["--deploy", ...extra]);
			assert.notEqual(result.status, 0);
			assert.equal(
				readFileSync(join(target, "scripts/lib/fixture-tool.mjs"), "utf-8"),
				"newer than the cache\n",
			);
			assert.equal(
				existsSync(join(target, ".claude/pfd-ops-install-manifest.json")),
				false,
			);
		}
	});

	it("refuses to deploy and names both claimants when canonical is ambiguous", () => {
		const skillRoot = join(tmp, "skill-ambiguous");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"cached\n",
		);
		const target = makeUpstreamTarget(
			"target-ambiguous",
			UPSTREAM_MARKERS.slice(0, 1),
		);

		const checked = runCli(skillRoot, target);
		assert.match(checked.stdout, /ambiguous/i);
		assert.doesNotMatch(checked.stdout, /--deploy/);

		const deployed = runCli(skillRoot, target, ["--deploy"]);
		assert.notEqual(deployed.status, 0);
		assert.equal(
			existsSync(join(target, "scripts/lib/fixture-tool.mjs")),
			false,
		);
	});

	it("points a repo-local run in the upstream repo at the generator, not at the plugin", () => {
		// In the upstream repo the comparison still says something useful — it is
		// the gen-install drift check — but the fix is to regenerate the mirror,
		// not to update or re-run some other copy of this script.
		const target = makeUpstreamTarget("target-upstream-local");
		const skillRoot = join(target, ".claude/skills/pfd-ops");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"mirror\n",
		);
		writeFile(
			target,
			"scripts/lib/fixture-tool.mjs",
			"source edited since gen-install\n",
		);

		const { stdout } = runCli(skillRoot, target);
		assert.doesNotMatch(stdout, /--deploy/);
		assert.match(stdout, /gen-install/);
		assert.doesNotMatch(stdout, /update the plugin/i);
	});

	it("exits zero for a repo-local upstream run whose mirror is in sync", () => {
		const target = makeUpstreamTarget("target-upstream-local-clean");
		const skillRoot = join(target, ".claude/skills/pfd-ops");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"mirror\n",
		);
		writeFile(target, "scripts/lib/fixture-tool.mjs", "mirror\n");

		const { status, stdout } = runCli(skillRoot, target);
		assert.equal(status, 0);
		assert.match(stdout, /in sync/);
	});

	it("describes both outdated and edited adopter files as different from the bundle", () => {
		const skillRoot = makeSkillRoot();
		const target = join(tmp, "target-adopter-differences");
		deployInstall(skillRoot, target);
		writeFile(join(skillRoot, "install"), "a.txt", "new-canonical-a");
		writeFile(target, "sub/b.txt", "user-edit-b");

		const { status, stdout } = runCli(skillRoot, target);
		assert.equal(status, 1);
		assert.match(stdout, /^ {2}different from bundled version: a\.txt$/m);
		assert.match(stdout, /^ {2}different from bundled version: sub\/b\.txt$/m);
		assert.doesNotMatch(stdout, /^ {2}modified:/m);
		assert.match(stdout, /Run with --deploy to refresh/);
	});

	it("still deploys into an ordinary adopting repo", () => {
		// The guard has to leave the case it was never about untouched.
		const skillRoot = join(tmp, "skill-adopter-still-works");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"canonical\n",
		);
		const target = join(tmp, "target-adopter-still-works");
		mkdirSync(target, { recursive: true });
		writeFile(target, ".git", "gitdir: elsewhere\n");

		const first = runCli(skillRoot, target);
		assert.match(first.stdout, /To adopt it/);

		const deployed = runCli(skillRoot, target, ["--deploy"]);
		assert.equal(deployed.status, 0);
		assert.equal(
			readFileSync(join(target, "scripts/lib/fixture-tool.mjs"), "utf-8"),
			"canonical\n",
		);
	});

	it("surfaces rename candidates on --deploy, not just on a bare check", () => {
		// The #603 report: --deploy printed nothing pointing the old path's
		// local edit at the new path, so the customization was silently lost.
		// The fixture basename is deliberately absent from this repo's own
		// install/ tree, so a stub that failed to override skillRoot would show
		// up as a failure here instead of matching the real tree by accident.
		const skillRoot = join(tmp, "skill-cli");
		const targetRoot = join(tmp, "target-cli");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"canonical-original",
		);
		deployInstall(skillRoot, targetRoot);
		rmSync(join(skillRoot, "install", "scripts", "lib", "fixture-tool.mjs"));
		writeFile(
			join(skillRoot, "install"),
			"scripts/pfdsl/lib/fixture-tool.mjs",
			"canonical-rewritten",
		);

		const checked = runCli(skillRoot, targetRoot);
		assert.match(checked.stdout, /Possible renames/);

		// Deploying resolves the drift, so this has to run second to still see
		// the pre-deploy state the hint is derived from.
		const deployed = runCli(skillRoot, targetRoot, ["--deploy"]);
		assert.match(deployed.stdout, /Possible renames/);
		assert.match(
			deployed.stdout,
			/scripts\/lib\/fixture-tool\.mjs -> scripts\/pfdsl\/lib\/fixture-tool\.mjs/,
		);
	});

	it("prints rename candidates before the removals they warn about", () => {
		// --delete-edited-orphans deletes the old path, so a hint telling the
		// reader to carry its local edit over is only actionable if it appears
		// before the deletion is reported rather than after it (#603).
		const skillRoot = join(tmp, "skill-cli-order");
		const targetRoot = join(tmp, "target-cli-order");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"canonical-original",
		);
		deployInstall(skillRoot, targetRoot);
		writeFile(
			targetRoot,
			"scripts/lib/fixture-tool.mjs",
			"canonical-original\nlocal tweak\n",
		);
		rmSync(join(skillRoot, "install", "scripts", "lib", "fixture-tool.mjs"));
		writeFile(
			join(skillRoot, "install"),
			"scripts/pfdsl/lib/fixture-tool.mjs",
			"canonical-rewritten",
		);

		const { stdout } = runCli(skillRoot, targetRoot, [
			"--deploy",
			"--delete-edited-orphans",
		]);
		const renameAt = stdout.indexOf("Possible renames");
		const removedAt = stdout.indexOf(
			"Removed (no longer part of canonical install/):",
		);
		assert.notEqual(renameAt, -1, `expected a rename hint, got:\n${stdout}`);
		assert.notEqual(
			removedAt,
			-1,
			`expected a removal report, got:\n${stdout}`,
		);
		assert.ok(
			renameAt < removedAt,
			`rename hint must precede the removals, got:\n${stdout}`,
		);
	});

	it("marks a rename target in Copied as carrying canonical content only", () => {
		// Readers take a bare "Copied:" line under a detected rename to mean the
		// old path's edit came along. It did not — the new path holds plain
		// canonical content, which is how #603 lost its customization.
		const skillRoot = join(tmp, "skill-cli-copied");
		const targetRoot = join(tmp, "target-cli-copied");
		writeFile(
			join(skillRoot, "install"),
			"scripts/lib/fixture-tool.mjs",
			"canonical-original",
		);
		writeFile(
			join(skillRoot, "install"),
			"unrelated.txt",
			"canonical-unrelated",
		);
		deployInstall(skillRoot, targetRoot);
		writeFile(
			targetRoot,
			"scripts/lib/fixture-tool.mjs",
			"canonical-original\nlocal tweak\n",
		);
		rmSync(join(skillRoot, "install", "scripts", "lib", "fixture-tool.mjs"));
		rmSync(join(targetRoot, "unrelated.txt"));
		writeFile(
			join(skillRoot, "install"),
			"scripts/pfdsl/lib/fixture-tool.mjs",
			"canonical-rewritten",
		);

		const { stdout } = runCli(skillRoot, targetRoot, ["--deploy"]);
		assert.match(
			stdout,
			/scripts\/pfdsl\/lib\/fixture-tool\.mjs {2}\(canonical content only — the edit at scripts\/lib\/fixture-tool\.mjs is not in it\)/,
		);
		// A copy unrelated to any rename stays unannotated.
		assert.match(stdout, /^ {2}unrelated\.txt$/m);
	});

	it("exits non-zero with a migration message when given the retired --force", () => {
		const skillRoot = join(tmp, "skill-cli-force");
		const targetRoot = join(tmp, "target-cli-force");
		writeFile(join(skillRoot, "install"), "a.txt", "canonical-a");
		mkdirSync(targetRoot, { recursive: true });

		const result = runCli(skillRoot, targetRoot, ["--deploy", "--force"]);
		assert.equal(result.status, 2);
		assert.match(
			result.stderr,
			/--force was split into --overwrite-local-edits and --delete-edited-orphans/,
		);
	});
});

describe("parseArgs", () => {
	it("parses --deploy, both force flags, --upstream, and --target with a value", () => {
		const args = parseArgs([
			"--target",
			"/tmp/foo",
			"--deploy",
			"--overwrite-local-edits",
			"--delete-edited-orphans",
			"--upstream",
		]);
		assert.equal(args.target, "/tmp/foo");
		assert.equal(args.deploy, true);
		assert.equal(args.overwriteLocalEdits, true);
		assert.equal(args.deleteEditedOrphans, true);
		assert.equal(args.upstream, true);
	});

	it("keeps the two force flags independent", () => {
		const overwriteOnly = parseArgs(["--deploy", "--overwrite-local-edits"]);
		assert.equal(overwriteOnly.overwriteLocalEdits, true);
		assert.equal(overwriteOnly.deleteEditedOrphans, false);

		const orphansOnly = parseArgs(["--deploy", "--delete-edited-orphans"]);
		assert.equal(orphansOnly.overwriteLocalEdits, false);
		assert.equal(orphansOnly.deleteEditedOrphans, true);
	});

	it("rejects the retired --force instead of silently ignoring it", () => {
		// Silently dropping it would run an unforced deploy while the caller
		// believes they forced one — the failure mode #603 is about.
		assert.throws(
			() => parseArgs(["--deploy", "--force"]),
			/--force was split into --overwrite-local-edits and --delete-edited-orphans/,
		);
	});

	it("points --force=value at its replacements too, not just the bare form", () => {
		// The inline form is rejected either way, but only the migration
		// message says which two flags to reach for instead.
		assert.throws(
			() => parseArgs(["--deploy", "--force=true"]),
			/--force was split into --overwrite-local-edits and --delete-edited-orphans/,
		);
	});

	// The assertions below match on error code rather than wording: the text is
	// Node's and may be reworded between releases, while the codes are API.
	it("throws when --target is immediately followed by another flag", () => {
		assert.throws(() => parseArgs(["--target", "--deploy"]), {
			code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
		});
	});

	it("throws when --target is the last argument", () => {
		assert.throws(() => parseArgs(["--target"]), {
			code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
		});
	});

	// The three cases below are what #631 is about: each was silently ignored,
	// so a caller asking for an irreversible overwrite or delete got a run that
	// did neither and reported success.
	it("rejects a near-miss flag name instead of silently ignoring it", () => {
		assert.throws(() => parseArgs(["--deploy", "--overwrite-local-edit"]), {
			code: "ERR_PARSE_ARGS_UNKNOWN_OPTION",
		});
	});

	it("rejects an inline --flag=value form for a boolean flag", () => {
		assert.throws(() => parseArgs(["--deploy=true"]), {
			code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
		});
	});

	it("rejects a bare positional argument", () => {
		assert.throws(() => parseArgs(["/tmp/foo"]), {
			code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
		});
	});
});

// The applied-migration state (#1319): the adopter records, in
// .pfdsl/config.json, the plugin release it has finished migrating to. These
// tests drive the comparison against a fake installed plugin so that the
// "running" side is exactly what each case says it is.
describe("applied migration state", () => {
	const scriptPath = fileURLToPath(
		new URL(
			"../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs",
			import.meta.url,
		),
	);
	const pluginVersionCheckPath = join(
		dirname(scriptPath),
		"plugin-version-check.mjs",
	);

	function hexOf(seed) {
		return createHash("sha256").update(seed).digest("hex");
	}

	function bundleManifestText(seed) {
		return `${hexOf(seed)}  a.md\n`;
	}

	function bundleHashOf(seed) {
		return computeManifestAggregateHash(bundleManifestText(seed));
	}

	// The layout the installed plugin has: <root>/skills/pfd-ops/scripts/ beside
	// <root>/.claude-plugin/ (or .codex-plugin/). The script derives the plugin
	// root from its own location, so the manifests have to sit there.
	function makeInstalledPlugin(name, { claude, codex, bundleSeed } = {}) {
		const pluginRoot = join(tmp, name);
		const skillRoot = join(pluginRoot, "skills", "pfd-ops");
		mkdirSync(join(skillRoot, "install"), { recursive: true });
		mkdirSync(join(skillRoot, "scripts"), { recursive: true });
		copyFileSync(
			scriptPath,
			join(skillRoot, "scripts", "check-install-sync.mjs"),
		);
		copyFileSync(
			pluginVersionCheckPath,
			join(skillRoot, "scripts", "plugin-version-check.mjs"),
		);
		if (claude !== undefined) {
			writeFile(
				pluginRoot,
				".claude-plugin/plugin.json",
				JSON.stringify({ version: claude }),
			);
		}
		if (codex !== undefined) {
			writeFile(
				pluginRoot,
				".codex-plugin/plugin.json",
				JSON.stringify({ version: codex }),
			);
		}
		if (bundleSeed !== undefined) {
			writeFile(
				pluginRoot,
				".claude-plugin/bundle-manifest.sha256",
				bundleManifestText(bundleSeed),
			);
		}
		return { pluginRoot, skillRoot };
	}

	// An adopting repo: .pfdsl/ present, the config as the case needs it.
	function makeAdopter(name, config) {
		const target = join(tmp, name);
		mkdirSync(join(target, ".pfdsl"), { recursive: true });
		if (config !== undefined) {
			writeFile(
				target,
				".pfdsl/config.json",
				typeof config === "string"
					? config
					: `${JSON.stringify(config, null, "\t")}\n`,
			);
		}
		return target;
	}

	function run(plugin, target, extraArgs = []) {
		return spawnSync(
			process.execPath,
			[
				join(plugin.skillRoot, "scripts", "check-install-sync.mjs"),
				"--target",
				target,
				...extraArgs,
			],
			{ encoding: "utf-8" },
		);
	}

	describe("evaluateMigration", () => {
		const running = { version: "0.2.0", bundleHash: null };

		it("does nothing when the target has no .pfdsl/ directory", () => {
			const target = join(tmp, "no-pfdsl");
			mkdirSync(target, { recursive: true });

			assert.deepEqual(evaluateMigration(target, running), {
				kind: "no-pfdsl",
			});
		});

		it("reports an adopter that predates the state when appliedMigration is absent, with or without a config file", () => {
			const withoutFile = makeAdopter("absent-no-file");
			const withoutKey = makeAdopter("absent-no-key", {
				sweepCompletedChains: { enabled: true },
			});

			assert.deepEqual(evaluateMigration(withoutFile, running), {
				kind: "absent",
			});
			assert.deepEqual(evaluateMigration(withoutKey, running), {
				kind: "absent",
			});
		});

		it("skips the comparison when the running version is unknown", () => {
			const target = makeAdopter("unknown-running", {
				appliedMigration: { pluginVersion: "0.1.0" },
			});

			assert.deepEqual(evaluateMigration(target, null), {
				kind: "unknown-running",
				recorded: { pluginVersion: "0.1.0", bundleHash: null },
			});
		});

		it("flags a running version older than the recorded one", () => {
			const target = makeAdopter("older", {
				appliedMigration: { pluginVersion: "0.3.0" },
			});

			assert.deepEqual(evaluateMigration(target, running), {
				kind: "older",
				recorded: { pluginVersion: "0.3.0", bundleHash: null },
				running,
			});
		});

		it("flags a running version newer than the recorded one", () => {
			const target = makeAdopter("newer", {
				appliedMigration: { pluginVersion: "0.1.0" },
			});

			assert.equal(evaluateMigration(target, running).kind, "newer");
		});

		it("compares versions numerically per component, not as strings", () => {
			const target = makeAdopter("numeric", {
				appliedMigration: { pluginVersion: "0.9.0" },
			});

			assert.equal(
				evaluateMigration(target, { version: "0.10.0", bundleHash: null }).kind,
				"newer",
			);
			assert.equal(
				evaluateMigration(target, { version: "0.8.12", bundleHash: null }).kind,
				"older",
			);
			assert.equal(
				evaluateMigration(target, { version: "0.9.1", bundleHash: null }).kind,
				"newer",
			);
		});

		it("reports equal versions with different bundle hashes as indeterminate order", () => {
			const target = makeAdopter("same-differs", {
				appliedMigration: {
					pluginVersion: "0.2.0",
					bundleHash: bundleHashOf("recorded"),
				},
			});

			const result = evaluateMigration(target, {
				version: "0.2.0",
				bundleHash: bundleHashOf("running"),
			});
			assert.equal(result.kind, "different-content");
		});

		it("treats equal versions as in sync when the hashes match or either side has none", () => {
			const hash = bundleHashOf("same");
			const both = makeAdopter("in-sync-both", {
				appliedMigration: { pluginVersion: "0.2.0", bundleHash: hash },
			});
			const recordedOnly = makeAdopter("in-sync-recorded-only", {
				appliedMigration: { pluginVersion: "0.2.0", bundleHash: hash },
			});
			const neither = makeAdopter("in-sync-neither", {
				appliedMigration: { pluginVersion: "0.2.0" },
			});

			assert.equal(
				evaluateMigration(both, { version: "0.2.0", bundleHash: hash }).kind,
				"in-sync",
			);
			assert.equal(evaluateMigration(recordedOnly, running).kind, "in-sync");
			assert.equal(
				evaluateMigration(neither, { version: "0.2.0", bundleHash: hash }).kind,
				"in-sync",
			);
		});

		it("says a version that is not x.y.z cannot be compared, on either side", () => {
			const prerelease = makeAdopter("prerelease-recorded", {
				appliedMigration: { pluginVersion: "0.2.0-beta.1" },
			});
			const plain = makeAdopter("plain-recorded", {
				appliedMigration: { pluginVersion: "0.1.0" },
			});

			assert.equal(evaluateMigration(prerelease, running).kind, "uncomparable");
			assert.equal(
				evaluateMigration(plain, { version: "nightly", bundleHash: null }).kind,
				"uncomparable",
			);
		});

		it("fails naming .pfdsl/config.json when the file is not valid JSON", () => {
			const target = makeAdopter("bad-json", "{ not json");

			assert.throws(
				() => evaluateMigration(target, running),
				/\.pfdsl\/config\.json.*JSON/s,
			);
		});

		it("fails naming .pfdsl/config.json when the top level is not an object", () => {
			const target = makeAdopter("bad-top", "[]\n");

			assert.throws(
				() => evaluateMigration(target, running),
				/\.pfdsl\/config\.json.*object/s,
			);
		});

		it("fails naming .pfdsl/config.json for each wrong shape of appliedMigration", () => {
			const shapes = {
				"not-an-object": "0.1.0",
				null: null,
				array: [],
				"no-version": {},
				"numeric-version": { pluginVersion: 1 },
				"empty-version": { pluginVersion: "" },
				"non-string-hash": { pluginVersion: "0.1.0", bundleHash: 5 },
			};
			for (const [name, appliedMigration] of Object.entries(shapes)) {
				const target = makeAdopter(`shape-${name}`, { appliedMigration });
				assert.throws(
					() => evaluateMigration(target, running),
					/\.pfdsl\/config\.json.*appliedMigration/s,
					name,
				);
			}
		});

		it("fails on a malformed config even when the running version is unknown", () => {
			const target = makeAdopter("bad-unknown", "{ not json");

			assert.throws(
				() => evaluateMigration(target, null),
				/\.pfdsl\/config\.json/,
			);
		});
	});

	describe("check output", () => {
		it("prints nothing about migration for a repo without .pfdsl/", () => {
			const plugin = makeInstalledPlugin("plugin-no-pfdsl", {
				claude: "0.2.0",
			});
			const target = join(tmp, "repo-no-pfdsl");
			mkdirSync(target, { recursive: true });

			const { stdout, status } = run(plugin, target);
			assert.equal(status, 0);
			assert.doesNotMatch(stdout, /migration/i);
		});

		it("points an adopter without appliedMigration at the guide and --record-migration, without failing", () => {
			const plugin = makeInstalledPlugin("plugin-absent", { claude: "0.2.0" });
			const target = makeAdopter("adopter-absent", {
				sweepCompletedChains: { enabled: false },
			});

			const { stdout, status } = run(plugin, target);
			assert.equal(status, 0);
			assert.match(stdout, /appliedMigration/);
			assert.match(
				stdout,
				/https:\/\/github\.com\/takasek\/pfdsl\/blob\/main\/docs\/migration-guide\.md/,
			);
			assert.match(stdout, /Choosing the update range/);
			assert.match(stdout, /--record-migration/);
		});

		it("says the comparison was skipped, and why, when the plugin version is unknown", () => {
			const plugin = makeInstalledPlugin("plugin-unknown");
			const target = makeAdopter("adopter-unknown", {
				appliedMigration: { pluginVersion: "0.1.0" },
			});

			const { stdout, status } = run(plugin, target);
			assert.equal(status, 0);
			assert.match(stdout, /skipped/i);
			assert.match(stdout, /plugin\.json/);
		});

		it("tells the reader to update the plugin when it is older than the recorded state", () => {
			const plugin = makeInstalledPlugin("plugin-older", { claude: "0.2.0" });
			const target = makeAdopter("adopter-older", {
				appliedMigration: { pluginVersion: "0.3.0" },
			});

			const { stdout } = run(plugin, target);
			assert.match(stdout, /0\.2\.0/);
			assert.match(stdout, /0\.3\.0/);
			assert.match(stdout, /update the plugin/i);
		});

		it("names both versions and the guide when the plugin is newer than the recorded state", () => {
			const plugin = makeInstalledPlugin("plugin-newer", { claude: "0.2.0" });
			const target = makeAdopter("adopter-newer", {
				appliedMigration: { pluginVersion: "0.1.0" },
			});

			const { stdout, status } = run(plugin, target);
			assert.equal(status, 0);
			assert.match(stdout, /0\.1\.0/);
			assert.match(stdout, /0\.2\.0/);
			assert.match(stdout, /migration-guide\.md/);
			assert.match(stdout, /--record-migration/);
		});

		it("says same version with different content and undeterminable order, without failing", () => {
			const plugin = makeInstalledPlugin("plugin-differs", {
				claude: "0.2.0",
				bundleSeed: "running",
			});
			const target = makeAdopter("adopter-differs", {
				appliedMigration: {
					pluginVersion: "0.2.0",
					bundleHash: bundleHashOf("recorded"),
				},
			});

			const { stdout, status } = run(plugin, target);
			assert.equal(status, 0);
			assert.match(stdout, /same version/i);
			assert.match(stdout, /different content/i);
			assert.match(stdout, /cannot be determined|undeterminable|cannot tell/i);
		});

		it("stays silent about migration when the plugin matches the recorded state", () => {
			const plugin = makeInstalledPlugin("plugin-sync", {
				claude: "0.2.0",
				bundleSeed: "same",
			});
			const target = makeAdopter("adopter-sync", {
				appliedMigration: {
					pluginVersion: "0.2.0",
					bundleHash: bundleHashOf("same"),
				},
			});

			const { stdout, status } = run(plugin, target);
			assert.equal(status, 0);
			assert.doesNotMatch(stdout, /migration/i);
		});

		it("says a version that is not x.y.z cannot be compared, without failing", () => {
			const plugin = makeInstalledPlugin("plugin-uncomparable", {
				claude: "0.2.0",
			});
			const target = makeAdopter("adopter-uncomparable", {
				appliedMigration: { pluginVersion: "0.2.0-beta.1" },
			});

			const { stdout, status } = run(plugin, target);
			assert.equal(status, 0);
			assert.match(stdout, /cannot be compared/i);
		});

		it("reads the version of a Codex plugin, which has no bundle manifest", () => {
			const plugin = makeInstalledPlugin("plugin-codex", { codex: "0.2.0" });
			const target = makeAdopter("adopter-codex", {
				appliedMigration: { pluginVersion: "0.1.0" },
			});

			const { stdout } = run(plugin, target);
			assert.match(stdout, /0\.1\.0/);
			assert.match(stdout, /0\.2\.0/);
			assert.match(stdout, /migration-guide\.md/);
		});

		it("runs the comparison without --upstream, and with the GitHub Issues backend not adopted", () => {
			const plugin = makeInstalledPlugin("plugin-no-upstream", {
				claude: "0.2.0",
			});
			const target = makeAdopter("adopter-no-upstream", {
				appliedMigration: { pluginVersion: "0.1.0" },
			});

			const { stdout } = run(plugin, target);
			assert.match(stdout, /not adopted/);
			assert.match(stdout, /migration-guide\.md/);
		});

		it("fails with exit 3, naming .pfdsl/config.json, when the config is malformed", () => {
			const plugin = makeInstalledPlugin("plugin-bad-config", {
				claude: "0.2.0",
			});
			const target = makeAdopter("adopter-bad-config", "{ not json");

			const { stderr, status } = run(plugin, target);
			assert.equal(status, 3);
			assert.match(stderr, /\.pfdsl\/config\.json/);
		});

		it("does not compare when the target is the upstream repo", () => {
			const plugin = makeInstalledPlugin("plugin-upstream", {
				claude: "0.2.0",
			});
			const target = join(tmp, "upstream-with-pfdsl");
			mkdirSync(join(target, ".pfdsl"), { recursive: true });
			writeFile(target, ".git", "gitdir: elsewhere\n");
			for (const marker of UPSTREAM_MARKERS) {
				writeFile(target, marker.path, `prelude\n${marker.mustContain}\n`);
			}

			const { stdout } = run(plugin, target);
			assert.doesNotMatch(stdout, /appliedMigration/);
		});
	});
});

// checkUpstreamVersion moved to plugin-version-check.mjs/.test.mjs (ADR-0028
// review: decoupled from install/ sync semantics for reuse by other skills).

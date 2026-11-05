// Confirms the per-file manifest format (#1264) actually delivers the
// conflict-free merge it was designed for, using real `git` in a throwaway
// repository rather than asserting about the format in the abstract.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	BUNDLE_MANIFEST_RELATIVE_PATH,
	writeBundleManifest,
} from "./bundle-manifest.mjs";
import {
	commitEverything,
	makeGitRepository,
} from "./git-test-repository.test-helper.mjs";

const DRIFT_CHECKER = fileURLToPath(
	new URL("../check-generated-drift.mjs", import.meta.url),
);

// `git merge` records a merge commit, so it needs an identity just like the
// commits commitEverything makes; supply it per-command for the same reason.
function git(repo, args) {
	return execFileSync(
		"git",
		[
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=test",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{ cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
	);
}

function driftCheckerExitCode(repo, pathspec) {
	return spawnSync(process.execPath, [DRIFT_CHECKER, "--", pathspec], {
		cwd: repo,
		encoding: "utf-8",
	}).status;
}

describe("bundle manifest merges", () => {
	it("merges cleanly and reproduces the generator's output when two branches change adjacent, different files", () => {
		const root = makeGitRepository({ prefix: "bundle-manifest-merge-" });
		const bundleRoot = join(root, "bundle");
		for (const [name, body] of [
			["a.md", "a\n"],
			["b.md", "b\n"],
			["c.md", "c\n"],
			["d.md", "d\n"],
		]) {
			mkdirSync(bundleRoot, { recursive: true });
			writeFileSync(join(bundleRoot, name), body);
		}
		writeBundleManifest(bundleRoot);
		commitEverything(root);
		git(root, ["branch", "-m", "main"]);

		git(root, ["checkout", "-b", "branch-a"]);
		writeFileSync(join(bundleRoot, "b.md"), "b changed on branch-a\n");
		writeBundleManifest(bundleRoot);
		commitEverything(root, "branch-a changes b.md");

		git(root, ["checkout", "-b", "branch-b", "main"]);
		writeFileSync(join(bundleRoot, "c.md"), "c changed on branch-b\n");
		writeBundleManifest(bundleRoot);
		commitEverything(root, "branch-b changes c.md");

		git(root, ["checkout", "branch-a"]);
		// A conflict here would throw; the manifest's blank-line separators are
		// exactly what is supposed to prevent that when the two branches touch
		// different, path-adjacent entries.
		git(root, ["merge", "--no-edit", "branch-b"]);

		const merged = readFileSync(
			join(bundleRoot, BUNDLE_MANIFEST_RELATIVE_PATH),
			"utf-8",
		);
		writeBundleManifest(bundleRoot);
		const regenerated = readFileSync(
			join(bundleRoot, BUNDLE_MANIFEST_RELATIVE_PATH),
			"utf-8",
		);
		assert.equal(
			merged,
			regenerated,
			"the merged manifest should already equal the generator's output",
		);

		assert.equal(
			driftCheckerExitCode(root, "bundle"),
			0,
			"a clean merge must not be reported as drift",
		);
	});

	it("lets the drift checker catch a merge that resolves the source but keeps a stale manifest entry", () => {
		const root = makeGitRepository({ prefix: "bundle-manifest-drift-" });
		const bundleRoot = join(root, "bundle");
		for (const [name, body] of [
			["a.md", "base\n"],
			["b.md", "b\n"],
			["c.md", "c\n"],
			["d.md", "d\n"],
		]) {
			mkdirSync(bundleRoot, { recursive: true });
			writeFileSync(join(bundleRoot, name), body);
		}
		writeBundleManifest(bundleRoot);
		commitEverything(root);
		git(root, ["branch", "-m", "main"]);

		git(root, ["checkout", "-b", "branch-a"]);
		writeFileSync(join(bundleRoot, "a.md"), "a changed on branch-a\n");
		writeBundleManifest(bundleRoot);
		commitEverything(root, "branch-a changes a.md");

		git(root, ["checkout", "-b", "branch-b", "main"]);
		writeFileSync(join(bundleRoot, "a.md"), "a changed on branch-b\n");
		writeBundleManifest(bundleRoot);
		commitEverything(root, "branch-b changes a.md");

		git(root, ["checkout", "branch-a"]);
		assert.throws(
			() => git(root, ["merge", "--no-edit", "branch-b"]),
			/./,
			"the same file changed on both branches must actually conflict",
		);

		// Resolve the source conflict with a third value, but deliberately keep
		// branch-a's manifest entry for a.md instead of recomputing it — the
		// "forgot to regenerate" mistake this checker exists to catch.
		writeFileSync(join(bundleRoot, "a.md"), "a resolved to a third value\n");
		const staleManifest = readFileSync(
			join(bundleRoot, BUNDLE_MANIFEST_RELATIVE_PATH),
			"utf-8",
		)
			// Conflict markers wrap both sides' manifest text; keep branch-a's side.
			.replace(
				/<<<<<<<[^\n]*\n([\s\S]*?)=======\n[\s\S]*?>>>>>>>[^\n]*\n/,
				"$1",
			);
		writeFileSync(
			join(bundleRoot, BUNDLE_MANIFEST_RELATIVE_PATH),
			staleManifest,
		);
		commitEverything(
			root,
			"merge branch-b (defective: manifest not regenerated)",
		);

		// Regenerating in place now diverges from what was just committed,
		// because a.md's committed digest still reflects branch-a's content.
		writeBundleManifest(bundleRoot);

		assert.equal(
			driftCheckerExitCode(root, "bundle"),
			1,
			"a defective merge (stale manifest entry) must be reported as drift",
		);
	});
});

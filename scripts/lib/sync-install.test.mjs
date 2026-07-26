import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planInstallSync, applyInstallSync } from "./sync-install.mjs";

let tmp;
let targetRoot;
let canonicalDir;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "sync-install-"));
	// Mirror the real layout so relative-path computation (used to match
	// against git's repo-root-relative staged paths) is exercised the same
	// way it will be in production: canonicalDir nested under targetRoot.
	targetRoot = join(tmp, "repo");
	canonicalDir = join(targetRoot, ".claude/skills/pfd-ops/install");
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

function canonicalRepoPath(rel) {
	return `.claude/skills/pfd-ops/install/${rel}`;
}

function planFor(stagedPaths) {
	return planInstallSync({ canonicalDir, targetRoot, stagedPaths });
}

describe("planInstallSync", () => {
	it("produces no actions for an in-sync pair", () => {
		writeFile(canonicalDir, "a.txt", "same");
		writeFile(targetRoot, "a.txt", "same");

		const plan = planFor([]);
		assert.deepEqual(plan, []);
	});

	it("resolves to lift when only the deployed path is staged and content differs", () => {
		writeFile(canonicalDir, "a.txt", "canonical-content");
		writeFile(targetRoot, "a.txt", "deployed-content");

		const plan = planFor(["a.txt"]);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "lift");
		assert.equal(plan[0].rel, "a.txt");
	});

	it("resolves to deploy when only the canonical path is staged and content differs", () => {
		writeFile(canonicalDir, "a.txt", "canonical-content");
		writeFile(targetRoot, "a.txt", "deployed-content");

		const plan = planFor([canonicalRepoPath("a.txt")]);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "deploy");
		assert.equal(plan[0].rel, "a.txt");
	});

	it("resolves to ambiguous when both sides are staged and content differs, and leaves files untouched", () => {
		writeFile(canonicalDir, "a.txt", "canonical-content");
		writeFile(targetRoot, "a.txt", "deployed-content");

		const plan = planFor([canonicalRepoPath("a.txt"), "a.txt"]);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "ambiguous");

		applyInstallSync(plan);
		assert.equal(readFileSync(join(canonicalDir, "a.txt"), "utf-8"), "canonical-content");
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "deployed-content");
	});

	it("is not ambiguous when both sides are staged but content is identical (no action)", () => {
		writeFile(canonicalDir, "a.txt", "same-content");
		writeFile(targetRoot, "a.txt", "same-content");

		const plan = planFor([canonicalRepoPath("a.txt"), "a.txt"]);
		assert.deepEqual(plan, []);
	});

	it("resolves to unstagedSkipped when neither side is staged and content differs, and leaves files untouched", () => {
		writeFile(canonicalDir, "a.txt", "canonical-content");
		writeFile(targetRoot, "a.txt", "deployed-content");

		const plan = planFor([]);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "unstagedSkipped");

		applyInstallSync(plan);
		assert.equal(readFileSync(join(canonicalDir, "a.txt"), "utf-8"), "canonical-content");
		assert.equal(readFileSync(join(targetRoot, "a.txt"), "utf-8"), "deployed-content");
	});

	it("manual mode (stagedPaths omitted) resolves every divergence as lift", () => {
		writeFile(canonicalDir, "a.txt", "canonical-a");
		writeFile(targetRoot, "a.txt", "deployed-a");
		writeFile(canonicalDir, "sub/b.txt", "canonical-b");
		writeFile(targetRoot, "sub/b.txt", "deployed-b");

		const plan = planInstallSync({ canonicalDir, targetRoot });
		assert.equal(plan.length, 2);
		assert.ok(plan.every((e) => e.action === "lift"));
	});

	it("resolves to deploy when a canonical file has no deployed counterpart, in manual mode", () => {
		writeFile(canonicalDir, "new.txt", "canonical-only");

		const plan = planInstallSync({ canonicalDir, targetRoot });
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "deploy");
		assert.equal(plan[0].rel, "new.txt");
	});

	it("resolves to deploy when a canonical file has no deployed counterpart and canonical is staged", () => {
		writeFile(canonicalDir, "new.txt", "canonical-only");

		const plan = planFor([canonicalRepoPath("new.txt")]);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "deploy");
	});

	it("resolves to unstagedSkipped when a canonical file has no deployed counterpart and nothing is staged", () => {
		writeFile(canonicalDir, "new.txt", "canonical-only");

		const plan = planFor([]);
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "unstagedSkipped");
	});

	it("detects a mode-bit-only difference as divergence (#421)", () => {
		writeFile(canonicalDir, "a.txt", "same-content");
		writeFile(targetRoot, "a.txt", "same-content");
		chmodSync(join(canonicalDir, "a.txt"), 0o644);
		chmodSync(join(targetRoot, "a.txt"), 0o755);

		const plan = planInstallSync({ canonicalDir, targetRoot });
		assert.equal(plan.length, 1);
		assert.equal(plan[0].action, "lift");
	});

	it("enumerates nested subdirectory files", () => {
		writeFile(canonicalDir, "top.txt", "canonical-top");
		writeFile(targetRoot, "top.txt", "deployed-top");
		writeFile(canonicalDir, "a/b/deep.txt", "canonical-deep");
		writeFile(targetRoot, "a/b/deep.txt", "deployed-deep");

		const plan = planInstallSync({ canonicalDir, targetRoot });
		const rels = plan.map((e) => e.rel).sort();
		assert.deepEqual(rels, ["a/b/deep.txt", "top.txt"]);
	});
});

describe("applyInstallSync", () => {
	it("lifts deployed content and mode onto canonical", () => {
		writeFile(canonicalDir, "a.txt", "canonical-content");
		writeFile(targetRoot, "a.txt", "deployed-content");
		chmodSync(join(canonicalDir, "a.txt"), 0o644);
		chmodSync(join(targetRoot, "a.txt"), 0o755);

		const plan = planInstallSync({ canonicalDir, targetRoot });
		const changed = applyInstallSync(plan);

		assert.equal(readFileSync(join(canonicalDir, "a.txt"), "utf-8"), "deployed-content");
		assert.equal(statSync(join(canonicalDir, "a.txt")).mode & 0o777, 0o755);
		assert.equal(changed.length, 1);
		assert.equal(changed[0].action, "lift");
		assert.equal(changed[0].wrote, canonicalRepoPath("a.txt"));
		assert.equal(changed[0].from, "a.txt");
	});

	it("deploys canonical content and mode onto the deployed path, creating directories as needed", () => {
		writeFile(canonicalDir, "sub/new.txt", "canonical-only");
		chmodSync(join(canonicalDir, "sub/new.txt"), 0o755);

		const plan = planInstallSync({ canonicalDir, targetRoot });
		const changed = applyInstallSync(plan);

		assert.equal(existsSync(join(targetRoot, "sub/new.txt")), true);
		assert.equal(readFileSync(join(targetRoot, "sub/new.txt"), "utf-8"), "canonical-only");
		assert.equal(statSync(join(targetRoot, "sub/new.txt")).mode & 0o777, 0o755);
		assert.equal(changed.length, 1);
		assert.equal(changed[0].action, "deploy");
		assert.equal(changed[0].wrote, "sub/new.txt");
		assert.equal(changed[0].from, canonicalRepoPath("sub/new.txt"));
	});

	it("does not touch files for ambiguous or unstagedSkipped entries", () => {
		writeFile(canonicalDir, "amb.txt", "canonical-amb");
		writeFile(targetRoot, "amb.txt", "deployed-amb");
		writeFile(canonicalDir, "skip.txt", "canonical-skip");
		writeFile(targetRoot, "skip.txt", "deployed-skip");

		const plan = planInstallSync({
			canonicalDir,
			targetRoot,
			stagedPaths: [canonicalRepoPath("amb.txt"), "amb.txt"],
		});
		const changed = applyInstallSync(plan);

		assert.deepEqual(changed, []);
		assert.equal(readFileSync(join(canonicalDir, "amb.txt"), "utf-8"), "canonical-amb");
		assert.equal(readFileSync(join(targetRoot, "amb.txt"), "utf-8"), "deployed-amb");
	});
});

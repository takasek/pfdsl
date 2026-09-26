import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"check-generated-drift.mjs",
);

describe("check-generated-drift", () => {
	it("rejects an unstaged change to a tracked generated file", () => {
		const root = mkdtempSync(join(tmpdir(), "generated-drift-"));
		try {
			execFileSync("git", ["init", "--quiet"], { cwd: root });
			mkdirSync(join(root, "generated"));
			writeFileSync(join(root, "generated", "tracked.txt"), "committed\n");
			execFileSync("git", ["add", "generated/tracked.txt"], { cwd: root });
			execFileSync("git", ["commit", "-m", "fixture", "--quiet"], {
				cwd: root,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: "Test",
					GIT_AUTHOR_EMAIL: "test@example.com",
					GIT_COMMITTER_NAME: "Test",
					GIT_COMMITTER_EMAIL: "test@example.com",
				},
			});
			writeFileSync(join(root, "generated", "tracked.txt"), "regenerated\n");

			const result = spawnSync(process.execPath, [script, "--", "generated"], {
				cwd: root,
				encoding: "utf8",
			});

			assert.equal(result.status, 1);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects an untracked file under a generated path", () => {
		const root = mkdtempSync(join(tmpdir(), "generated-drift-"));
		try {
			execFileSync("git", ["init", "--quiet"], { cwd: root });
			mkdirSync(join(root, "generated"));
			writeFileSync(join(root, "generated", "new.txt"), "new output\n");

			const result = spawnSync(process.execPath, [script, "--", "generated"], {
				cwd: root,
				encoding: "utf8",
			});

			assert.equal(result.status, 1);
			assert.match(result.stderr, /generated\/new\.txt/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("diffs a consumer's paths from the gen-plugin output contract", () => {
		const root = mkdtempSync(join(tmpdir(), "generated-drift-"));
		try {
			execFileSync("git", ["init", "--quiet"], { cwd: root });
			writeFileSync(join(root, "AGENTS.md"), "untracked output\n");

			const result = spawnSync(
				process.execPath,
				[script, "--gen-plugin", "ci"],
				{ cwd: root, encoding: "utf8" },
			);

			assert.equal(result.status, 1);
			assert.match(result.stderr, /AGENTS\.md/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("refuses an unknown gen-plugin consumer instead of diffing nothing", () => {
		const root = mkdtempSync(join(tmpdir(), "generated-drift-"));
		try {
			execFileSync("git", ["init", "--quiet"], { cwd: root });

			const result = spawnSync(
				process.execPath,
				[script, "--gen-plugin", "nightly"],
				{ cwd: root, encoding: "utf8" },
			);

			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /nightly/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { writeBundleManifest } from "./lib/bundle-manifest.mjs";

const script = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"check-generated-drift.mjs",
);
const repoRoot = resolve(dirname(script), "..");

describe("check-generated-drift", () => {
	it("rejects tracked outputs that the real generator stops writing", () => {
		const root = mkdtempSync(join(tmpdir(), "generated-orphans-"));
		const sources = [
			".claude",
			".github",
			"docs",
			"hooks",
			"scripts",
			"generated",
			"plugin",
			".agents",
			".codex",
			".claude-plugin",
			"AGENTS.md",
			"CLAUDE.md",
			"package.json",
			"packages/cli/package.json",
		];
		const oldOutputs = [
			"plugin/pfdsl/.claude-plugin/obsolete.json",
			"plugin/pfdsl-codex/.codex-plugin/obsolete.json",
			"generated/skills/pfdsl/references/obsolete.md",
			".agents/obsolete.md",
			".codex/obsolete.json",
		];
		const manualPath = join(root, ".claude-plugin/manual-note.md");
		try {
			for (const source of sources) {
				const destination = join(root, source);
				mkdirSync(dirname(destination), { recursive: true });
				cpSync(join(repoRoot, source), destination, {
					recursive: true,
					verbatimSymlinks: true,
				});
			}
			symlinkSync(join(repoRoot, "node_modules"), join(root, "node_modules"));
			writeFileSync(manualPath, "maintained by hand\n");
			const skillBefore = readFileSync(
				join(root, "generated/skills/pfdsl/SKILL.md"),
			);
			const marketplaceBefore = readFileSync(
				join(root, ".claude-plugin/marketplace.json"),
			);
			for (const output of oldOutputs) {
				const destination = join(root, output);
				mkdirSync(dirname(destination), { recursive: true });
				writeFileSync(destination, "old generated file\n");
			}
			// The old Claude bundle already recorded the obsolete file, so a
			// regenerated manifest alone cannot make the baseline fail.
			writeBundleManifest(join(root, "plugin/pfdsl"));
			execFileSync("git", ["init", "--quiet"], { cwd: root });
			execFileSync(
				"git",
				[
					"add",
					"--",
					"generated",
					"plugin",
					".agents",
					".codex",
					".claude-plugin/marketplace.json",
					".claude/skills/pfd-ops/install",
					"AGENTS.md",
					"CLAUDE.md",
				],
				{ cwd: root },
			);
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
			const check = () =>
				spawnSync(process.execPath, [script, "--gen-plugin", "ci"], {
					cwd: root,
					encoding: "utf8",
				});
			assert.equal(check().status, 0, "the committed baseline is clean");
			const generation = spawnSync(
				process.execPath,
				[join(root, "scripts/gen-plugin-dist-independent.mjs")],
				{ cwd: root, encoding: "utf8" },
			);
			assert.equal(generation.status, 0, generation.stderr);
			const drift = check();
			assert.equal(drift.status, 1, drift.stderr);
			assert.match(drift.stderr, /Tracked generated files differ/);
			const deleted = execFileSync(
				"git",
				["diff", "--name-only", "--diff-filter=D", "--", ...oldOutputs],
				{ cwd: root, encoding: "utf8" },
			)
				.trim()
				.split("\n");
			assert.deepEqual(deleted.sort(), oldOutputs.sort());
			assert.deepEqual(
				readFileSync(join(root, "generated/skills/pfdsl/SKILL.md")),
				skillBefore,
			);
			assert.deepEqual(
				readFileSync(join(root, ".claude-plugin/marketplace.json")),
				marketplaceBefore,
			);
			assert.equal(readFileSync(manualPath, "utf8"), "maintained by hand\n");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

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

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (root, ...args) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" });

function fixture(run) {
	const temporary = mkdtempSync(join(tmpdir(), "pfdsl-index-gates-"));
	const root = join(temporary, "repo");
	try {
		git(source, "clone", "--quiet", "--shared", source, root);
		cpSync(join(source, "scripts"), join(root, "scripts"), { recursive: true });
		symlinkSync(
			join(source, "node_modules"),
			join(root, "node_modules"),
			"dir",
		);
		git(root, "add", "scripts");
		run(root);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

const check = (root, env = process.env) =>
	spawnSync(process.execPath, ["scripts/check-drift-gates.mjs"], {
		cwd: root,
		env,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
const textAt = (root, path) => readFileSync(join(root, path), "utf8");
const append = (root, path, text) =>
	writeFileSync(join(root, path), textAt(root, path) + text);

for (const consumer of ["push", "release"]) {
	it(`${consumer} cannot hide a stale committed output with a staged source repair`, () =>
		fixture((root) => {
			const agents = textAt(root, "AGENTS.md");
			writeFileSync(
				join(root, "generation-input.txt"),
				"Stale committed input.\n",
			);
			writeFileSync(
				join(root, "scripts/gen-plugin.mjs"),
				'import { readFileSync, writeFileSync } from "node:fs";\nwriteFileSync("AGENTS.md", readFileSync("generation-input.txt"));\n',
			);
			git(root, "add", "generation-input.txt", "scripts");
			git(
				root,
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.test",
				"commit",
				"--quiet",
				"-m",
				"test: committed stale source",
			);
			writeFileSync(join(root, "generation-input.txt"), agents);
			git(root, "add", "generation-input.txt");
			const index = readFileSync(join(root, ".git/index"));
			const result = spawnSync(
				process.execPath,
				["scripts/check-generation.mjs", "--gen-plugin", consumer],
				{ cwd: root, encoding: "utf8" },
			);
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stderr, /Tracked generated files differ/);
			assert.equal(textAt(root, "AGENTS.md"), agents);
			assert.deepEqual(readFileSync(join(root, ".git/index")), index);
			// A consistent pending repair must still be committed before publication.
			writeFileSync(
				join(root, "generation-input.txt"),
				"Consistent pending change.\n",
			);
			writeFileSync(join(root, "AGENTS.md"), "Consistent pending change.\n");
			git(root, "add", "generation-input.txt", "AGENTS.md");
			const pendingIndex = readFileSync(join(root, ".git/index"));
			const pending = spawnSync(
				process.execPath,
				["scripts/check-generation.mjs", "--gen-plugin", consumer],
				{ cwd: root, encoding: "utf8" },
			);
			assert.equal(pending.status, 1, pending.stdout + pending.stderr);
			assert.match(pending.stderr, /Generated outputs differ from HEAD/);
			assert.equal(textAt(root, "AGENTS.md"), "Consistent pending change.\n");
			assert.deepEqual(readFileSync(join(root, ".git/index")), pendingIndex);
		}));
}

for (const consumer of ["terminal", "push", "release"]) {
	for (const path of [
		"AGENTS.md",
		".claude/skills/pfd-ops/install/scripts/pfdsl/sweep-completed-chains.mjs",
	]) {
		it(`${consumer} rejects an unstaged ${path} edit without rewriting files or the index`, () =>
			fixture((root) => {
				append(root, path, "\nUnstaged generated output.\n");
				const before = textAt(root, path);
				const index = readFileSync(join(root, ".git/index"));
				const result = spawnSync(
					process.execPath,
					["scripts/check-generation.mjs", "--gen-plugin", consumer],
					{ cwd: root, encoding: "utf8" },
				);
				assert.equal(result.status, 1, result.stdout + result.stderr);
				assert.match(result.stderr, /Tracked generated files differ/);
				assert.equal(textAt(root, path), before);
				assert.deepEqual(readFileSync(join(root, ".git/index")), index);
			}));
	}
}

it("checks newly added scripts with the repository static gates", () =>
	fixture((root) => {
		for (const script of [
			"check-script-imports.mjs",
			"check-no-shell-strings.mjs",
			"check-cli-conventions.mjs",
		]) {
			const result = spawnSync(process.execPath, [`scripts/${script}`], {
				cwd: root,
				encoding: "utf8",
			});
			assert.equal(result.status, 0, result.stdout + result.stderr);
		}
	}));

it("checks an index-consistent change without reading or rewriting unrelated unstaged inputs and outputs", () =>
	fixture((root) => {
		const input = "scripts/pfdsl/sweep-completed-chains.mjs";
		append(root, input, "\n// Staged change A.\n");
		execFileSync(process.execPath, ["scripts/gen-install.mjs"], { cwd: root });
		execFileSync(
			process.execPath,
			["scripts/gen-plugin-dist-independent.mjs"],
			{ cwd: root },
		);
		git(root, "add", "--all", "--", ".", ":(exclude)node_modules");
		append(
			root,
			"scripts/root-instructions-template/INSTRUCTIONS.md",
			"\nUnstaged source B.\n",
		);
		append(root, "AGENTS.md", "\nUnstaged output B.\n");
		append(
			root,
			"scripts/lib/drift-gates.mjs",
			"\nthrow new Error('Unstaged gate definition B');\n",
		);
		append(
			root,
			"scripts/gen-install.mjs",
			"\nthrow new Error('Unstaged generator code B');\n",
		);
		writeFileSync(join(root, ".codex/untracked.txt"), "Untracked output B.\n");
		const before = git(root, "diff", "--binary");
		const index = git(root, "write-tree");
		const result = check(root);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(git(root, "diff", "--binary"), before);
		assert.equal(git(root, "write-tree"), index);
		assert.equal(textAt(root, ".codex/untracked.txt"), "Untracked output B.\n");
	}));

it("rejects a staged generated mismatch and preserves the worktree", () =>
	fixture((root) => {
		append(
			root,
			".claude/skills/pfd-ops/install/scripts/pfdsl/sweep-completed-chains.mjs",
			"\n// Incorrect staged output.\n",
		);
		git(root, "add", "--all", "--", ".", ":(exclude)node_modules");
		const before = textAt(
			root,
			".claude/skills/pfd-ops/install/scripts/pfdsl/sweep-completed-chains.mjs",
		);
		const result = check(root);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /install is stale/);
		assert.equal(
			textAt(
				root,
				".claude/skills/pfd-ops/install/scripts/pfdsl/sweep-completed-chains.mjs",
			),
			before,
		);
	}));

it("uses an alternate hook index without changing either index", () =>
	fixture((root) => {
		const alternate = join(root, ".git", "alternate-index");
		cpSync(join(root, ".git/index"), alternate);
		const env = { ...process.env, GIT_INDEX_FILE: alternate };
		append(
			root,
			".claude/skills/pfd-ops/install/scripts/pfdsl/sweep-completed-chains.mjs",
			"\n// Alternate-index mismatch.\n",
		);
		execFileSync("git", ["add", ".claude/skills/pfd-ops/install"], {
			cwd: root,
			env,
		});
		const normalBefore = readFileSync(join(root, ".git/index"));
		const alternateBefore = readFileSync(alternate);
		const result = check(root, env);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /install is stale/);
		assert.deepEqual(readFileSync(join(root, ".git/index")), normalBefore);
		assert.deepEqual(readFileSync(alternate), alternateBefore);
	}));

for (const change of ["delete", "add", "mode"]) {
	it(`rejects a staged generated ${change} without changing it`, () =>
		fixture((root) => {
			const path =
				".claude/skills/pfd-ops/install/scripts/pfdsl/sweep-completed-chains.mjs";
			if (change === "delete") rmSync(join(root, path));
			if (change === "add")
				writeFileSync(
					join(root, ".claude/skills/pfd-ops/install/extra.txt"),
					"extra\n",
				);
			if (change === "mode")
				chmodSync(
					join(root, path),
					statSync(join(root, path)).mode & 0o111 ? 0o644 : 0o755,
				);
			git(root, "add", "--all", "--", ".", ":(exclude)node_modules");
			const before = git(root, "diff", "--cached", "--binary");
			const result = check(root);
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.equal(git(root, "diff", "--cached", "--binary"), before);
			assert.equal(git(root, "diff", "--binary"), "");
		}));
}

it("requires outputs for a partially staged source and ignores its later worktree edit", () =>
	fixture((root) => {
		const input = "scripts/pfdsl/sweep-completed-chains.mjs";
		append(root, input, "\n// Staged source-only change.\n");
		git(root, "add", input);
		append(root, input, "\n// Unstaged next change.\n");
		const before = git(root, "diff", "--binary");
		const result = check(root);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /install is stale/);
		assert.equal(git(root, "diff", "--binary"), before);
	}));

it("a single allowlist edit adds and removes install payloads in all four harness outputs", () =>
	fixture((root) => {
		const allowlist = "scripts/lib/install-templates.mjs";
		const original = textAt(root, allowlist);
		writeFileSync(
			join(root, "scripts/pfdsl/distributed.txt"),
			"Distributed payload.\n",
		);
		writeFileSync(
			join(root, "scripts/pfdsl/development.test.mjs"),
			"Development-only file.\n",
		);
		writeFileSync(
			join(root, allowlist),
			original.replace(
				"INSTALL_TEMPLATE_PATHS = [",
				'INSTALL_TEMPLATE_PATHS = [\n\t"scripts/pfdsl/distributed.txt",',
			),
		);
		const roots = [
			".claude/skills/pfd-ops",
			".agents/skills/pfd-ops",
			"plugin/pfdsl/skills/pfd-ops",
			"plugin/pfdsl-codex/skills/pfd-ops",
		];
		execFileSync(
			process.execPath,
			["scripts/gen-plugin-dist-independent.mjs"],
			{ cwd: root },
		);
		for (const output of roots) {
			assert.equal(
				textAt(root, `${output}/install/scripts/pfdsl/distributed.txt`),
				"Distributed payload.\n",
			);
			assert.throws(
				() =>
					textAt(root, `${output}/install/scripts/pfdsl/development.test.mjs`),
				{ code: "ENOENT" },
			);
		}
		git(root, "add", "--all", "--", ".", ":(exclude)node_modules");
		writeFileSync(join(root, allowlist), original);
		execFileSync(
			process.execPath,
			["scripts/gen-plugin-dist-independent.mjs"],
			{ cwd: root },
		);
		for (const output of roots)
			assert.throws(
				() => textAt(root, `${output}/install/scripts/pfdsl/distributed.txt`),
				{ code: "ENOENT" },
			);
	}));

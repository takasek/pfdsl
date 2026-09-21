import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { makeGitRepository } from "./lib/git-test-repository.test-helper.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const bad = "This sentence is split\nin the middle.\n";
const good = "This sentence is split in the middle.\n";

describe("Markdown checks against the Git index", () => {
	let root;
	const git = (args, env = process.env) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8", env });
	const run = (file, args, env = process.env) =>
		spawnSync(file, args, { cwd: root, encoding: "utf8", env });
	const cli = (...args) =>
		run(process.execPath, [join(source, "check-md-linebreaks.mjs"), ...args]);
	const stage = (file, text) => {
		writeFileSync(join(root, file), text);
		git(["add", "--", file]);
	};

	before(() => {
		root = makeGitRepository({ prefix: "md-staged-" });
		cpSync(source, join(root, "scripts"), { recursive: true });
		for (const file of ["biome.json", "package.json"]) {
			cpSync(join(source, "..", file), join(root, file));
		}
		symlinkSync(join(source, "..", "node_modules"), join(root, "node_modules"));
	});
	after(() => rmSync(root, { recursive: true, force: true }));

	for (const [name, index, working, expected] of [
		["rejects a staged violation even after an unstaged repair", bad, good, 1],
		["accepts a clean index despite an unstaged violation", good, bad, 0],
		["rejects a violation in both versions", bad, bad, 1],
		["accepts clean staged and working versions", good, good, 0],
	]) {
		it(`pre-commit ${name}`, () => {
			stage("probe.md", index);
			writeFileSync(join(root, "probe.md"), working);
			const result = run("/bin/sh", ["scripts/pre-commit"]);
			assert.equal(result.status, expected, result.stdout + result.stderr);
			assert.equal(git(["show", ":probe.md"]), index);
		});
	}

	it("the staged CLI reports index diagnostics while the normal CLI reads disk", () => {
		stage("probe.md", bad);
		writeFileSync(join(root, "probe.md"), good);
		const staged = cli("--staged");
		assert.equal(staged.status, 1, staged.stdout + staged.stderr);
		assert.match(staged.stdout, /probe\.md:2: mid-sentence line break/);
		assert.equal(cli("probe.md").status, 0);
		stage("probe.md", good);
	});

	it("reads a staged file even when it was removed from the working tree", () => {
		stage("probe.md", good);
		rmSync(join(root, "probe.md"));
		const result = cli("--staged");
		assert.equal(result.status, 0, result.stdout + result.stderr);
	});

	it("handles renamed paths containing spaces, Unicode, and newlines", () => {
		stage("probe.md", good);
		git([
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"fixture",
		]);
		const file = "renamed 文書\nwith space.md";
		git(["mv", "--", "probe.md", file]);
		stage(file, bad);
		writeFileSync(join(root, file), good);
		const result = cli("--staged");
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.ok(result.stdout.includes(`${file}:2: mid-sentence line break`));
		git(["rm", "--cached", "-f", "--", file]);
	});

	it("does not expand deletion-only or empty staged changes to other Markdown", () => {
		writeFileSync(join(root, "untracked.md"), bad);
		assert.equal(cli("--staged").status, 0);
		git([
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"fixture deletion",
		]);
		assert.equal(cli("--staged").status, 0);
	});

	it("honors an alternate index supplied by Git during a commit", () => {
		const env = {
			...process.env,
			GIT_INDEX_FILE: join(root, ".git", "alternate-index"),
		};
		writeFileSync(join(root, "alternate.md"), bad);
		git(["add", "--", "alternate.md"], env);
		writeFileSync(join(root, "alternate.md"), good);
		const result = run(
			process.execPath,
			[join(source, "check-md-linebreaks.mjs"), "--staged"],
			env,
		);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /alternate\.md:2: mid-sentence line break/);
	});

	it("prints the rejected lines while commit -a's temporary index exists", () => {
		stage("auto.md", good);
		git([
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"fixture auto",
		]);
		const hook = join(root, ".git", "hooks", "pre-commit");
		writeFileSync(hook, "#!/bin/sh\nexec /bin/sh scripts/pre-commit\n");
		chmodSync(hook, 0o755);
		try {
			writeFileSync(join(root, "auto.md"), bad);
			const result = run("git", [
				"-c",
				"core.hooksPath=.git/hooks",
				"-c",
				"user.name=test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-am",
				"fixture violation",
			]);
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(
				result.stdout + result.stderr,
				/auto\.md:2: mid-sentence line break/,
			);
			assert.equal(git(["show", ":auto.md"]), good);
		} finally {
			rmSync(hook);
		}
	});

	it("does not interpret a filename prefix as an index stage selector", () => {
		stage("foo.md", good);
		stage("0:foo.md", bad);
		writeFileSync(join(root, "0:foo.md"), good);
		const result = cli("--staged");
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /0:foo\.md:2: mid-sentence line break/);
	});
});

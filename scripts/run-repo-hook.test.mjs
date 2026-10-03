import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "repo-hook-runner-"));
mkdirSync(join(root, "scripts"));
mkdirSync(join(root, ".git"));
const runner = join(root, "scripts/run-repo-hook.mjs");
copyFileSync(new URL("./run-repo-hook.mjs", import.meta.url), runner);
after(() => rmSync(root, { recursive: true, force: true }));

const run = (args, input = "") =>
	spawnSync(process.execPath, [runner, ...args], {
		cwd: tmpdir(),
		input,
		encoding: "utf8",
	});

test("forwards stdin/stdout and preserves the hook process cwd", () => {
	writeFileSync(
		join(root, "scripts/echo.mjs"),
		"process.stdin.pipe(process.stdout); process.stderr.write(process.cwd());",
	);
	const result = run(["scripts/echo.mjs"], '{"tool_name":"Bash"}');
	assert.equal(result.status, 0);
	assert.equal(result.stdout, '{"tool_name":"Bash"}');
	assert.equal(result.stderr, realpathSync(tmpdir()));
});

test("fails closed for missing hook code, child failure and invalid target", () => {
	writeFileSync(join(root, "scripts/fail.mjs"), "process.exit(7);");
	for (const target of [
		"scripts/missing.mjs",
		"scripts/fail.mjs",
		"../foreign.mjs",
	]) {
		const result = run([target]);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /repository hook/);
	}
});

test("requires a repository marker in the runner's code host", () => {
	rmSync(join(root, ".git"), { recursive: true });
	const result = run(["scripts/echo.mjs"]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /root is unavailable/);
	mkdirSync(join(root, ".git"));
});

test("rejects relative Claude roots before running a hook", () => {
	writeFileSync(
		join(root, "scripts/delegation-guard.mjs"),
		'process.stdout.write("ran");',
	);
	for (const CLAUDE_PROJECT_DIR of ["", ".", "relative/path"]) {
		const settings = JSON.parse(
			readFileSync(
				new URL("../.claude/settings.json", import.meta.url),
				"utf8",
			),
		);
		const command = settings.hooks.PreToolUse[0].hooks[0].command;
		const result = spawnSync("/bin/sh", ["-c", command], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, CLAUDE_PROJECT_DIR },
		});
		assert.equal(result.status, 2);
		assert.equal(result.stdout, "");
	}
});

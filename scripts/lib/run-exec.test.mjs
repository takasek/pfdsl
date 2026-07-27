import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { run, tryRun, git, tryGit } from "./run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("run-exec", () => {
	it("passes an argument containing shell metacharacters through verbatim", () => {
		const marker = resolve(tmpdir(), `run-exec-injection-${process.pid}`);
		rmSync(marker, { force: true });

		const result = tryGit(["rev-parse", `HEAD; touch ${marker}`], { cwd: root });

		assert.equal(existsSync(marker), false, "the argument reached a shell");
		assert.equal(result.ok, false, "an unusable ref must fail");
	});

	it("does not split an argument on whitespace", () => {
		const result = tryRun("echo", ["one two"], { cwd: root });

		assert.equal(result.ok, true);
		assert.equal(result.out.trim(), "one two");
	});

	it("reports the exit status of a failed command instead of throwing", () => {
		const result = tryRun("git", ["rev-parse", "definitely-not-a-ref"], { cwd: root });

		assert.equal(result.ok, false);
		assert.notEqual(result.status, 0);
		assert.ok(result.out.length > 0, "the reason must survive for the caller to print");
	});

	it("returns stdout on success", () => {
		assert.match(git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).trim(), /\S/);
	});

	it("forwards stdin to the command", () => {
		assert.match(run("cat", [], { cwd: root, input: "piped" }), /piped/);
	});

	it("throws on a non-zero exit so callers that need a hard failure get one", () => {
		assert.throws(() => git(["rev-parse", "definitely-not-a-ref"], { cwd: root }));
	});
});

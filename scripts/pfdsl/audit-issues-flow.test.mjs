// Integration coverage for audit-issues-flow.mjs's gh-unavailable exit.
// The GitHub-dependent checks are skipped (exit code 2) when the gh binary is
// missing and no token is set; the message is what an adopting repo reads to
// recover, so it must name both supported routes: an authenticated gh, or a
// GH_TOKEN/GITHUB_TOKEN for gh-less environments such as Claude Code Remote.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GH_UNAVAILABLE_EXIT_CODE } from "./lib/gh-compat.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "audit-issues-flow.mjs");

let emptyBin;

beforeEach(() => {
	emptyBin = mkdtempSync(join(tmpdir(), "audit-issues-flow-test-"));
});

afterEach(() => {
	rmSync(emptyBin, { recursive: true, force: true });
});

describe("audit-issues-flow without gh", () => {
	it("skips with exit code 2 and names both gh and the token as ways to recover", () => {
		const env = { ...process.env, PATH: emptyBin };
		delete env.GH_TOKEN;
		delete env.GITHUB_TOKEN;
		const result = spawnSync(process.execPath, [scriptPath], {
			encoding: "utf-8",
			env,
		});
		assert.equal(result.status, GH_UNAVAILABLE_EXIT_CODE, result.stderr);
		assert.match(result.stdout, /skipping GitHub-dependent checks/);
		assert.match(result.stdout, /install and authenticate the gh CLI/);
		assert.match(result.stdout, /set GH_TOKEN or GITHUB_TOKEN/);
	});

	// With a token set, the HTTP route resolves owner/repo from the git remote.
	// If git itself is missing, that is not "gh unavailable": telling the reader
	// to set the token they already set would not help them recover.
	it("reports a git remote failure instead of skipping when a token is set", () => {
		const env = { ...process.env, PATH: emptyBin, GH_TOKEN: "dummy" };
		delete env.GITHUB_TOKEN;
		const result = spawnSync(process.execPath, [scriptPath], {
			encoding: "utf-8",
			env,
		});
		assert.notEqual(result.status, GH_UNAVAILABLE_EXIT_CODE, result.stdout);
		assert.notEqual(result.status, 0);
		assert.doesNotMatch(result.stdout, /gh unavailable/);
		assert.match(result.stderr, /could not read the git remote/);
	});
});

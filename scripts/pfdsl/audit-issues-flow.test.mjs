// Integration coverage for audit-issues-flow.mjs's gh-unavailable exit.
// The GitHub-dependent checks are skipped (exit code 2) when the gh binary is
// missing and no token is set; the message is what an adopting repo reads to
// recover, so it must name the supported environment (an authenticated gh).

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
	it("skips with exit code 2 and tells the reader to install and authenticate gh", () => {
		const env = { ...process.env, PATH: emptyBin };
		delete env.GH_TOKEN;
		delete env.GITHUB_TOKEN;
		const result = spawnSync(process.execPath, [scriptPath], {
			encoding: "utf-8",
			env,
		});
		assert.equal(result.status, GH_UNAVAILABLE_EXIT_CODE, result.stderr);
		assert.match(result.stdout, /skipping GitHub-dependent checks/);
		assert.match(result.stdout, /install the gh CLI and authenticate it/);
	});
});

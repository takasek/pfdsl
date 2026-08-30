import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { execGh } from "./gh-exec.mjs";

// A real `gh` binary may live anywhere on PATH depending on the environment
// (absent on this maintainer's Mac, but preinstalled at /usr/bin/gh on
// GitHub Actions' ubuntu runners — see #541) — hardcoding a directory that's
// merely "usually gh-less" isn't portable. Build a PATH containing only a
// symlink to the real `git` (hostFromGitRemote needs it) and nothing else,
// so `gh` reliably resolves to ENOENT regardless of what the host has
// installed.
function ghlessPathWithGit() {
	const dir = mkdtempSync(join(tmpdir(), "gh-exec-test-path-"));
	const gitPath = execFileSync("which", ["git"], { encoding: "utf-8" }).trim();
	symlinkSync(gitPath, join(dir, "git"));
	return dir;
}

/**
 * A PATH containing a real `git` symlink and a fake `gh` shell script (in
 * place of the real binary, so these tests exercise execGh's own contract —
 * stdout passthrough, non-ENOENT error propagation, GH_HOST pinning — without
 * calling the real GitHub CLI at all).
 * @param {string} script - shell script body (after `#!/bin/sh`)
 */
function fakePathWithGh(script) {
	const dir = ghlessPathWithGit();
	const ghPath = join(dir, "gh");
	writeFileSync(ghPath, `#!/bin/sh\n${script}\n`);
	chmodSync(ghPath, 0o755);
	return dir;
}

describe("execGh", () => {
	let originalPath;
	let fakePath;

	afterEach(() => {
		process.env.PATH = originalPath;
		if (fakePath) rmSync(fakePath, { recursive: true, force: true });
		fakePath = undefined;
	});

	it("rethrows the ENOENT execFileSync throws when gh isn't on PATH", async () => {
		originalPath = process.env.PATH;
		fakePath = ghlessPathWithGit();
		process.env.PATH = fakePath;
		await assert.rejects(
			() => execGh(["label", "list"]),
			(e) => e.code === "ENOENT",
		);
	});

	it("returns gh's stdout unchanged on success", async () => {
		originalPath = process.env.PATH;
		fakePath = fakePathWithGh('printf %s "$*"');
		process.env.PATH = fakePath;
		const out = await execGh(["label", "list", "--json", "name"], {
			cwd: process.cwd(),
		});
		assert.equal(out, "label list --json name");
	});

	it("propagates a non-ENOENT gh failure (auth error, bad args, ...) unchanged", async () => {
		originalPath = process.env.PATH;
		fakePath = fakePathWithGh('echo "gh: not authenticated" >&2; exit 1');
		process.env.PATH = fakePath;
		await assert.rejects(
			() => execGh(["label", "list"]),
			(e) => e.status === 1 && /not authenticated/.test(String(e.stderr)),
		);
	});

	it("pins GH_HOST to this repo's own remote host, overriding an ambient value", async () => {
		originalPath = process.env.PATH;
		fakePath = fakePathWithGh('printf %s "$GH_HOST"');
		process.env.PATH = fakePath;
		const originalGhHost = process.env.GH_HOST;
		process.env.GH_HOST = "some-other-host.example";
		try {
			const out = await execGh(["label", "list"], { cwd: process.cwd() });
			assert.equal(out, "github.com");
		} finally {
			if (originalGhHost === undefined) delete process.env.GH_HOST;
			else process.env.GH_HOST = originalGhHost;
		}
	});
});

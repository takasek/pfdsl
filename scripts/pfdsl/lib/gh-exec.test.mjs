import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execGh } from "./gh-exec.mjs";

// A real `gh` binary may live anywhere on PATH depending on the environment
// (absent on this maintainer's Mac, but preinstalled at /usr/bin/gh on
// GitHub Actions' ubuntu runners — see #541) — hardcoding a directory that's
// merely "usually gh-less" isn't portable. Build a PATH containing only a
// symlink to the real `git` (ownerRepoFromGitRemote needs it) and nothing
// else, so `gh` reliably resolves to ENOENT regardless of what the host has
// installed.
function ghlessPathWithGit() {
	const dir = mkdtempSync(join(tmpdir(), "gh-exec-test-path-"));
	const gitPath = execFileSync("which", ["git"], { encoding: "utf-8" }).trim();
	symlinkSync(gitPath, join(dir, "git"));
	return dir;
}

describe("execGh", () => {
	let originalPath;
	let originalGhToken;
	let originalGithubToken;
	let originalFetch;
	let originalHttpsProxy;
	let originalHttpsProxyLower;
	let ghlessPath;

	beforeEach(() => {
		originalPath = process.env.PATH;
		originalGhToken = process.env.GH_TOKEN;
		originalGithubToken = process.env.GITHUB_TOKEN;
		originalFetch = globalThis.fetch;
		originalHttpsProxy = process.env.HTTPS_PROXY;
		originalHttpsProxyLower = process.env.https_proxy;
		ghlessPath = ghlessPathWithGit();
		process.env.PATH = ghlessPath;
		// proxyAwareFetch (github-rest.mjs's default fetchImpl) delegates to a
		// child process when a proxy is configured, which would bypass the
		// globalThis.fetch stub below — force the direct-fetch path for this
		// in-process test.
		delete process.env.HTTPS_PROXY;
		delete process.env.https_proxy;
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		rmSync(ghlessPath, { recursive: true, force: true });
		if (originalGhToken === undefined) delete process.env.GH_TOKEN;
		else process.env.GH_TOKEN = originalGhToken;
		if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
		else process.env.GITHUB_TOKEN = originalGithubToken;
		if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
		else process.env.HTTPS_PROXY = originalHttpsProxy;
		if (originalHttpsProxyLower === undefined) delete process.env.https_proxy;
		else process.env.https_proxy = originalHttpsProxyLower;
		globalThis.fetch = originalFetch;
	});

	it("rethrows the original ENOENT when there's no token to fall back with", async () => {
		delete process.env.GH_TOKEN;
		delete process.env.GITHUB_TOKEN;
		await assert.rejects(
			() => execGh(["label", "list", "--json", "name,description", "--limit", "100"]),
			(e) => e.code === "ENOENT",
		);
	});

	it("rethrows the original ENOENT for an argv shape with no REST plan", async () => {
		process.env.GH_TOKEN = "tok";
		await assert.rejects(() => execGh(["repo", "view"]), (e) => e.code === "ENOENT");
	});

	it("falls back to REST and returns gh-shaped JSON when a token is present", async () => {
		process.env.GH_TOKEN = "tok";
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => [{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" }],
		});
		const out = await execGh(["label", "list", "--json", "name,description", "--limit", "100"]);
		assert.deepEqual(JSON.parse(out), [{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" }]);
	});
});

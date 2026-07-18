import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { execGh } from "./gh-exec.mjs";

// Scoped to just /usr/bin so `git` still resolves (ownerRepoFromGitRemote
// needs it) while `gh` — never installed there in this sandbox — stays
// absent, exercising the ENOENT fallback path for real.
const NO_GH_PATH = "/usr/bin";

describe("execGh", () => {
	let originalPath;
	let originalGhToken;
	let originalGithubToken;
	let originalFetch;
	let originalHttpsProxy;
	let originalHttpsProxyLower;

	beforeEach(() => {
		originalPath = process.env.PATH;
		originalGhToken = process.env.GH_TOKEN;
		originalGithubToken = process.env.GITHUB_TOKEN;
		originalFetch = globalThis.fetch;
		originalHttpsProxy = process.env.HTTPS_PROXY;
		originalHttpsProxyLower = process.env.https_proxy;
		process.env.PATH = NO_GH_PATH;
		// proxyAwareFetch (github-rest.mjs's default fetchImpl) delegates to a
		// child process when a proxy is configured, which would bypass the
		// globalThis.fetch stub below — force the direct-fetch path for this
		// in-process test.
		delete process.env.HTTPS_PROXY;
		delete process.env.https_proxy;
	});

	afterEach(() => {
		process.env.PATH = originalPath;
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

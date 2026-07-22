import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { proxyAwareFetch } from "./proxy-fetch.mjs";

describe("proxyAwareFetch", () => {
	let originalFetch;
	let originalHttpsProxy;
	let originalHttpsProxyLower;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		originalHttpsProxy = process.env.HTTPS_PROXY;
		originalHttpsProxyLower = process.env.https_proxy;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
		else process.env.HTTPS_PROXY = originalHttpsProxy;
		if (originalHttpsProxyLower === undefined) delete process.env.https_proxy;
		else process.env.https_proxy = originalHttpsProxyLower;
	});

	it("falls straight through to global fetch when no proxy is configured", async () => {
		delete process.env.HTTPS_PROXY;
		delete process.env.https_proxy;
		let calledWith;
		globalThis.fetch = async (url, init) => {
			calledWith = { url, init };
			return { ok: true, status: 200 };
		};
		const res = await proxyAwareFetch("https://api.github.com/x", { method: "GET" });
		assert.equal(res.status, 200);
		assert.equal(calledWith.url, "https://api.github.com/x");
	});

	it("delegates to a child process (not the global fetch stub) when a proxy is configured", async () => {
		process.env.HTTPS_PROXY = "http://127.0.0.1:1";
		let stubCalled = false;
		globalThis.fetch = async () => {
			stubCalled = true;
			return { ok: true, status: 200 };
		};
		// Whether the request itself succeeds, fails, or gets policy-blocked
		// depends on this environment's network sandboxing — what matters here
		// is that the *in-process* fetch stub was never reached, proving the
		// call was delegated to a subprocess rather than served in-process.
		try {
			await proxyAwareFetch("https://api.github.com/x");
		} catch {
			// network outcome is irrelevant to this assertion
		}
		assert.equal(stubCalled, false);
	});
});

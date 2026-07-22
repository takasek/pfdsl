import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	parseOwnerRepo,
	mapLabelsResponse,
	mapIssuesResponse,
	mapCheckRunsToRollup,
	fetchAllLabels,
	fetchAllIssues,
	getIssueBody,
	fetchOpenPrsWithCi,
} from "./github-rest.mjs";

describe("parseOwnerRepo", () => {
	it("https URL with .git suffix", () => {
		assert.deepEqual(parseOwnerRepo("https://github.com/takasek/pfdsl.git"), { owner: "takasek", repo: "pfdsl" });
	});

	it("https URL without .git suffix", () => {
		assert.deepEqual(parseOwnerRepo("https://github.com/takasek/pfdsl"), { owner: "takasek", repo: "pfdsl" });
	});

	it("scp-like git@ URL", () => {
		assert.deepEqual(parseOwnerRepo("git@github.com:takasek/pfdsl.git"), { owner: "takasek", repo: "pfdsl" });
	});

	it("reverse-proxied remote (Claude Code Remote's local git proxy)", () => {
		assert.deepEqual(parseOwnerRepo("http://local_proxy@127.0.0.1:41729/git/takasek/pfdsl"), {
			owner: "takasek",
			repo: "pfdsl",
		});
	});

	it("returns null when fewer than two path segments", () => {
		assert.equal(parseOwnerRepo("https://github.com/takasek"), null);
	});
});

describe("mapLabelsResponse", () => {
	it("maps name/description, defaulting null description to empty string", () => {
		const result = mapLabelsResponse([
			{ name: "flow:managed", description: "tracked" },
			{ name: "bug", description: null },
		]);
		assert.deepEqual(result, [
			{ name: "flow:managed", description: "tracked" },
			{ name: "bug", description: "" },
		]);
	});
});

describe("mapIssuesResponse", () => {
	it("filters out pull requests", () => {
		const result = mapIssuesResponse([
			{ number: 1, state: "open", labels: [], updated_at: "2026-01-01T00:00:00Z" },
			{ number: 2, state: "open", pull_request: {}, labels: [], updated_at: "2026-01-01T00:00:00Z" },
		]);
		assert.deepEqual(result.map((i) => i.number), [1]);
	});

	it("uppercases state and stateReason to match gh CLI's --json output", () => {
		const result = mapIssuesResponse([
			{ number: 5, state: "closed", state_reason: "not_planned", labels: [], updated_at: "2026-01-01T00:00:00Z" },
		]);
		assert.equal(result[0].state, "CLOSED");
		assert.equal(result[0].stateReason, "NOT_PLANNED");
	});

	it("null stateReason stays null", () => {
		const result = mapIssuesResponse([
			{ number: 6, state: "open", state_reason: null, labels: [], updated_at: "2026-01-01T00:00:00Z" },
		]);
		assert.equal(result[0].stateReason, null);
	});

	it("maps labels to {name} objects", () => {
		const result = mapIssuesResponse([
			{ number: 7, state: "open", labels: [{ name: "flow:managed" }], updated_at: "2026-01-01T00:00:00Z" },
		]);
		assert.deepEqual(result[0].labels, [{ name: "flow:managed" }]);
	});
});

describe("mapCheckRunsToRollup", () => {
	it("uppercases conclusion for completed runs", () => {
		const result = mapCheckRunsToRollup([{ status: "completed", conclusion: "success" }]);
		assert.deepEqual(result, [{ conclusion: "SUCCESS" }]);
	});

	it("null conclusion for runs still in progress", () => {
		const result = mapCheckRunsToRollup([{ status: "in_progress", conclusion: null }]);
		assert.deepEqual(result, [{ conclusion: null }]);
	});
});

// ---------------------------------------------------------------------------
// Async REST calls, exercised against an injected fake fetch (no network).
// ---------------------------------------------------------------------------

function jsonResponse(body, ok = true, status = 200) {
	return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("fetchAllLabels", () => {
	it("requests the labels endpoint and maps the response", async () => {
		const calls = [];
		const fetchImpl = async (url, init) => {
			calls.push({ url, init });
			return jsonResponse([{ name: "bug", description: "Something isn't working" }]);
		};
		const result = await fetchAllLabels("takasek", "pfdsl", "tok", fetchImpl);
		assert.deepEqual(result, [{ name: "bug", description: "Something isn't working" }]);
		assert.equal(calls.length, 1);
		assert.match(calls[0].url, /\/repos\/takasek\/pfdsl\/labels/);
		assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
	});

	it("throws with status and body text on a non-ok response", async () => {
		const fetchImpl = async () => jsonResponse({ message: "Bad credentials" }, false, 401);
		await assert.rejects(() => fetchAllLabels("takasek", "pfdsl", "bad-tok", fetchImpl), /401/);
	});
});

describe("fetchAllIssues", () => {
	it("paginates until a short page is returned", async () => {
		let page = 0;
		const fetchImpl = async () => {
			page++;
			if (page === 1) {
				return jsonResponse(
					Array.from({ length: 100 }, (_, i) => ({
						number: i + 1,
						state: "open",
						labels: [],
						updated_at: "2026-01-01T00:00:00Z",
					})),
				);
			}
			return jsonResponse([{ number: 101, state: "open", labels: [], updated_at: "2026-01-01T00:00:00Z" }]);
		};
		const result = await fetchAllIssues("takasek", "pfdsl", "tok", fetchImpl);
		assert.equal(result.length, 101);
		assert.equal(page, 2);
	});

	it("stops at the given limit even if more pages would be available", async () => {
		const fetchImpl = async () =>
			jsonResponse(
				Array.from({ length: 100 }, (_, i) => ({
					number: i + 1,
					state: "open",
					labels: [],
					updated_at: "2026-01-01T00:00:00Z",
				})),
			);
		const result = await fetchAllIssues("takasek", "pfdsl", "tok", fetchImpl, 50);
		assert.equal(result.length, 50);
	});
});

describe("getIssueBody", () => {
	it("returns the raw body text", async () => {
		const fetchImpl = async () => jsonResponse({ body: "design TBD" });
		assert.equal(await getIssueBody("takasek", "pfdsl", "tok", 42, fetchImpl), "design TBD");
	});

	it("returns empty string for a null body", async () => {
		const fetchImpl = async () => jsonResponse({ body: null });
		assert.equal(await getIssueBody("takasek", "pfdsl", "tok", 42, fetchImpl), "");
	});
});

describe("fetchOpenPrsWithCi", () => {
	it("attaches a statusCheckRollup per PR from its head sha's check-runs", async () => {
		const fetchImpl = async (url) => {
			if (url.includes("/pulls?")) {
				return jsonResponse([{ number: 10, title: "flow sync", head: { ref: "flow-sync/pending", sha: "abc123" } }]);
			}
			if (url.includes("/check-runs")) {
				return jsonResponse({ check_runs: [{ status: "completed", conclusion: "success" }] });
			}
			throw new Error(`unexpected url: ${url}`);
		};
		const result = await fetchOpenPrsWithCi("takasek", "pfdsl", "tok", fetchImpl);
		assert.deepEqual(result, [
			{ number: 10, title: "flow sync", headRefName: "flow-sync/pending", statusCheckRollup: [{ conclusion: "SUCCESS" }] },
		]);
	});
});

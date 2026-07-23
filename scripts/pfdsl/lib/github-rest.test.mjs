import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	parseOwnerRepo,
	parseHost,
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

describe("parseHost", () => {
	it("https URL", () => {
		assert.equal(parseHost("https://github.com/takasek/pfdsl.git"), "github.com");
	});

	it("https URL to a GitHub Enterprise host", () => {
		assert.equal(parseHost("https://ghe.corp.example/takasek/pfdsl"), "ghe.corp.example");
	});

	it("scp-like git@ URL", () => {
		assert.equal(parseHost("git@github.com:takasek/pfdsl.git"), "github.com");
	});

	it("ssh:// URL to an enterprise host", () => {
		assert.equal(parseHost("ssh://git@ghe.corp.example/takasek/pfdsl.git"), "ghe.corp.example");
	});

	it("keeps an explicit port", () => {
		assert.equal(parseHost("https://ghe.corp.example:8443/takasek/pfdsl"), "ghe.corp.example:8443");
	});

	it("strips userinfo from the authority", () => {
		assert.equal(parseHost("http://local_proxy@127.0.0.1:41729/git/takasek/pfdsl"), "127.0.0.1:41729");
	});

	it("returns null when no host can be extracted", () => {
		assert.equal(parseHost("not-a-url"), null);
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

/** 1-based page number from a `?…&page=N` URL (defaults to 1). */
function pageOf(url) {
	const m = url.match(/[?&]page=(\d+)/);
	return m ? Number(m[1]) : 1;
}

/** An open issue entry matching the REST `/issues` shape. */
function issue(number) {
	return { number, state: "open", labels: [], updated_at: "2026-01-01T00:00:00Z" };
}

/** A pull-request entry as it appears in the same `/issues` feed. */
function prEntry(number) {
	return { ...issue(number), pull_request: { url: "…" } };
}

/**
 * A fake fetch that serves `pages[page-1]` (an array) for URLs matching
 * `pathIncludes`, and an empty array once the pages run out — faithfully
 * reproducing GitHub's page-number pagination, including the empty
 * terminator page.
 */
function pagedFetchImpl(pathIncludes, pages, envelope = (arr) => arr) {
	return async (url) => {
		if (!url.includes(pathIncludes)) throw new Error(`unexpected url: ${url}`);
		return jsonResponse(envelope(pages[pageOf(url) - 1] ?? []));
	};
}

describe("fetchAllLabels", () => {
	it("paginates across pages, terminating on the empty page", async () => {
		const calls = [];
		const base = pagedFetchImpl("/labels", [
			[{ name: "bug", description: "b" }, { name: "flow:managed", description: "m" }],
			[{ name: "flow:exempt", description: "e" }],
		]);
		const fetchImpl = async (url, init) => {
			calls.push({ url, init });
			return base(url, init);
		};
		const result = await fetchAllLabels("takasek", "pfdsl", "tok", fetchImpl);
		assert.deepEqual(result.map((l) => l.name), ["bug", "flow:managed", "flow:exempt"]);
		assert.equal(calls.length, 3); // page 1, page 2, empty page 3
		assert.match(calls[0].url, /\/repos\/takasek\/pfdsl\/labels/);
		assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
	});

	it("throws with status and body text on a non-ok response", async () => {
		const fetchImpl = async () => jsonResponse({ message: "Bad credentials" }, false, 401);
		await assert.rejects(() => fetchAllLabels("takasek", "pfdsl", "bad-tok", fetchImpl), /401/);
	});
});

describe("fetchAllIssues", () => {
	it("concatenates issues across every page until the empty page", async () => {
		const pages = [
			Array.from({ length: 100 }, (_, i) => issue(200 - i)),
			Array.from({ length: 45 }, (_, i) => issue(100 - i)),
		];
		const result = await fetchAllIssues("takasek", "pfdsl", "tok", pagedFetchImpl("/issues", pages));
		assert.equal(result.length, 145);
		// the oldest issue, on the last non-empty page, must be present
		assert.ok(result.some((i) => i.number === 56));
	});

	it("does not stop on a short, non-final page (#543)", async () => {
		// page 2 comes back short (75 < per_page) but is NOT the last page —
		// the proxy can truncate a mid-stream page. Only the empty page ends it.
		let pagesFetched = 0;
		const pages = [
			Array.from({ length: 100 }, (_, i) => issue(1000 - i)),
			Array.from({ length: 75 }, (_, i) => issue(900 - i)),
			Array.from({ length: 30 }, (_, i) => issue(3 - i + 27)), // includes #3
		];
		const fetchImpl = async (url) => {
			pagesFetched = Math.max(pagesFetched, pageOf(url));
			return jsonResponse(pages[pageOf(url) - 1] ?? []);
		};
		const result = await fetchAllIssues("takasek", "pfdsl", "tok", fetchImpl);
		assert.equal(result.length, 205);
		assert.ok(pagesFetched >= 4, "should fetch past the short page to the empty terminator");
		assert.ok(result.some((i) => i.number === 3), "the old issue behind the short page must be included");
	});

	it("counts the limit against issues, not raw issue+PR entries (#543)", async () => {
		// Raw entries per page exceed the limit, but most are PRs. Counting raw
		// entries would stop after page 1 and drop the older issues on page 2.
		const pages = [
			[prEntry(20), prEntry(19), prEntry(18), issue(17), issue(16)],
			[issue(5), issue(4), issue(3)],
		];
		const result = await fetchAllIssues("takasek", "pfdsl", "tok", pagedFetchImpl("/issues", pages), 4);
		assert.deepEqual(result.map((i) => i.number), [17, 16, 5, 4]);
	});

	it("stops fetching once the limit of issues is collected", async () => {
		let pagesFetched = 0;
		const pages = [Array.from({ length: 100 }, (_, i) => issue(100 - i))];
		const fetchImpl = async (url) => {
			pagesFetched = Math.max(pagesFetched, pageOf(url));
			return jsonResponse(pages[pageOf(url) - 1] ?? []);
		};
		const result = await fetchAllIssues("takasek", "pfdsl", "tok", fetchImpl, 50);
		assert.equal(result.length, 50);
		assert.equal(pagesFetched, 1);
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
				return jsonResponse(
					pageOf(url) === 1
						? [{ number: 10, title: "flow sync", head: { ref: "flow-sync/pending", sha: "abc123" } }]
						: [],
				);
			}
			if (url.includes("/check-runs")) {
				return jsonResponse({ check_runs: pageOf(url) === 1 ? [{ status: "completed", conclusion: "success" }] : [] });
			}
			throw new Error(`unexpected url: ${url}`);
		};
		const result = await fetchOpenPrsWithCi("takasek", "pfdsl", "tok", fetchImpl);
		assert.deepEqual(result, [
			{ number: 10, title: "flow sync", headRefName: "flow-sync/pending", statusCheckRollup: [{ conclusion: "SUCCESS" }] },
		]);
	});

	it("paginates open PRs across pages until the empty page", async () => {
		const prPages = [
			[{ number: 30, title: "a", head: { ref: "a", sha: "s30" } }, { number: 29, title: "b", head: { ref: "b", sha: "s29" } }],
			[{ number: 5, title: "c", head: { ref: "c", sha: "s5" } }],
		];
		const fetchImpl = async (url) => {
			if (url.includes("/pulls?")) return jsonResponse(prPages[pageOf(url) - 1] ?? []);
			if (url.includes("/check-runs")) return jsonResponse({ check_runs: [] });
			throw new Error(`unexpected url: ${url}`);
		};
		const result = await fetchOpenPrsWithCi("takasek", "pfdsl", "tok", fetchImpl);
		assert.deepEqual(result.map((p) => p.number), [30, 29, 5]);
	});
});

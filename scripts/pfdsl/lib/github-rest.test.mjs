import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	fetchAllIssues,
	fetchAllLabels,
	fetchIssueView,
	fetchOpenPrsWithCi,
	getIssueBody,
	mapCheckRunsToRollup,
	mapIssuesResponse,
	mapLabelsResponse,
	parseHost,
	parseOwnerRepo,
} from "./github-rest.mjs";

describe("parseOwnerRepo", () => {
	it("https URL with .git suffix", () => {
		assert.deepEqual(parseOwnerRepo("https://github.com/takasek/pfdsl.git"), {
			owner: "takasek",
			repo: "pfdsl",
		});
	});

	it("https URL without .git suffix", () => {
		assert.deepEqual(parseOwnerRepo("https://github.com/takasek/pfdsl"), {
			owner: "takasek",
			repo: "pfdsl",
		});
	});

	it("scp-like git@ URL", () => {
		assert.deepEqual(parseOwnerRepo("git@github.com:takasek/pfdsl.git"), {
			owner: "takasek",
			repo: "pfdsl",
		});
	});

	it("reverse-proxied remote (Claude Code Remote's local git proxy)", () => {
		assert.deepEqual(
			parseOwnerRepo("http://local_proxy@127.0.0.1:41729/git/takasek/pfdsl"),
			{
				owner: "takasek",
				repo: "pfdsl",
			},
		);
	});

	it("returns null when fewer than two path segments", () => {
		assert.equal(parseOwnerRepo("https://github.com/takasek"), null);
	});
});

describe("parseHost", () => {
	it("https URL", () => {
		assert.equal(
			parseHost("https://github.com/takasek/pfdsl.git"),
			"github.com",
		);
	});

	it("https URL to a GitHub Enterprise host", () => {
		assert.equal(
			parseHost("https://ghe.corp.example/takasek/pfdsl"),
			"ghe.corp.example",
		);
	});

	it("scp-like git@ URL", () => {
		assert.equal(parseHost("git@github.com:takasek/pfdsl.git"), "github.com");
	});

	it("ssh:// URL to an enterprise host", () => {
		assert.equal(
			parseHost("ssh://git@ghe.corp.example/takasek/pfdsl.git"),
			"ghe.corp.example",
		);
	});

	it("keeps an explicit port", () => {
		assert.equal(
			parseHost("https://ghe.corp.example:8443/takasek/pfdsl"),
			"ghe.corp.example:8443",
		);
	});

	it("strips userinfo from the authority", () => {
		assert.equal(
			parseHost("http://local_proxy@127.0.0.1:41729/git/takasek/pfdsl"),
			"127.0.0.1:41729",
		);
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
			{
				number: 1,
				state: "open",
				labels: [],
				updated_at: "2026-01-01T00:00:00Z",
			},
			{
				number: 2,
				state: "open",
				pull_request: {},
				labels: [],
				updated_at: "2026-01-01T00:00:00Z",
			},
		]);
		assert.deepEqual(
			result.map((i) => i.number),
			[1],
		);
	});

	it("uppercases state and stateReason to match gh CLI's --json output", () => {
		const result = mapIssuesResponse([
			{
				number: 5,
				state: "closed",
				state_reason: "not_planned",
				labels: [],
				updated_at: "2026-01-01T00:00:00Z",
			},
		]);
		assert.equal(result[0].state, "CLOSED");
		assert.equal(result[0].stateReason, "NOT_PLANNED");
	});

	it("null stateReason stays null", () => {
		const result = mapIssuesResponse([
			{
				number: 6,
				state: "open",
				state_reason: null,
				labels: [],
				updated_at: "2026-01-01T00:00:00Z",
			},
		]);
		assert.equal(result[0].stateReason, null);
	});

	it("maps labels to {name} objects", () => {
		const result = mapIssuesResponse([
			{
				number: 7,
				state: "open",
				labels: [{ name: "flow:managed" }],
				updated_at: "2026-01-01T00:00:00Z",
			},
		]);
		assert.deepEqual(result[0].labels, [{ name: "flow:managed" }]);
	});
});

describe("mapCheckRunsToRollup", () => {
	it("uppercases conclusion for completed runs", () => {
		const result = mapCheckRunsToRollup([
			{ status: "completed", conclusion: "success" },
		]);
		assert.deepEqual(result, [{ conclusion: "SUCCESS" }]);
	});

	it("null conclusion for runs still in progress", () => {
		const result = mapCheckRunsToRollup([
			{ status: "in_progress", conclusion: null },
		]);
		assert.deepEqual(result, [{ conclusion: null }]);
	});
});

// ---------------------------------------------------------------------------
// Async REST calls, exercised against an injected fake fetch (no network).
// ---------------------------------------------------------------------------

function jsonResponse(body, ok = true, status = 200) {
	return {
		ok,
		status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	};
}

/** 1-based page number from a `?…&page=N` URL (defaults to 1). */
function pageOf(url) {
	const m = url.match(/[?&]page=(\d+)/);
	return m ? Number(m[1]) : 1;
}

/** An open issue entry matching the REST `/issues` shape. */
function issue(number) {
	return {
		number,
		state: "open",
		labels: [],
		updated_at: "2026-01-01T00:00:00Z",
	};
}

/** A pull-request entry as it appears in the same `/issues` feed. */
function prEntry(number) {
	return { ...issue(number), pull_request: { url: "…" } };
}

/**
 * A fake fetch that serves `pages[page-1]` (an array) for URLs matching
 * `pathIncludes`, and an empty array once the pages run out — reproducing
 * GitHub's page-number pagination.
 */
function pagedFetchImpl(pathIncludes, pages, envelope = (arr) => arr) {
	return async (url) => {
		if (!url.includes(pathIncludes)) throw new Error(`unexpected url: ${url}`);
		return jsonResponse(envelope(pages[pageOf(url) - 1] ?? []));
	};
}

/** A full page (per_page=100) of issues numbered downwards from `from`. */
function fullPage(from) {
	return Array.from({ length: 100 }, (_, i) => issue(from - i));
}

describe("fetchAllLabels", () => {
	it("stops after a single short page", async () => {
		const calls = [];
		const fetchImpl = async (url, init) => {
			calls.push({ url, init });
			return jsonResponse([
				{ name: "bug", description: "Something isn't working" },
			]);
		};
		const result = await fetchAllLabels("takasek", "pfdsl", "tok", fetchImpl);
		assert.deepEqual(result, [
			{ name: "bug", description: "Something isn't working" },
		]);
		assert.equal(
			calls.length,
			1,
			"a short first page is the last page — no terminator round-trip",
		);
		assert.match(calls[0].url, /\/repos\/takasek\/pfdsl\/labels/);
		assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
	});

	it("paginates past a full page, terminating on the short one", async () => {
		const pages = [
			Array.from({ length: 100 }, (_, i) => ({
				name: `l${i}`,
				description: "",
			})),
			[{ name: "flow:exempt", description: "e" }],
		];
		const result = await fetchAllLabels(
			"takasek",
			"pfdsl",
			"tok",
			pagedFetchImpl("/labels", pages),
		);
		assert.equal(result.length, 101);
		assert.equal(result.at(-1).name, "flow:exempt");
	});

	it("throws instead of truncating when the page parameter never advances", async () => {
		// A layer that ignores `page` (over-eager stub or cache) would otherwise
		// spin forever; returning a partial list silently is the #543 failure.
		const fetchImpl = async () =>
			jsonResponse(
				Array.from({ length: 100 }, (_, i) => ({
					name: `l${i}`,
					description: "",
				})),
			);
		await assert.rejects(
			() => fetchAllLabels("takasek", "pfdsl", "tok", fetchImpl),
			/pagination exceeded/,
		);
	});

	it("throws with status and body text on a non-ok response", async () => {
		const fetchImpl = async () =>
			jsonResponse({ message: "Bad credentials" }, false, 401);
		await assert.rejects(
			() => fetchAllLabels("takasek", "pfdsl", "bad-tok", fetchImpl),
			/401/,
		);
	});
});

describe("fetchAllIssues", () => {
	it("concatenates issues across pages, terminating on the short page", async () => {
		const pages = [
			fullPage(200),
			Array.from({ length: 45 }, (_, i) => issue(100 - i)),
		];
		const result = await fetchAllIssues(
			"takasek",
			"pfdsl",
			"tok",
			pagedFetchImpl("/issues", pages),
		);
		assert.equal(result.length, 145);
		assert.ok(
			result.some((i) => i.number === 56),
			"the oldest issue on the last page must be present",
		);
	});

	it("reaches issues beyond the first `limit` raw entries when PRs are interleaved (#543)", async () => {
		// The real failure: the /issues feed interleaves PRs, and the limit used
		// to count raw entries. Five full pages here carry only 175 issues (as
		// the live repo did), so a raw-entry limit of 500 stopped before page 6
		// and never fetched the oldest issues — #3 and #12 among them.
		const perPageIssueCounts = [33, 45, 42, 32, 23];
		let next = 545;
		const pages = perPageIssueCounts.map((issueCount) => {
			const page = [];
			for (let i = 0; i < 100; i++)
				page.push(i < issueCount ? issue(next--) : prEntry(next--));
			return page;
		});
		pages.push([issue(12), issue(3)]); // the short final page, holding the old issues

		const result = await fetchAllIssues(
			"takasek",
			"pfdsl",
			"tok",
			pagedFetchImpl("/issues", pages),
			500,
		);
		assert.ok(
			result.some((i) => i.number === 3),
			"#3 must be reached",
		);
		assert.ok(
			result.some((i) => i.number === 12),
			"#12 must be reached",
		);
		assert.equal(result.length, 177);
		assert.ok(
			result.every((i) => !("pull_request" in i)),
			"pull requests must be filtered out",
		);
	});

	it("stops fetching once `limit` issues are collected", async () => {
		let pagesFetched = 0;
		const fetchImpl = async (url) => {
			pagesFetched = Math.max(pagesFetched, pageOf(url));
			return jsonResponse(fullPage(1000 - (pageOf(url) - 1) * 100));
		};
		const result = await fetchAllIssues(
			"takasek",
			"pfdsl",
			"tok",
			fetchImpl,
			50,
		);
		assert.equal(result.length, 50);
		assert.equal(pagesFetched, 1, "must not keep paging once the limit is met");
	});

	it("keeps paging for a mostly-PR feed instead of treating limit/per_page as a page bound", async () => {
		// 3 issues per full page: reaching a limit of 6 legitimately needs 2
		// pages even though limit/per_page rounds to 1.
		const fetchImpl = async (url) => {
			const p = pageOf(url);
			if (p > 3) return jsonResponse([]);
			const base = 1000 - (p - 1) * 100;
			return jsonResponse(
				Array.from({ length: 100 }, (_, i) =>
					i < 3 ? issue(base - i) : prEntry(base - i),
				),
			);
		};
		const result = await fetchAllIssues(
			"takasek",
			"pfdsl",
			"tok",
			fetchImpl,
			6,
		);
		assert.equal(result.length, 6);
	});

	it("throws instead of truncating when the page parameter never advances", async () => {
		const fetchImpl = async () => jsonResponse(fullPage(1000));
		await assert.rejects(
			() => fetchAllIssues("takasek", "pfdsl", "tok", fetchImpl, 100000),
			/pagination exceeded/,
		);
	});
});

describe("getIssueBody", () => {
	it("returns the raw body text", async () => {
		const fetchImpl = async () => jsonResponse({ body: "design TBD" });
		assert.equal(
			await getIssueBody("takasek", "pfdsl", "tok", 42, fetchImpl),
			"design TBD",
		);
	});

	it("returns empty string for a null body", async () => {
		const fetchImpl = async () => jsonResponse({ body: null });
		assert.equal(
			await getIssueBody("takasek", "pfdsl", "tok", 42, fetchImpl),
			"",
		);
	});
});

// #745: the fallback answered `issue view --json author,body,comments` with
// the body text alone, so JSON.parse threw in the caller and the failure was
// reported as gh being unavailable — in the one environment where the fallback
// is the whole point of having gh-exec.
describe("fetchIssueView", () => {
	const issueApi = {
		number: 42,
		body: "design TBD",
		user: { login: "takasek" },
		created_at: "2026-08-01T00:00:00Z",
	};

	it("returns gh's --json field names, not the REST ones", async () => {
		const fetchImpl = async () => jsonResponse(issueApi);
		const result = await fetchIssueView(
			"takasek",
			"pfdsl",
			"tok",
			42,
			["author", "body", "createdAt"],
			fetchImpl,
		);
		assert.deepEqual(result, {
			author: { login: "takasek" },
			body: "design TBD",
			createdAt: "2026-08-01T00:00:00Z",
		});
	});

	it("returns only the fields that were asked for", async () => {
		const fetchImpl = async () => jsonResponse(issueApi);
		const result = await fetchIssueView(
			"takasek",
			"pfdsl",
			"tok",
			42,
			["body"],
			fetchImpl,
		);
		assert.deepEqual(result, { body: "design TBD" });
	});

	it("fetches comments from their own endpoint and maps them to gh's shape", async () => {
		const urls = [];
		const fetchImpl = async (url) => {
			urls.push(url);
			if (url.includes("/comments"))
				return jsonResponse([
					{
						body: "前提: ...",
						user: { login: "takasek" },
						created_at: "2026-08-02T00:00:00Z",
					},
				]);
			return jsonResponse(issueApi);
		};
		const result = await fetchIssueView(
			"takasek",
			"pfdsl",
			"tok",
			42,
			["comments"],
			fetchImpl,
		);
		assert.deepEqual(result, {
			comments: [
				{
					author: { login: "takasek" },
					body: "前提: ...",
					createdAt: "2026-08-02T00:00:00Z",
				},
			],
		});
		assert.ok(urls.some((u) => u.includes("/issues/42/comments")));
	});

	it("does not call the comments endpoint when comments were not asked for", async () => {
		const urls = [];
		const fetchImpl = async (url) => {
			urls.push(url);
			return jsonResponse(issueApi);
		};
		await fetchIssueView("takasek", "pfdsl", "tok", 42, ["body"], fetchImpl);
		assert.ok(!urls.some((u) => u.includes("/comments")));
	});

	// Omitting an unknown field would hand the caller an object missing a key
	// it asked for — the same silent shape mismatch this whole change is about.
	it("refuses a field it cannot map rather than omitting it", async () => {
		const fetchImpl = async () => jsonResponse(issueApi);
		await assert.rejects(
			() =>
				fetchIssueView("takasek", "pfdsl", "tok", 42, ["milestone"], fetchImpl),
			/milestone/,
		);
	});

	it("returns empty string for a null body", async () => {
		const fetchImpl = async () => jsonResponse({ ...issueApi, body: null });
		const result = await fetchIssueView(
			"takasek",
			"pfdsl",
			"tok",
			42,
			["body"],
			fetchImpl,
		);
		assert.deepEqual(result, { body: "" });
	});
});

describe("fetchOpenPrsWithCi", () => {
	it("attaches a statusCheckRollup per PR from its head sha's check-runs", async () => {
		const calls = [];
		const fetchImpl = async (url) => {
			calls.push(url);
			if (url.includes("/pulls?")) {
				return jsonResponse([
					{
						number: 10,
						title: "flow sync",
						head: { ref: "flow-sync/pending", sha: "abc123" },
					},
				]);
			}
			if (url.includes("/check-runs")) {
				return jsonResponse({
					check_runs: [{ status: "completed", conclusion: "success" }],
				});
			}
			throw new Error(`unexpected url: ${url}`);
		};
		const result = await fetchOpenPrsWithCi(
			"takasek",
			"pfdsl",
			"tok",
			fetchImpl,
		);
		assert.deepEqual(result, [
			{
				number: 10,
				title: "flow sync",
				headRefName: "flow-sync/pending",
				statusCheckRollup: [{ conclusion: "SUCCESS" }],
			},
		]);
		assert.equal(
			calls.length,
			2,
			"one short page each — no terminator round-trips",
		);
	});

	it("paginates open PRs past a full page, terminating on the short one", async () => {
		const prPages = [
			Array.from({ length: 100 }, (_, i) => ({
				number: 200 - i,
				title: "a",
				head: { ref: "a", sha: `s${200 - i}` },
			})),
			[{ number: 5, title: "c", head: { ref: "c", sha: "s5" } }],
		];
		const fetchImpl = async (url) => {
			if (url.includes("/pulls?"))
				return jsonResponse(prPages[pageOf(url) - 1] ?? []);
			if (url.includes("/check-runs")) return jsonResponse({ check_runs: [] });
			throw new Error(`unexpected url: ${url}`);
		};
		const result = await fetchOpenPrsWithCi(
			"takasek",
			"pfdsl",
			"tok",
			fetchImpl,
		);
		assert.equal(result.length, 101);
		assert.equal(result.at(-1).number, 5);
	});

	it("paginates a head sha's check-runs past a full page", async () => {
		const runPages = [
			Array.from({ length: 100 }, () => ({
				status: "completed",
				conclusion: "success",
			})),
			[{ status: "completed", conclusion: "failure" }],
		];
		const fetchImpl = async (url) => {
			if (url.includes("/pulls?"))
				return jsonResponse([
					{ number: 1, title: "t", head: { ref: "r", sha: "sha1" } },
				]);
			if (url.includes("/check-runs"))
				return jsonResponse({ check_runs: runPages[pageOf(url) - 1] ?? [] });
			throw new Error(`unexpected url: ${url}`);
		};
		const [pr] = await fetchOpenPrsWithCi("takasek", "pfdsl", "tok", fetchImpl);
		assert.equal(pr.statusCheckRollup.length, 101);
		assert.equal(pr.statusCheckRollup.at(-1).conclusion, "FAILURE");
	});
});

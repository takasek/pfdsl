import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
	buildDesignRecordEditQuery,
	createGitHubOps,
	parseDesignRecordEditResponse,
} from "./github-ops.mjs";

// A real `gh` binary may or may not be on PATH depending on the environment
// (see gh-exec.test.mjs) — this builds a PATH containing only a symlink to
// the real `git` (owner/repo resolution needs it) and nothing else, so `gh`
// reliably resolves to ENOENT regardless of what the host has installed.
function ghlessPathWithGit() {
	const dir = mkdtempSync(join(tmpdir(), "github-ops-test-path-"));
	const gitPath = execFileSync("which", ["git"], { encoding: "utf-8" }).trim();
	symlinkSync(gitPath, join(dir, "git"));
	return dir;
}

/** A stub execGhImpl recording calls and answering from a table keyed by the
 * argv's command+subcommand, joined with a space (e.g. "label list"). */
function stubExecGh(table) {
	const calls = [];
	const impl = async (args) => {
		calls.push(args);
		const key = `${args[0]} ${args[1]}`;
		if (!(key in table)) throw new Error(`stubExecGh: no entry for '${key}'`);
		const entry = table[key];
		if (entry instanceof Error) {
			// "ENOENT" is shorthand for "gh itself is missing" — give it the
			// error shape isGhUnavailableError actually checks (error.code).
			if (entry.message === "ENOENT" && entry.code === undefined)
				entry.code = "ENOENT";
			throw entry;
		}
		return entry;
	};
	impl.calls = calls;
	return impl;
}

/** Records each fetch call and answers with `body`. */
function stubFetch(body) {
	const calls = [];
	const impl = async (url, init = {}) => {
		calls.push({ url: String(url), init });
		return {
			ok: true,
			status: 200,
			headers: { get: () => null },
			json: async () => body,
			text: async () => JSON.stringify(body),
		};
	};
	impl.calls = calls;
	return impl;
}

/** Answers successive calls from `pages`, so a paginated walk sees a real end
 * (the last page shorter than a full one). */
function stubPagedFetch(pages) {
	let index = 0;
	return async () => {
		const body = pages[Math.min(index++, pages.length - 1)];
		return {
			ok: true,
			status: 200,
			headers: { get: () => null },
			json: async () => body,
			text: async () => JSON.stringify(body),
		};
	};
}

describe("createGitHubOps parity: gh backend vs HTTP backend", () => {
	// Every parity case drives the HTTP backend, which only answers with a
	// token present.
	beforeEach(() => {
		process.env.GH_TOKEN = "tok";
	});
	afterEach(() => {
		delete process.env.GH_TOKEN;
	});

	it("listLabels: both backends normalize a null description to an empty string", async () => {
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({
				"label list": JSON.stringify([
					{ name: "flow:managed", description: null },
				]),
			}),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label list": new Error("ENOENT") }),
			fetchImpl: stubFetch([{ name: "flow:managed", description: null }]),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.listLabels(),
			httpOps.listLabels(),
		]);
		assert.deepEqual(ghResult, [{ name: "flow:managed", description: "" }]);
		assert.deepEqual(ghResult, httpResult);
	});

	// The gh argv carries `--limit`, so gh stops at that many labels. The HTTP
	// backend walks every page, and nothing capped it — a repo past the limit
	// got a longer list from one backend than the other while the parity claim
	// stood (found by the independent design review of #1044).
	it("listLabels: both backends stop at the same limit", async () => {
		const label = (i) => ({ name: `label-${i}`, description: null });
		const page1 = Array.from({ length: 100 }, (_, i) => label(i));
		const page2 = Array.from({ length: 50 }, (_, i) => label(100 + i));
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label list": JSON.stringify(page1) }),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label list": new Error("ENOENT") }),
			fetchImpl: stubPagedFetch([page1, page2]),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.listLabels(),
			httpOps.listLabels(),
		]);
		assert.equal(ghResult.length, 100);
		assert.deepEqual(ghResult, httpResult);
	});

	it("listIssues: both backends return the same shape", async () => {
		const raw = [
			{
				number: 1,
				state: "OPEN",
				stateReason: null,
				labels: [{ name: "flow:managed" }],
				updatedAt: "2026-01-01T00:00:00Z",
			},
		];
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({ "issue list": JSON.stringify(raw) }),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "issue list": new Error("ENOENT") }),
			fetchImpl: stubFetch([
				{
					number: 1,
					state: "open",
					state_reason: null,
					labels: [{ name: "flow:managed" }],
					updated_at: "2026-01-01T00:00:00Z",
				},
			]),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.listIssues(),
			httpOps.listIssues(),
		]);
		assert.deepEqual(ghResult, raw);
		assert.deepEqual(ghResult, httpResult);
	});

	it("viewIssue: both backends answer the requested fields alone", async () => {
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({
				"issue view": JSON.stringify({ number: 612, body: "hello" }),
			}),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "issue view": new Error("ENOENT") }),
			fetchImpl: stubFetch({ number: 612, body: "hello" }),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.viewIssue({ number: 612, fields: ["number", "body"] }),
			httpOps.viewIssue({ number: 612, fields: ["number", "body"] }),
		]);
		assert.deepEqual(ghResult, { number: 612, body: "hello" });
		assert.deepEqual(ghResult, httpResult);
	});

	it("viewPr: both backends answer the requested fields alone", async () => {
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({
				"pr view": JSON.stringify({ number: 5, body: "closes #1" }),
			}),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "pr view": new Error("ENOENT") }),
			fetchImpl: stubFetch({ number: 5, body: "closes #1", html_url: "x" }),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.viewPr({ number: 5, fields: ["number", "body"] }),
			httpOps.viewPr({ number: 5, fields: ["number", "body"] }),
		]);
		assert.deepEqual(ghResult, { number: 5, body: "closes #1" });
		assert.deepEqual(ghResult, httpResult);
	});

	it("listOpenPrs: both backends return the same shape", async () => {
		const raw = [
			{
				number: 5,
				title: "x",
				headRefName: "feature",
				statusCheckRollup: [{ conclusion: "SUCCESS" }],
			},
		];
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({ "pr list": JSON.stringify(raw) }),
		});
		const fetchCalls = [];
		const fetchImpl = async (url) => {
			fetchCalls.push(String(url));
			if (String(url).includes("/pulls?")) {
				return {
					ok: true,
					json: async () => [
						{ number: 5, title: "x", head: { ref: "feature", sha: "abc" } },
					],
				};
			}
			return {
				ok: true,
				json: async () => ({
					check_runs: [{ status: "completed", conclusion: "success" }],
				}),
			};
		};
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "pr list": new Error("ENOENT") }),
			fetchImpl,
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.listOpenPrs(),
			httpOps.listOpenPrs(),
		]);
		assert.deepEqual(ghResult, raw);
		assert.deepEqual(ghResult, httpResult);
	});

	it("listOpenPrs: both backends stop at the same explicit limit", async () => {
		const pr = (number) => ({
			number,
			title: `PR ${number}`,
			headRefName: `branch-${number}`,
			statusCheckRollup: [],
		});
		const ghRows = Array.from({ length: 30 }, (_, i) => pr(i + 1));
		const restRows = Array.from({ length: 31 }, (_, i) => ({
			number: i + 1,
			title: `PR ${i + 1}`,
			head: { ref: `branch-${i + 1}`, sha: `sha-${i + 1}` },
		}));
		const ghExec = stubExecGh({ "pr list": JSON.stringify(ghRows) });
		const ghOps = createGitHubOps({ execGhImpl: ghExec });
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "pr list": new Error("ENOENT") }),
			fetchImpl: stubPagedFetch([restRows]),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.listOpenPrs(),
			httpOps.listOpenPrs(),
		]);
		assert.deepEqual(ghExec.calls[0].slice(-2), ["--limit", "30"]);
		assert.equal(ghResult.length, 30);
		assert.deepEqual(ghResult, httpResult);
	});

	it("addIssueLabel: both backends make the same call and return void", async () => {
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({ "issue edit": "" }),
		});
		const fetch = stubFetch({});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "issue edit": new Error("ENOENT") }),
			fetchImpl: fetch,
		});
		assert.equal(
			await ghOps.addIssueLabel({ number: 612, label: "flow:exempt" }),
			undefined,
		);
		assert.equal(
			await httpOps.addIssueLabel({ number: 612, label: "flow:exempt" }),
			undefined,
		);
		assert.match(fetch.calls[0].url, /\/issues\/612\/labels$/);
	});

	it("createLabel: both backends make the same call and return void", async () => {
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label create": "" }),
		});
		const fetch = stubFetch({});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label create": new Error("ENOENT") }),
			fetchImpl: fetch,
		});
		await ghOps.createLabel({
			name: "flow:exempt",
			description: "not tracked",
			color: "ededed",
		});
		await httpOps.createLabel({
			name: "flow:exempt",
			description: "not tracked",
			color: "ededed",
		});
		assert.deepEqual(JSON.parse(fetch.calls[0].init.body), {
			name: "flow:exempt",
			description: "not tracked",
			color: "ededed",
		});
	});

	it("editLabel: both backends make the same call and return void", async () => {
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label edit": "" }),
		});
		const fetch = stubFetch({});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label edit": new Error("ENOENT") }),
			fetchImpl: fetch,
		});
		await ghOps.editLabel({ name: "flow:exempt", description: "reworded" });
		await httpOps.editLabel({ name: "flow:exempt", description: "reworded" });
		assert.deepEqual(JSON.parse(fetch.calls[0].init.body), {
			description: "reworded",
		});
	});
});

describe("createGitHubOps: designRecordEditInfo has no HTTP backend", () => {
	it("fetches via gh's graphql call and parses the response", async () => {
		const raw = {
			data: {
				repository: {
					issue: {
						lastEditedAt: null,
						comments: {
							totalCount: 1,
							nodes: [{ id: "c1", lastEditedAt: "2026-07-05T00:00:00Z" }],
						},
					},
				},
			},
		};
		const ghExec = stubExecGh({ "api graphql": JSON.stringify(raw) });
		const ops = createGitHubOps({ execGhImpl: ghExec });
		const result = await ops.designRecordEditInfo({ number: 737 });
		assert.deepEqual(result, {
			issueLastEditedAt: null,
			comments: {
				totalCount: 1,
				nodes: [{ id: "c1", lastEditedAt: "2026-07-05T00:00:00Z" }],
			},
		});
		assert.equal(ghExec.calls[0][0], "api");
		assert.equal(ghExec.calls[0][1], "graphql");
	});

	it("throws an operation-named error rather than the raw ENOENT once it would fall back to HTTP", async () => {
		process.env.GH_TOKEN = "tok";
		try {
			const ops = createGitHubOps({
				execGhImpl: stubExecGh({ "api graphql": new Error("ENOENT") }),
			});
			await assert.rejects(
				() => ops.designRecordEditInfo({ number: 737 }),
				(e) => {
					assert.match(e.message, /designRecordEditInfo/);
					assert.match(e.message, /HTTP/);
					return true;
				},
			);
		} finally {
			delete process.env.GH_TOKEN;
		}
	});

	it("rethrows the original ENOENT when there is no token to fall back with", async () => {
		delete process.env.GH_TOKEN;
		delete process.env.GITHUB_TOKEN;
		const enoent = Object.assign(new Error("spawn gh ENOENT"), {
			code: "ENOENT",
		});
		const ops = createGitHubOps({
			execGhImpl: stubExecGh({ "api graphql": enoent }),
		});
		await assert.rejects(
			() => ops.designRecordEditInfo({ number: 737 }),
			(e) => e.code === "ENOENT",
		);
	});
});

describe("createGitHubOps: backend-selection discipline against a real gh-less PATH", () => {
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

	it("rethrows the original ENOENT when gh is absent and there is no token", async () => {
		delete process.env.GH_TOKEN;
		delete process.env.GITHUB_TOKEN;
		const ops = createGitHubOps();
		await assert.rejects(
			() => ops.listLabels(),
			(e) => e.code === "ENOENT",
		);
	});

	it("falls back to the real HTTP backend when gh is absent and a token is present", async () => {
		process.env.GH_TOKEN = "tok";
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => [{ name: "flow:managed", description: null }],
		});
		const ops = createGitHubOps();
		const result = await ops.listLabels();
		assert.deepEqual(result, [{ name: "flow:managed", description: "" }]);
	});
});

describe("buildDesignRecordEditQuery", () => {
	it("names the owner, repo and issue number as GraphQL variables", () => {
		const args = buildDesignRecordEditQuery({
			owner: "takasek",
			repo: "pfdsl",
			number: 737,
		});
		assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
		assert.ok(args.includes("owner=takasek"));
		assert.ok(args.includes("repo=pfdsl"));
		assert.ok(args.includes("number=737"));
		const queryArg = args[args.length - 1];
		assert.match(queryArg, /lastEditedAt/);
		assert.match(queryArg, /comments\(first:100\)/);
	});
});

describe("parseDesignRecordEditResponse", () => {
	it("reads the issue's own lastEditedAt and each comment's, keyed by id", () => {
		const json = JSON.stringify({
			data: {
				repository: {
					issue: {
						lastEditedAt: null,
						comments: {
							totalCount: 1,
							nodes: [{ id: "c1", lastEditedAt: "2026-07-05T00:00:00Z" }],
						},
					},
				},
			},
		});
		assert.deepEqual(parseDesignRecordEditResponse(json), {
			issueLastEditedAt: null,
			comments: {
				totalCount: 1,
				nodes: [{ id: "c1", lastEditedAt: "2026-07-05T00:00:00Z" }],
			},
		});
	});

	it("throws on a response shape it does not recognize", () => {
		assert.throws(() => parseDesignRecordEditResponse(JSON.stringify({})));
	});
});

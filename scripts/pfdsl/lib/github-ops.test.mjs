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

async function assertListSaturation(promise, operation, limit) {
	await assert.rejects(promise, (error) => {
		assert.match(error.message, new RegExp(operation));
		assert.match(error.message, new RegExp(`limit of ${limit}`));
		return true;
	});
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

	it("listLabels: both backends return the same list below the limit", async () => {
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({
				"label list": JSON.stringify([
					{ name: "flow:managed", description: null },
					{ name: "flow:exempt", description: "not tracked" },
				]),
			}),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label list": new Error("ENOENT") }),
			fetchImpl: stubFetch([
				{ name: "flow:managed", description: null },
				{ name: "flow:exempt", description: "not tracked" },
			]),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.listLabels(),
			httpOps.listLabels(),
		]);
		assert.deepEqual(ghResult, [
			{ name: "flow:managed", description: "" },
			{ name: "flow:exempt", description: "not tracked" },
		]);
		assert.deepEqual(ghResult, httpResult);
	});

	it("listLabels: both backends reject a saturated list", async () => {
		const label = (i) => ({ name: `label-${i}`, description: null });
		const page1 = Array.from({ length: 100 }, (_, i) => label(i));
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label list": JSON.stringify(page1) }),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "label list": new Error("ENOENT") }),
			fetchImpl: stubPagedFetch([page1, []]),
		});
		await Promise.all([
			assertListSaturation(ghOps.listLabels(), "listLabels", 100),
			assertListSaturation(httpOps.listLabels(), "listLabels", 100),
		]);
	});

	it("listIssues: both backends return the same list below the limit", async () => {
		const raw = [
			{
				number: 1,
				state: "OPEN",
				stateReason: null,
				labels: [{ name: "flow:managed" }],
				updatedAt: "2026-01-01T00:00:00Z",
			},
			{
				number: 2,
				state: "CLOSED",
				stateReason: "COMPLETED",
				labels: [],
				updatedAt: "2026-01-02T00:00:00Z",
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
				{
					number: 2,
					state: "closed",
					state_reason: "completed",
					labels: [],
					updated_at: "2026-01-02T00:00:00Z",
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

	it("listIssues: the raised cap admits an issue beyond the old cap", async () => {
		const allIssues = [
			...Array.from({ length: 501 }, (_, i) => ({ number: 1001 - i })),
			{ number: 3 },
		];
		const ghExec = async (args) => {
			return JSON.stringify(allIssues.slice(0, Number(args.at(-1))));
		};
		const ops = createGitHubOps({ execGhImpl: ghExec });

		const result = await ops.listIssues();

		assert.equal(result.length, 502);
		assert.equal(result.at(-1).number, 3);
	});

	it("listIssues: both backends reject a saturated list", async () => {
		const issue = (number) => ({
			number,
			state: "OPEN",
			state_reason: null,
			labels: [],
			updated_at: "2026-01-01T00:00:00Z",
		});
		const page = Array.from({ length: 1000 }, (_, i) => issue(i + 1));
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({
				"issue list": JSON.stringify(page),
			}),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "issue list": new Error("ENOENT") }),
			fetchImpl: stubPagedFetch([page, []]),
		});

		await Promise.all([
			assertListSaturation(ghOps.listIssues(), "listIssues", 1000),
			assertListSaturation(httpOps.listIssues(), "listIssues", 1000),
		]);
	});

	it("viewIssue: both backends return matching comment node IDs and fields", async () => {
		const comment = {
			author: { login: "takasek" },
			authorAssociation: "OWNER",
			body: "hello from a comment",
			createdAt: "2026-09-05T00:00:00Z",
			id: "IC_kwDOCommentNodeId",
			includesCreatedEdit: false,
			isMinimized: false,
			minimizedReason: "",
			reactionGroups: [],
			url: "https://github.com/takasek/pfdsl/issues/612#issuecomment-123",
			viewerDidAuthor: true,
		};
		// Field names and values mirror `gh issue view 1098 --json comments`;
		// the gh backend must reduce this real response shape to the HTTP contract.
		const normalizedComment = {
			id: comment.id,
			databaseId: 123,
			author: comment.author,
			body: comment.body,
			createdAt: comment.createdAt,
			url: comment.url,
		};
		const ghOps = createGitHubOps({
			execGhImpl: stubExecGh({
				"issue view": JSON.stringify({
					number: 612,
					body: "hello",
					comments: [comment],
				}),
			}),
		});
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "issue view": new Error("ENOENT") }),
			fetchImpl: async (url) =>
				String(url).includes("/comments")
					? stubFetch([
							{
								id: normalizedComment.databaseId,
								node_id: comment.id,
								body: comment.body,
								created_at: comment.createdAt,
								user: { login: comment.author.login },
								html_url: comment.url,
							},
						])(url)
					: stubFetch({ number: 612, body: "hello" })(url),
		});
		const [ghResult, httpResult] = await Promise.all([
			ghOps.viewIssue({ number: 612, fields: ["number", "body", "comments"] }),
			httpOps.viewIssue({
				number: 612,
				fields: ["number", "body", "comments"],
			}),
		]);
		assert.deepEqual(ghResult, {
			number: 612,
			body: "hello",
			comments: [normalizedComment],
		});
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

	it("listOpenPrs: both backends return the same list below the limit", async () => {
		const raw = [
			{
				number: 5,
				title: "x",
			},
			{
				number: 6,
				title: "y",
			},
		];
		const ghExec = stubExecGh({ "pr list": JSON.stringify(raw) });
		const ghOps = createGitHubOps({ execGhImpl: ghExec });
		const fetchCalls = [];
		const fetchImpl = async (url) => {
			fetchCalls.push(String(url));
			if (String(url).includes("/pulls?")) {
				return {
					ok: true,
					json: async () => [
						{ number: 5, title: "x", head: { ref: "feature", sha: "abc" } },
						{
							number: 6,
							title: "y",
							head: { ref: "feature-two", sha: "def" },
						},
					],
				};
			}
			throw new Error(`unexpected URL: ${url}`);
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
		assert.equal(fetchCalls.length, 1, "HTTP list does not request CI data");
		assert.deepEqual(ghExec.calls[0], [
			"pr",
			"list",
			"--state",
			"open",
			"--json",
			"number,title",
			"--limit",
			"100",
		]);
	});

	it("listOpenPrs: both backends reject a saturated list", async () => {
		const pr = (number) => ({
			number,
			title: `PR ${number}`,
		});
		const ghRows = Array.from({ length: 100 }, (_, i) => pr(i + 1));
		const restRows = Array.from({ length: 100 }, (_, i) => ({
			number: i + 1,
			title: `PR ${i + 1}`,
			head: { ref: `branch-${i + 1}`, sha: `sha-${i + 1}` },
		}));
		const ghExec = stubExecGh({ "pr list": JSON.stringify(ghRows) });
		const ghOps = createGitHubOps({ execGhImpl: ghExec });
		const httpOps = createGitHubOps({
			execGhImpl: stubExecGh({ "pr list": new Error("ENOENT") }),
			fetchImpl: stubPagedFetch([restRows, []]),
		});
		await Promise.all([
			assertListSaturation(ghOps.listOpenPrs(), "listOpenPrs", 100),
			assertListSaturation(httpOps.listOpenPrs(), "listOpenPrs", 100),
		]);
		assert.deepEqual(ghExec.calls[0].slice(-2), ["--limit", "100"]);
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

describe("createGitHubOps: designRecordEditInfo", () => {
	it("fetches via gh's graphql call and parses the response", async () => {
		const raw = {
			data: {
				node: {
					lastEditedAt: "2026-07-05T00:00:00Z",
				},
			},
		};
		const ghExec = stubExecGh({ "api graphql": JSON.stringify(raw) });
		const ops = createGitHubOps({ execGhImpl: ghExec });
		const result = await ops.designRecordEditInfo({
			nodeId: "IC_kwDOCommentNodeId",
		});
		assert.deepEqual(result, {
			status: "edited",
			editedAtIso: "2026-07-05T00:00:00Z",
		});
		assert.equal(ghExec.calls[0][0], "api");
		assert.equal(ghExec.calls[0][1], "graphql");
	});

	it("falls back to a direct GraphQL POST and returns the same shape", async () => {
		process.env.GH_TOKEN = "tok";
		try {
			const raw = {
				data: {
					node: {
						lastEditedAt: null,
					},
				},
			};
			const fetch = stubFetch(raw);
			const ops = createGitHubOps({
				execGhImpl: stubExecGh({ "api graphql": new Error("ENOENT") }),
				fetchImpl: fetch,
			});
			assert.deepEqual(
				await ops.designRecordEditInfo({ nodeId: "IC_kwDOCommentNodeId" }),
				{
					status: "unedited",
					editedAtIso: null,
				},
			);
			assert.equal(fetch.calls.length, 1);
			assert.match(fetch.calls[0].url, /\/graphql$/);
			assert.equal(fetch.calls[0].init.method, "POST");
			const body = JSON.parse(fetch.calls[0].init.body);
			assert.match(body.query, /lastEditedAt/);
			assert.deepEqual(body.variables, { nodeId: "IC_kwDOCommentNodeId" });
		} finally {
			delete process.env.GH_TOKEN;
		}
	});

	it("rejects a missing GraphQL issue shape explicitly", async () => {
		process.env.GH_TOKEN = "tok";
		try {
			const ops = createGitHubOps({
				execGhImpl: stubExecGh({ "api graphql": new Error("ENOENT") }),
				fetchImpl: stubFetch({ data: { node: null } }),
			});
			await assert.rejects(
				() => ops.designRecordEditInfo({ nodeId: "missing" }),
				/unexpected GraphQL response shape for design-record edit info/,
			);
		} finally {
			delete process.env.GH_TOKEN;
		}
	});

	it("rejects the same malformed comments shape explicitly in both backends", async () => {
		process.env.GH_TOKEN = "tok";
		try {
			const malformed = {
				data: {
					node: {},
				},
			};
			const ghOps = createGitHubOps({
				execGhImpl: stubExecGh({
					"api graphql": JSON.stringify(malformed),
				}),
			});
			const httpOps = createGitHubOps({
				execGhImpl: stubExecGh({ "api graphql": new Error("ENOENT") }),
				fetchImpl: stubFetch(malformed),
			});
			const errors = await Promise.all(
				[ghOps, httpOps].map(async (ops) => {
					try {
						await ops.designRecordEditInfo({ nodeId: "IC_kwDOCommentNodeId" });
						assert.fail("expected malformed response to be rejected");
					} catch (error) {
						return error;
					}
				}),
			);
			assert.equal(
				errors[0].message,
				"unexpected GraphQL response shape for design-record edit info",
			);
			assert.equal(errors[1].message, errors[0].message);
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
			() => ops.designRecordEditInfo({ nodeId: "IC_kwDOCommentNodeId" }),
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
	it("names the selected comment node ID as a GraphQL variable", () => {
		const args = buildDesignRecordEditQuery({ nodeId: "IC_kwDOCommentNodeId" });
		assert.deepEqual(args.slice(0, 2), ["api", "graphql"]);
		assert.ok(args.includes("nodeId=IC_kwDOCommentNodeId"));
		const queryArg = args[args.length - 1];
		assert.match(queryArg, /lastEditedAt/);
		assert.match(queryArg, /node\s*\(id:\s*\$nodeId\)/);
		assert.doesNotMatch(queryArg, /comments\s*\(/);
	});
});

describe("parseDesignRecordEditResponse", () => {
	it("classifies an edited selected comment", () => {
		const json = JSON.stringify({
			data: {
				node: {
					lastEditedAt: "2026-07-05T00:00:00Z",
				},
			},
		});
		assert.deepEqual(parseDesignRecordEditResponse(json), {
			status: "edited",
			editedAtIso: "2026-07-05T00:00:00Z",
		});
	});

	it("classifies an unedited selected comment", () => {
		assert.deepEqual(
			parseDesignRecordEditResponse(
				JSON.stringify({ data: { node: { lastEditedAt: null } } }),
			),
			{ status: "unedited", editedAtIso: null },
		);
	});

	it("throws on a response shape it does not recognize", () => {
		assert.throws(() => parseDesignRecordEditResponse(JSON.stringify({})));
	});
});

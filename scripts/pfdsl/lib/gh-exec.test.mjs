import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { planGhRestCall } from "./gh-compat.mjs";
import { execGh } from "./gh-exec.mjs";
import {
	assertFallbackPlansCoverShapes,
	discoverLiteralExecGhShapes,
	discoverProductionLiteralExecGhShapes,
} from "./gh-fallback-coverage.mjs";

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
			() =>
				execGh([
					"label",
					"list",
					"--json",
					"name,description",
					"--limit",
					"100",
				]),
			(e) => e.code === "ENOENT",
		);
	});

	it("rethrows the original ENOENT for an argv shape with no REST plan", async () => {
		process.env.GH_TOKEN = "tok";
		await assert.rejects(
			() => execGh(["repo", "view"]),
			(e) => e.code === "ENOENT",
		);
	});

	it("falls back to REST and returns gh-shaped JSON when a token is present", async () => {
		process.env.GH_TOKEN = "tok";
		globalThis.fetch = async () => ({
			ok: true,
			json: async () => [
				{
					name: "flow:managed",
					description: "tracked in .pfdsl/roadmap.pfdsl",
				},
			],
		});
		const out = await execGh([
			"label",
			"list",
			"--json",
			"name,description",
			"--limit",
			"100",
		]);
		assert.deepEqual(JSON.parse(out), [
			{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" },
		]);
	});

	// This whole path only runs where `gh` is absent (Claude Code Remote and
	// the like), so CI never executes it and only listLabels above was covered.
	// A property renamed between the argv plan and the REST call would surface
	// nowhere until someone hit it for real (#639).
	describe("every argv shape the scripts emit", () => {
		/** Records each fetch and answers with `body`. */
		function recordingFetch(body) {
			const calls = [];
			globalThis.fetch = async (url, init = {}) => {
				calls.push({ url: String(url), init });
				return {
					ok: true,
					status: 200,
					headers: { get: () => null },
					json: async () => body,
					text: async () => JSON.stringify(body),
				};
			};
			return calls;
		}

		beforeEach(() => {
			process.env.GH_TOKEN = "tok";
		});

		it("creates a label with its name, description and colour in the body", async () => {
			const calls = recordingFetch({});
			await execGh([
				"label",
				"create",
				"flow:exempt",
				"--description",
				"not tracked",
				"--color",
				"ededed",
			]);
			assert.equal(calls.length, 1);
			assert.match(calls[0].url, /\/labels$/);
			assert.equal(calls[0].init.method, "POST");
			assert.deepEqual(JSON.parse(calls[0].init.body), {
				name: "flow:exempt",
				description: "not tracked",
				color: "ededed",
			});
		});

		it("edits a label by name, sending only the new description", async () => {
			const calls = recordingFetch({});
			await execGh([
				"label",
				"edit",
				"flow:exempt",
				"--description",
				"reworded",
			]);
			assert.match(calls[0].url, /\/labels\/flow%3Aexempt$/);
			assert.equal(calls[0].init.method, "PATCH");
			assert.deepEqual(JSON.parse(calls[0].init.body), {
				description: "reworded",
			});
		});

		it("lists issues, normalized into the shape gh --json would print", async () => {
			recordingFetch([{ number: 1, title: "x", labels: [], state: "open" }]);
			const out = await execGh([
				"issue",
				"list",
				"--state",
				"open",
				"--json",
				"number,title,labels",
			]);
			const issues = JSON.parse(out);
			assert.equal(issues.length, 1);
			assert.equal(issues[0].number, 1);
			assert.equal(issues[0].labels.length, 0);
			// gh reports state in caps and carries stateReason; the REST payload
			// does neither, so the fallback has to add them.
			assert.equal(issues[0].state, "OPEN");
			assert.ok("stateReason" in issues[0]);
		});

		it("adds a label to an issue by number", async () => {
			const calls = recordingFetch({});
			await execGh(["issue", "edit", "612", "--add-label", "flow:exempt"]);
			assert.match(calls[0].url, /\/issues\/612\/labels$/);
			assert.equal(calls[0].init.method, "POST");
			assert.deepEqual(JSON.parse(calls[0].init.body), {
				labels: ["flow:exempt"],
			});
		});

		// `--json` alone: gh prints the object, so the fallback does too. This
		// used to assert the bare body, which is what gh prints for `--jq .body`
		// — the divergence that made the multi-field callers throw (#745).
		it("reads an issue as the JSON object gh would print", async () => {
			recordingFetch({ number: 612, body: "## 現象\n..." });
			assert.equal(
				await execGh(["issue", "view", "612", "--json", "body"]),
				JSON.stringify({ body: "## 現象\n..." }),
			);
		});

		it("reduces to the raw body for the --jq .body form", async () => {
			recordingFetch({ number: 612, body: "## 現象\n..." });
			assert.equal(
				await execGh([
					"issue",
					"view",
					"612",
					"--json",
					"body",
					"--jq",
					".body",
				]),
				"## 現象\n...",
			);
		});

		it("surfaces an unhandled op rather than silently doing nothing", async () => {
			// planGhRestCall only returns the ops above, so this is reached by
			// handing runGhRestPlan a plan it does not know — which is what a new
			// argv shape mapped without a matching case would look like.
			recordingFetch({});
			await assert.rejects(
				() => execGh(["repo", "view", "--json", "name"]),
				(e) => e.code === "ENOENT",
				"an argv shape with no plan keeps the original gh error",
			);
		});

		it("lists open PRs", async () => {
			recordingFetch([]);
			assert.deepEqual(
				JSON.parse(
					await execGh([
						"pr",
						"list",
						"--state",
						"open",
						"--json",
						"number,title",
					]),
				),
				[],
			);
		});
	});
});

describe("production fallback coverage discovery", () => {
	let originalPath;
	let originalGhToken;
	let originalFetch;
	let ghlessPath;

	beforeEach(() => {
		originalPath = process.env.PATH;
		originalGhToken = process.env.GH_TOKEN;
		originalFetch = globalThis.fetch;
		ghlessPath = ghlessPathWithGit();
		process.env.PATH = ghlessPath;
		process.env.GH_TOKEN = "tok";
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		if (originalGhToken === undefined) delete process.env.GH_TOKEN;
		else process.env.GH_TOKEN = originalGhToken;
		globalThis.fetch = originalFetch;
		rmSync(ghlessPath, { recursive: true, force: true });
	});

	it("keeps current-branch and numbered PR selectors as distinct identities", () => {
		const shapes = discoverLiteralExecGhShapes({
			sources: [
				{
					file: "synthetic-pr-selectors.mjs",
					text: [
						'await execGh(["pr", "view", "--json", "body"]);',
						'await execGh(["pr", "view", String(number), "--json", "body"]);',
					].join("\n"),
				},
			],
		});

		assert.equal(shapes.length, 2);
		assert.notEqual(shapes[0].identity, shapes[1].identity);
	});
	it("normalizes dynamic values while retaining injected call sites", () => {
		const shapes = discoverLiteralExecGhShapes({
			sources: [
				{
					file: "synthetic-steps.mjs",
					text: [
						"const run = (execGh, args) => execGh(args);",
						'await execGh(["issue", "view", String(number), "--json", "body"]);',
						'await execGh(["issue", "view", String(issueNumber), "--json", "body"]);',
					].join("\n"),
				},
			],
		});

		assert.equal(shapes.length, 2);
		assert.equal(shapes[0].args[2], "612");
		assert.equal(shapes[0].identity, shapes[1].identity);
	});

	it("fails when a newly added literal production shape has no REST plan", () => {
		const shapes = discoverLiteralExecGhShapes({
			sources: [
				{
					file: "synthetic-production.mjs",
					text: 'await execGh(["repo", "view"]);',
				},
			],
		});

		assert.throws(
			() => assertFallbackPlansCoverShapes(shapes),
			/has no REST fallback plan/,
		);
	});

	it("executes every discovered production shape through the REST fallback", async () => {
		const shapes = discoverProductionLiteralExecGhShapes(
			resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
		);
		assert.ok(shapes.length > 0);
		assertFallbackPlansCoverShapes(shapes);

		const uniqueShapes = [
			...new Map(shapes.map((shape) => [shape.identity, shape])).values(),
		];
		for (const shape of uniqueShapes) {
			const plan = planGhRestCall(shape.args);
			globalThis.fetch = async (url) => {
				let body;
				// closingIssuesReferences has no REST endpoint — the fallback asks
				// GraphQL for it (#1043), so the stub answers that endpoint too.
				if (url.endsWith("/graphql"))
					body = {
						data: {
							repository: {
								pullRequest: {
									closingIssuesReferences: {
										nodes: [{ number: 612 }],
										pageInfo: { hasNextPage: false, endCursor: null },
									},
								},
							},
						},
					};
				else if (url.includes("/comments?")) body = [];
				else if (url.includes("/check-runs?")) body = { check_runs: [] };
				else if (plan.op === "listLabels")
					body = [{ name: "flow:exempt", description: "not tracked" }];
				else if (plan.op === "listIssues")
					body = [
						{
							number: 612,
							title: "representative",
							state: "open",
							labels: [],
							updated_at: "2026-01-01T00:00:00Z",
						},
					];
				else if (/\/pulls\/\d+$/.test(url))
					body = {
						number: 612,
						body: "Closes #612",
						state: "open",
						title: "representative",
						html_url: "https://example.invalid/pr/612",
					};
				else if (
					plan.op === "listOpenPrsWithCi" ||
					plan.op === "viewCurrentPr" ||
					url.includes("/pulls/")
				)
					body = [
						{
							number: 612,
							body: "",
							head: { ref: "representative" },
							sha: "representative-sha",
							state: "open",
							title: "representative",
							html_url: "https://example.invalid/pr/612",
						},
					];
				else
					body = {
						number: 612,
						body: "",
						state: "open",
						state_reason: null,
						labels: [],
						user: { login: "representative" },
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
						title: "representative",
						html_url: "https://example.invalid/issue/612",
					};
				return {
					ok: true,
					status: 200,
					headers: { get: () => null },
					json: async () => body,
					text: async () => JSON.stringify(body),
				};
			};

			const out = await execGh(shape.args);
			if (plan.op.startsWith("list") || plan.op.startsWith("view")) {
				const value = JSON.parse(out);
				if (plan.op === "listLabels")
					assert.deepEqual(value[0], {
						name: "flow:exempt",
						description: "not tracked",
					});
				if (plan.op === "listIssues") {
					assert.equal(value[0].number, 612);
					assert.ok("state" in value[0]);
					assert.ok("stateReason" in value[0]);
				}
				if (plan.op === "listOpenPrsWithCi") {
					assert.equal(value[0].number, 612);
					assert.equal(value[0].headRefName, "representative");
					assert.ok(Array.isArray(value[0].statusCheckRollup));
				}
				if (
					plan.op === "viewIssue" ||
					plan.op === "viewCurrentPr" ||
					plan.op === "viewPr"
				)
					for (const field of plan.fields)
						assert.ok(field in value, `${shape.file}:${shape.line} ${field}`);
				if (plan.op === "viewPr") {
					if (plan.fields.includes("body"))
						assert.equal(
							value.body,
							"Closes #612",
							`${shape.file}:${shape.line}`,
						);
					if (plan.fields.includes("closingIssuesReferences"))
						assert.deepEqual(
							value.closingIssuesReferences,
							[{ number: 612 }],
							`${shape.file}:${shape.line}`,
						);
				}
			}
		}
	});
});

// planGhRestCall (gh-compat.mjs) decides which ops exist; runGhRestPlan
// (gh-exec.mjs) implements them. They are in different files, and the
// mismatch case — an op planned but not implemented — reaches only the
// default branch, which no argv can produce today. Comparing the two op sets
// is what actually holds them together (#639).
describe("the REST op sets on both sides of the fallback", () => {
	const here = dirname(fileURLToPath(import.meta.url));
	const read = (name) => readFileSync(resolve(here, name), "utf-8");

	/** Op names in `{ op: "name"` literals. */
	const planned = [...read("gh-compat.mjs").matchAll(/\bop:\s*"([^"]+)"/g)].map(
		(m) => m[1],
	);
	/** Op names in `case "name":` labels. */
	const implemented = [
		...read("gh-exec.mjs").matchAll(/case\s+"([^"]+)":/g),
	].map((m) => m[1]);

	it("plans at least one op, so the extraction still finds something", () => {
		assert.ok(planned.length > 0);
		assert.ok(implemented.length > 0);
	});

	it("implements exactly the ops it plans", () => {
		assert.deepEqual([...implemented].sort(), [...planned].sort());
	});
});

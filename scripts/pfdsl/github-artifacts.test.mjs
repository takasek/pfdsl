import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitHubOps } from "./lib/github-ops.mjs";

test("artifact gh status uses only the trailing response status", async () => {
	const saved = process.env.GH_REPO;
	process.env.GH_REPO = "github.com/o/r";
	try {
		for (const [stderr, expected] of [
			["gh: server mentions (HTTP 403) (HTTP 500)\n", 500],
			["gh: mentions (HTTP 403) but no trailing response", undefined],
			["gh: denied (HTTP 403)\n", 403],
		]) {
			const ops = createGitHubOps({
				execGhImpl: async () => {
					throw Object.assign(new Error("failed"), { stderr });
				},
			});
			await assert.rejects(
				ops.updateArtifact({ issue: 7, artifact: 1, body: "x" }),
				(error) => error.httpStatus === expected,
			);
		}
	} finally {
		if (saved === undefined) delete process.env.GH_REPO;
		else process.env.GH_REPO = saved;
	}
});

test("artifact GET requests a large buffer without changing ordinary gh operations", async () => {
	const saved = process.env.GH_REPO;
	process.env.GH_REPO = "github.com/o/r";
	try {
		const seen = [];
		const ops = createGitHubOps({
			execGhImpl: async (args, opts) => {
				seen.push({ args, opts });
				return args[0] === "api"
					? JSON.stringify({ artifact: { number: 1 }, versions: [] })
					: "[]";
			},
		});
		await ops.getArtifact({ issue: 7, artifact: 1 });
		await ops.listLabels();
		assert.equal(seen[0].opts.maxBuffer, 256 * 1024 * 1024);
		assert.equal(seen[1].opts.maxBuffer, undefined);
	} finally {
		if (saved === undefined) delete process.env.GH_REPO;
		else process.env.GH_REPO = saved;
	}
});

test("artifact named operations use gh api and HTTP with identical results and payloads", async () => {
	const saved = {
		GH_REPO: process.env.GH_REPO,
		GH_TOKEN: process.env.GH_TOKEN,
	};
	process.env.GH_REPO = "github.com/o/r";
	process.env.GH_TOKEN = "fixture-token";
	try {
		const artifact = { number: 3, type: "generic", name: "source" };
		const versioned = {
			artifact,
			versions: [
				{
					version: 2,
					name: "source",
					body: "pfd",
					created_at: "now",
					actor: {},
				},
				{ version: 1, body: "old" },
			],
		};
		for (const [method, args, response, verb] of [
			["listArtifacts", { issue: 7 }, [artifact], "GET"],
			["getArtifact", { issue: 7, artifact: 3 }, versioned, "GET"],
			[
				"createArtifact",
				{ issue: 7, type: "generic", name: "source", body: "=true\n`$()" },
				artifact,
				"POST",
			],
			[
				"updateArtifact",
				{ issue: 7, artifact: 3, body: "new" },
				artifact,
				"PATCH",
			],
		]) {
			const ghCalls = [];
			const ghInputs = [];
			const httpCalls = [];
			const gh = createGitHubOps({
				execGhImpl: async (argv, opts) => {
					ghCalls.push(argv);
					ghInputs.push(opts?.input);
					return JSON.stringify(
						method === "listArtifacts" ? [response] : response,
					);
				},
			});
			const http = createGitHubOps({
				execGhImpl: async () => {
					throw Object.assign(new Error("gh absent"), { code: "ENOENT" });
				},
				fetchImpl: async (url, init) => {
					httpCalls.push({ url, init });
					return { ok: true, json: async () => response };
				},
			});
			assert.deepEqual(await gh[method](args), response);
			assert.deepEqual(await http[method](args), response);
			assert.equal(ghCalls[0][0], "api");
			assert.ok(
				ghCalls[0].includes(
					`/repos/o/r/issues/7/artifacts${args.artifact ? "/3" : ""}`,
				),
			);
			assert.ok(ghCalls[0].includes(verb));
			assert.match(
				httpCalls[0].url,
				/api.github.com\/repos\/o\/r\/issues\/7\/artifacts/,
			);
			assert.equal(httpCalls[0].init.method ?? "GET", verb);
			if (args.body) {
				assert.equal(JSON.parse(httpCalls[0].init.body).body, args.body);
				// The body travels on stdin as JSON: argv has an OS size limit
				// (E2BIG near 128 KiB per argument on Linux).
				assert.equal(ghCalls[0][ghCalls[0].indexOf("--input") + 1], "-");
				assert.ok(!ghCalls[0].some((arg) => arg.includes(args.body)));
				const sent = JSON.parse(ghInputs[0]);
				assert.equal(sent.body, args.body);
				if (args.type) assert.equal(sent.type, args.type);
				if (args.name) assert.equal(sent.name, args.name);
			} else assert.equal(ghInputs[0], undefined);
		}
		for (const status of [403, 500]) {
			const gh = createGitHubOps({
				execGhImpl: async () => {
					throw Object.assign(new Error("request failed"), {
						stderr: `gh: rejected (HTTP ${status})`,
					});
				},
			});
			const http = createGitHubOps({
				execGhImpl: async () => {
					throw Object.assign(new Error("missing gh"), { code: "ENOENT" });
				},
				fetchImpl: async () => ({
					ok: false,
					status,
					text: async () => "rejected",
				}),
			});
			for (const ops of [gh, http])
				await assert.rejects(
					ops.updateArtifact({ issue: 7, artifact: 3, body: "new" }),
					(error) => error.httpStatus === status,
				);
		}
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

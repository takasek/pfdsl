import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
	createIssueArtifact,
	updateIssueArtifact,
} from "./lib/github-rest.mjs";
import { createIssuePfd } from "./lib/issue-pfd.mjs";
import {
	createIssuePfdCli,
	IssuePfdEnvironmentError,
} from "./lib/issue-pfd-cli.mjs";
import { proxyAwareFetch } from "./lib/proxy-fetch.mjs";

function cliFixture(t, script, options = {}) {
	const dir = mkdtempSync(resolve(".issue-pfd-boundary-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = resolve(dir, "cli.cjs");
	writeFileSync(
		file,
		`if (process.argv.includes('--help')) console.log('--reference-context'); else if (process.argv.includes('--version')) console.log('fixture'); else { ${script} }`,
	);
	mkdirSync(resolve(dir, "root"));
	return createIssuePfdCli({
		root: resolve(dir, "root"),
		temporaryRoot: dir,
		env: { ...process.env, PFDSL_CLI: file },
		...options,
	});
}

for (const command of ["check", "render"]) {
	test(`${command} signal is an environment failure, not a model failure`, async (t) => {
		const cli = cliFixture(t, "process.kill(process.pid, 'SIGKILL');");
		await assert.rejects(
			cli({ command, model: "a >> p -> b", context: {} }),
			(error) =>
				error instanceof IssuePfdEnvironmentError &&
				/SIGKILL/.test(error.message),
		);
	});
}

test("missing child exit status is an environment failure", async (t) => {
	const cli = cliFixture(t, "", {
		spawn: (_exe, args) =>
			args.includes("--help")
				? { status: 0, stdout: "--reference-context" }
				: args.includes("--version")
					? { status: 0, stdout: "fixture" }
					: { status: null, stdout: "", stderr: "" },
	});
	await assert.rejects(
		cli({ command: "render", model: "a >> p -> b", context: {} }),
		IssuePfdEnvironmentError,
	);
});

test("child error preserves an accompanying termination signal", async (t) => {
	const cli = cliFixture(t, "", {
		spawn: (_exe, args) =>
			args.includes("--help")
				? { status: 0, stdout: "--reference-context" }
				: args.includes("--version")
					? { status: 0, stdout: "fixture" }
					: {
							status: null,
							signal: "SIGKILL",
							error: new Error("child failed"),
						},
	});
	await assert.rejects(
		cli({ command: "render", model: "a >> p -> b", context: {} }),
		(error) =>
			error instanceof IssuePfdEnvironmentError &&
			/SIGKILL/.test(error.message),
	);
});

test("render overflow identifies output target and buffer limit", async (t) => {
	const cli = cliFixture(
		t,
		"process.stdout.write('x'.repeat(33 * 1024 * 1024));",
	);
	await assert.rejects(
		cli({
			command: "render",
			model: "a >> p -> b",
			context: {},
			out: "requested.svg",
		}),
		(error) =>
			error instanceof IssuePfdEnvironmentError &&
			/requested.svg/.test(error.message) &&
			/33554432/.test(error.message),
	);
});

test("relative PFDSL_CLI resolves once before changing child cwd", async (t) => {
	const dir = mkdtempSync(resolve(".issue-pfd-relative-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const file = resolve(dir, "cli.cjs");
	writeFileSync(
		file,
		"console.log(process.argv.includes('--help') ? '--reference-context' : 'OK');",
	);
	const cli = createIssuePfdCli({
		root: dir,
		temporaryRoot: dir,
		env: { ...process.env, PFDSL_CLI: relative(process.cwd(), file) },
	});
	assert.equal(
		(await cli({ command: "check", model: "a >> p -> b", context: {} }))
			.exitCode,
		0,
	);
});

// Real fetch/Response machinery; this dispatcher never opens a socket.
function offlineFetch(reply, calls, baseFetch = fetch) {
	return (url, init) =>
		baseFetch(url, {
			...init,
			dispatcher: {
				dispatch(options, handler) {
					calls.push({ method: options.method, path: options.path });
					queueMicrotask(() => {
						const response = reply(options);
						const controller = {
							resume() {},
							pause() {},
							abort() {},
							rawHeaders: response.headers ?? [],
						};
						const modern = typeof handler.onRequestStart === "function";
						if (modern) {
							handler.onRequestStart(controller);
							const headers = {};
							for (let i = 0; i < controller.rawHeaders.length; i += 2)
								headers[String(controller.rawHeaders[i])] = String(
									controller.rawHeaders[i + 1],
								);
							handler.onResponseStart(
								controller,
								response.status,
								headers,
								"fixture",
							);
						} else {
							handler.onConnect(() => {});
							handler.onHeaders(
								response.status,
								controller.rawHeaders,
								() => {},
								"fixture",
							);
						}
						if (response.broken)
							setImmediate(() =>
								modern
									? handler.onResponseError(
											controller,
											new Error("body disconnected"),
										)
									: handler.onError(new Error("body disconnected")),
							);
						else if (modern) {
							handler.onResponseData(
								controller,
								Buffer.from(response.body ?? "[]"),
							);
							handler.onResponseEnd(controller);
						} else {
							handler.onData(Buffer.from(response.body ?? "[]"));
							handler.onComplete([]);
						}
					});
					return true;
				},
			},
		});
}

for (const method of ["POST", "PATCH"]) {
	for (const status of [301, 302, 307, 308])
		test(`${method} does not follow HTTP ${status}`, async () => {
			const calls = [];
			const transport = offlineFetch(
				(options) =>
					options.path.endsWith("/moved")
						? { status: 200, body: "[]" }
						: {
								status,
								headers: [
									Buffer.from("location"),
									Buffer.from("https://api.github.com/moved"),
								],
							},
				calls,
			);
			const operation =
				method === "POST"
					? createIssueArtifact("o", "r", "token", 7, { body: "x" }, transport)
					: updateIssueArtifact(
							"o",
							"r",
							"token",
							7,
							1,
							{ body: "x" },
							transport,
						);
			await assert.rejects(operation, (error) => error.httpStatus === status);
			assert.deepEqual(
				calls.map((x) => x.method),
				[method],
			);
		});
}

for (const status of [422, 429, 500])
	test(`HTTP ${status} survives a disconnected error body`, async () => {
		const transport = offlineFetch(() => ({ status, broken: true }), []);
		await assert.rejects(
			updateIssueArtifact("o", "r", "token", 7, 1, { body: "x" }, transport),
			(error) => error.httpStatus === status,
		);
	});

for (const number of [undefined, 0, -1, "1", 1.5, Number.MAX_SAFE_INTEGER + 1])
	test(`HTTP create rejects artifact number ${number}`, async () => {
		await assert.rejects(
			createIssueArtifact(
				"o",
				"r",
				"token",
				7,
				{ body: "x" },
				offlineFetch(
					() => ({ status: 201, body: JSON.stringify({ number }) }),
					[],
				),
			),
			/artifact.*number/i,
		);
	});

for (const command of ["check", "render"])
	test(`signal during publication ${command} cannot replace the diagram`, async (t) => {
		const cli = cliFixture(
			t,
			`if(process.argv[2] === '${command}') process.kill(process.pid,'SIGKILL'); else console.log('OK');`,
		);
		const writes = [];
		const body =
			"<!-- pfdsl:issue-pfd source id=12345678-1234-4234-8234-123456789abc op=12345678-1234-4234-8234-123456789abc base=0 -->\n```pfdsl\na >> p -> b\n```\n";
		const runner = createIssuePfd({
			root: process.cwd(),
			repository: () => ({ host: "github.com", owner: "o", repo: "r" }),
			cli,
			github: {
				getArtifact: async () => ({
					artifact: { number: 1, type: "generic" },
					versions: [{ version: 1, body }],
				}),
				listArtifacts: async () => [],
				createArtifact: async (data) => {
					writes.push(data);
					return { number: 2 };
				},
				updateArtifact: async (data) => writes.push(data),
			},
		});
		await assert.rejects(
			runner.run({
				command: "publish-diagram",
				issue: 7,
				artifact: 1,
				write: true,
			}),
			(error) =>
				error instanceof IssuePfdEnvironmentError &&
				/SIGKILL/.test(error.message),
		);
		assert.deepEqual(writes, []);
	});

for (const status of [301, 422])
	test(`proxy worker preserves redirect policy and HTTP ${status} after headers`, {
		skip: !process.allowedNodeEnvironmentFlags.has("--use-env-proxy"),
	}, async (t) => {
		const dir = mkdtempSync(resolve(".issue-pfd-worker-"));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const file = resolve(dir, "preload.mjs");
		writeFileSync(
			file,
			`const offlineFetch=${offlineFetch.toString()}; const original=globalThis.fetch; globalThis.fetch=offlineFetch(options=>options.path.endsWith('/moved')?{status:201,body:'{"number":2}'}:{status:${status},${status === 301 ? "headers:[Buffer.from('location'),Buffer.from('https://api.github.com/moved')]" : "broken:true"}},[],original);`,
		);
		const saved = {
			HTTPS_PROXY: process.env.HTTPS_PROXY,
			NODE_OPTIONS: process.env.NODE_OPTIONS,
		};
		process.env.HTTPS_PROXY = "http://offline.invalid:1";
		process.env.NODE_OPTIONS = `--import=${pathToFileURL(file).href}`;
		try {
			await assert.rejects(
				createIssueArtifact(
					"o",
					"r",
					"token",
					7,
					{ body: "x" },
					proxyAwareFetch,
				),
				(error) => error.httpStatus === status,
			);
		} finally {
			for (const [key, value] of Object.entries(saved))
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
		}
	});

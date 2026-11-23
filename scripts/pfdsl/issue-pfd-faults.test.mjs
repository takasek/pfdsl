import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { GitHubUnavailableError } from "./lib/github-ops.mjs";

const api = await import("./lib/issue-pfd.mjs");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const body = (model = "a >> p -> b\n") =>
	`<!-- pfdsl:issue-pfd source id=${id(1)} op=${id(2)} base=0 -->\n\n\`\`\`pfdsl\n${model}\`\`\`\n`;
const visibleSvg = (html) => {
	const visible = html
		?.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
		.replace(
			/<(template|script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
			"",
		);
	const matches = [
		...(visible?.matchAll(/<svg\b[^>]*\/>|<svg\b[\s\S]*?<\/svg\s*>/g) ?? []),
	];
	return matches.length === 1 ? matches[0][0] : null;
};

function memoryFs() {
	const files = new Map();
	const modes = new Map();
	const dirs = new Set(["/", "/fault"]);
	const writes = [];
	const aliases = new Map();
	function detach(path) {
		aliases.get(path)?.delete(path);
		aliases.delete(path);
	}
	let fault,
		faultHits = 0,
		crashed = false;
	let mutationObserver;
	function mutate(name, args, apply) {
		const event = {
			name,
			path: resolve(args[0]),
			value: args[1],
			options: args[2],
		};
		writes.push(event);
		if (crashed) throw new Error("process interrupted");
		mutationObserver?.(event);
		const hit = fault?.(event, writes.length);
		if (hit === "before" || hit === "crash") faultHits++;
		if (hit === "before") throw new Error("local write failed");
		const result = apply();
		if (hit === "crash") {
			crashed = true;
			throw new Error("process interrupted");
		}
		return result;
	}
	const fs = {
		linkSync(...args) {
			return mutate("link", args, () => {
				const from = resolve(args[0]),
					to = resolve(args[1]);
				if (files.has(to))
					throw Object.assign(new Error("exists"), { code: "EEXIST" });
				const text = fs.readFileSync(from),
					group = aliases.get(from) ?? new Set([from]);
				group.add(to);
				aliases.set(from, group);
				aliases.set(to, group);
				files.set(to, text);
				modes.set(to, modes.get(from) ?? 0o644);
			});
		},
		statSync(p) {
			if (!files.has(resolve(p)))
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			return { mode: modes.get(resolve(p)) ?? 0o644, isFile: () => true };
		},
		lstatSync(p) {
			return fs.statSync(p);
		},
		chmodSync(...args) {
			return mutate("chmod", args, () => modes.set(resolve(args[0]), args[1]));
		},
		existsSync: (p) => files.has(resolve(p)) || dirs.has(resolve(p)),
		readFileSync(p) {
			if (!files.has(resolve(p)))
				throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
			return files.get(resolve(p));
		},
		readdirSync(p) {
			return [
				...new Set(
					[...files.keys(), ...dirs]
						.filter((x) => x !== resolve(p) && dirname(x) === resolve(p))
						.map((x) => x.slice(resolve(p).length + 1)),
				),
			];
		},
		mkdirSync(...args) {
			return mutate("mkdir", args, () => {
				dirs.add(resolve(args[0]));
			});
		},
		writeFileSync(...args) {
			return mutate("write", args, () => {
				const p = resolve(args[0]);
				if (args[2]?.flag === "wx" && files.has(p))
					throw Object.assign(new Error("exists"), { code: "EEXIST" });
				for (const target of aliases.get(p) ?? [p])
					files.set(target, String(args[1]));
				if (!modes.has(p)) modes.set(p, (args[2]?.mode ?? 0o666) & ~0o022);
			});
		},
		renameSync(...args) {
			return mutate("rename", args, () => {
				detach(resolve(args[1]));
				files.set(resolve(args[1]), fs.readFileSync(args[0]));
				modes.set(resolve(args[1]), modes.get(resolve(args[0])) ?? 0o644);
				files.delete(resolve(args[0]));
				const group = aliases.get(resolve(args[0]));
				if (group) {
					group.delete(resolve(args[0]));
					group.add(resolve(args[1]));
					aliases.set(resolve(args[1]), group);
					aliases.delete(resolve(args[0]));
				}
				modes.delete(resolve(args[0]));
			});
		},
		rmSync(...args) {
			return mutate("rm", args, () => {
				detach(resolve(args[0]));
				files.delete(resolve(args[0]));
				modes.delete(resolve(args[0]));
			});
		},
	};
	return {
		fs,
		files,
		modes,
		writes,
		aliases,
		observeMutation(fn) {
			mutationObserver = fn;
		},
		get faultHits() {
			return faultHits;
		},
		get interrupted() {
			return crashed;
		},
		arm(fn) {
			fault = fn;
			writes.length = 0;
			faultHits = 0;
		},
		recover() {
			fault = undefined;
			crashed = false;
			faultHits = 0;
			for (const p of files.keys())
				if (p.endsWith(".issue-pfd.lock")) files.delete(p);
		},
	};
}

function fixture() {
	const local = memoryFs();
	const invocations = [],
		origins = new Map(),
		intents = new Map(),
		expectedDefaults = new Map();
	const stateCache = new Map();
	const protectedFiles = new Map();
	let active, observer;
	const records = new Map([
		[
			1,
			{
				artifact: { number: 1, type: "generic" },
				versions: [{ version: 1, body: body() }],
			},
		],
	]);
	const calls = [],
		pending = [];
	let rule,
		tick = 0,
		seq = 10,
		unavailableRead = false;
	function add(n, text) {
		const r = records.get(n);
		if (r.versions[0]?.body !== text)
			r.versions.unshift({
				version: (r.versions[0]?.version ?? 0) + 1,
				body: text,
			});
	}
	async function call(method, args, action) {
		if (method === "POST" && args.type === "generic") {
			const sourceId = args.body.match(/source id=([a-f0-9-]+)/)?.[1];
			assert.ok(
				![...records.values()].some(
					(record) =>
						record.artifact.type === "generic" &&
						record.versions.some((version) =>
							version.body.includes(`source id=${sourceId} `),
						),
				),
				"I16 source POST cannot duplicate an existing sourceId after backup recovery",
			);
		}
		if (active) {
			assertBase(f, active.work);
			if (
				method === "PATCH" &&
				records.get(args.artifact)?.artifact.type === "embedded_html" &&
				active.expectedDiagram === undefined
			) {
				const candidates = [...records.values()].filter(
					(r) => r.artifact.type === "embedded_html",
				);
				if (candidates.length === 1)
					active.expectedDiagram = candidates[0].artifact.number;
			}
			if (
				["POST", "PATCH"].includes(method) &&
				(args.type === "generic" ||
					records.get(args.artifact)?.artifact.type === "generic")
			)
				assert.ok(
					!active.retired,
					"I10 an applied restore base retires publication even without a retired flag",
				);
		}
		tick++;
		const entry = { method, ...args, tick, invocation: active };
		calls.push(entry);
		observer?.(entry);
		let mode = rule?.(entry);
		if (unavailableRead && method === "GET") {
			unavailableRead = false;
			mode = "unavailable-before";
		}
		entry.fault = mode;
		const error = () =>
			mode?.includes("unavailable")
				? new GitHubUnavailableError(method)
				: Object.assign(
						new Error(`injected ${mode}`),
						mode === "4xx" ? { httpStatus: 422 } : {},
					);
		let result;
		try {
			if (["4xx", "network", "unavailable-before"].includes(mode))
				throw error();
			if (mode?.startsWith("delay")) {
				pending.push({ due: tick + Number(mode.slice(5)), action });
				throw error();
			}
			result = action();
			entry.response = structuredClone(result);
			if (method === "POST") entry.destination = result.number;
			if (mode === "unavailable-after" && ["POST", "PATCH"].includes(method))
				unavailableRead = true;
			else if (["after", "unavailable-after"].includes(mode)) throw error();
			return structuredClone(result);
		} finally {
			// Apply AFTER returning a read snapshot, so recovery can miss an accepted write.
			for (const p of [...pending])
				if (p.due <= tick) {
					pending.splice(pending.indexOf(p), 1);
					p.action();
				}
		}
	}
	const github = {
		listArtifacts: (args) =>
			call("LIST", args, () => [...records.values()].map((r) => r.artifact)),
		getArtifact: (args) => call("GET", args, () => records.get(args.artifact)),
		createArtifact: (args) =>
			call("POST", args, () => {
				const n = Math.max(...records.keys(), 0) + 1;
				const artifact = { number: n, type: args.type };
				records.set(n, {
					artifact,
					versions: [{ version: 1, body: args.body }],
				});
				return artifact;
			}),
		updateArtifact: (args) =>
			call("PATCH", args, () => {
				add(args.artifact, args.body);
				return records.get(args.artifact).artifact;
			}),
	};
	const cli = async () => {
		assertBase(f, active?.work);
		return {
			exitCode: 0,
			stdout: "<svg></svg>",
			stderr: "",
			cliVersion: "test",
		};
	};
	const repo = { host: "github.com", owner: "o", repo: "r" };
	const runner = api.createIssuePfd({
		github,
		fs: {
			...local.fs,
			readFileSync(path, encoding) {
				const value = local.fs.readFileSync(path);
				return encoding === undefined ? Buffer.from(value) : value;
			},
			writeFileSync(path, value, ...args) {
				if (String(value).startsWith("{")) {
					const state = JSON.parse(value);
					if (state.schema === 2)
						for (const op of state.operations)
							if (op.body !== undefined && !intents.has(op.id)) {
								intents.set(op.id, op.body);
								origins.set(op.id, active);
							}
				}
				return local.fs.writeFileSync(path, value, ...args);
			},
		},
		root: "/fault",
		repository: () => repo,
		cli,
		uuid: () => id(seq++),
		now: () => "2026-11-19T00:00:00Z",
	});
	const f = {
		...local,
		records,
		calls,
		invocations,
		protectedFiles,
		observe(fn) {
			observer = fn;
		},
		protect(path, text) {
			local.files.set(path, text);
			protectedFiles.set(path, text);
		},
		backup() {
			return { files: new Map(local.files), modes: new Map(local.modes) };
		},
		restoreBackup(snapshot) {
			local.files.clear();
			local.modes.clear();
			local.aliases.clear();
			expectedDefaults.clear();
			stateCache.clear();
			for (const [p, value] of snapshot.files) local.files.set(p, value);
			for (const [p, value] of snapshot.modes) local.modes.set(p, value);
		},
		origins,
		intents,
		expectedDefaults,
		add,
		cli,
		repo,
		rule(fn) {
			rule = fn;
		},
		async drain() {
			for (let i = 0; i < 3; i++)
				await github.getArtifact({ issue: 7, artifact: 1 });
		},
		state(dir = "A") {
			return JSON.parse(local.fs.readFileSync(`/fault/${dir}/issue-pfd.json`));
		},
		viewState(dir = "A") {
			const raw = local.fs.readFileSync(`/fault/${dir}/issue-pfd.json`);
			if (stateCache.get(dir)?.raw !== raw)
				stateCache.set(dir, { raw, state: JSON.parse(raw) });
			return stateCache.get(dir).state;
		},
		edit(text = "b >> p -> c\n", dir = "A") {
			local.files.set(`/fault/${dir}/model.pfdsl`, text);
		},
		async run(command, opts = {}) {
			const { work = "A", ...rest } = opts;
			const options = {
				command,
				issue: 7,
				artifact: 1,
				dir: `/fault/${work}`,
				write: ["publish", "restore", "publish-diagram", "create"].includes(
					command,
				),
				...rest,
			};
			const prior = local.files.has(`/fault/${work}/issue-pfd.json`)
				? f.viewState(work)
				: null;
			const candidates = [...records.values()]
				.filter((r) => r.artifact.type === "embedded_html")
				.map((r) => r.artifact.number);
			const invocation = {
				command: options.command,
				work,
				calls: calls.length,
				writes: local.writes.length,
				locked: local.files.has(`/fault/${work}/.issue-pfd.lock`),
				model: local.files.get(`/fault/${work}/model.pfdsl`),
				outputMode:
					options.out && local.files.has(options.out)
						? local.fs.statSync(options.out).mode & 0o7777
						: 0o600,
				expectedDiagram:
					options.diagram ??
					(["publish", "restore"].includes(options.command)
						? (expectedDefaults.get(work) ?? prior?.diagram)
						: undefined) ??
					(candidates.length === 1 ? candidates[0] : undefined),
				retired:
					prior?.retired ||
					prior?.operations.some(
						(op) =>
							op.stage === "source" &&
							op.kind === "restore" &&
							op.status === "applied" &&
							op.artifact === prior.artifact &&
							op.version === prior.base?.version,
					),
			};
			invocations.push(invocation);
			active = invocation;
			let result, failure;
			try {
				result = await runner.run(options);
				return result;
			} catch (error) {
				failure = error;
				throw error;
			} finally {
				active = undefined;
				for (const [path, text] of protectedFiles)
					assert.equal(
						local.files.get(path),
						text,
						"I14 commands never replace or delete user-owned files or linked draft bytes",
					);
				if (local.files.has(`/fault/${work}/issue-pfd.json`)) {
					const state = f.viewState(work);
					for (const op of state.operations)
						if (!origins.has(op.id)) origins.set(op.id, invocation);
					const applied = state.operations.filter(
						(op) =>
							op.stage === "diagram" &&
							op.status === "applied" &&
							prior?.operations.find((old) => old.id === op.id)?.status !==
								"applied",
					);
					if (applied.length)
						expectedDefaults.set(work, applied.at(-1).artifact);
					const commandCalls = calls.slice(invocation.calls);
					const sourceReads = commandCalls.filter(
						(c) => c.method === "GET" && c.artifact === prior?.artifact,
					);
					if (
						options.write &&
						prior?.base &&
						!local.interrupted &&
						local.faultHits === 0 &&
						!invocation.locked &&
						failure?.exitCode !== 3 &&
						["host", "owner", "repo"].every(
							(key) => prior[key] === repo[key],
						) &&
						!sourceReads.some(
							(c) =>
								c.fault ||
								c.response?.versions[0].version !== prior.base.version ||
								hash(c.response?.versions[0].body.replaceAll("\r\n", "\n")) !==
									prior.base.sourceBodySha256,
						) &&
						prior.operations.some(
							(op) =>
								op.stage === "diagram" &&
								["sent", "unknown"].includes(op.status),
						) &&
						["publish", "restore"].includes(options.command) &&
						!invocation.retired &&
						!prior?.operations.some(
							(op) =>
								op.stage === "source" &&
								["sent", "unknown"].includes(op.status) &&
								!op.abandoned,
						) &&
						(options.command === "restore" ||
							invocation.model !== api.parseSource(prior.base.body).model)
					)
						assert.ok(
							calls
								.slice(invocation.calls)
								.some(
									(c) => c.method === "PATCH" && c.artifact === state.artifact,
								),
							"I11 ambiguous diagram unknown must not block source publication",
						);
					if (!local.interrupted && local.faultHits === 0) {
						assertBase(f, work);
						assertDefaults(f);
					}
					for (const op of applied) {
						const html = records
							.get(op.artifact)
							?.versions.find((v) => v.version === op.version)?.body;
						const stamp = api.readStamp(html);
						if (stamp?.result === "rendered")
							assert.ok(
								visibleSvg(html) !== null &&
									hash(visibleSvg(html)) === stamp.svgSha256,
								"I12 applied diagram requires an SVG outside HTML comments",
							);
					}
				}
				if (result?.classification === "current") {
					const html = calls
						.slice(invocation.calls)
						.findLast(
							(c) => c.method === "GET" && c.artifact === result.diagram,
						)?.response?.versions[0].body;
					assert.ok(
						visibleSvg(html) !== null &&
							hash(visibleSvg(html)) === api.readStamp(html).svgSha256,
						"I12 current requires an SVG outside HTML comments",
					);
				}
				if (result?.skipped === "current diagram")
					assert.ok(
						visibleSvg(records.get(result.diagram)?.versions[0].body) !==
							null &&
							hash(
								visibleSvg(records.get(result.diagram)?.versions[0].body),
							) ===
								api.readStamp(records.get(result.diagram)?.versions[0].body)
									.svgSha256,
						"I12 reused diagram requires an SVG outside HTML comments",
					);
				if (options.command === "show" && options.out) {
					const mutations = local.writes.slice(invocation.writes);
					for (const e of mutations.filter((e) => e.name === "write"))
						assert.equal(
							e.options?.mode,
							0o600,
							"I13 show temporary files start private",
						);
					if (local.files.has(options.out))
						assert.equal(
							local.fs.statSync(options.out).mode & 0o7777,
							invocation.outputMode,
							"I13 show replacement preserves the previous mode",
						);
				}
			}
		},
		async attempt(command, opts) {
			try {
				return { result: await f.run(command, opts) };
			} catch (error) {
				if (error instanceof assert.AssertionError) throw error;
				return { error };
			}
		},
		sourceWrites() {
			return calls.filter(
				(c) =>
					(c.method === "POST" && c.type === "generic") ||
					(c.method === "PATCH" &&
						records.get(c.artifact)?.artifact.type === "generic"),
			);
		},
	};
	return f;
}

// Oracles derived from the design guarantee table, independently of run results.
function assertBase(f, work) {
	for (const dir of work ? [work] : ["A", "B"])
		if (f.files.has(`/fault/${dir}/issue-pfd.json`)) {
			const state = f.viewState(dir);
			if (state.base)
				assert.equal(
					f.files.get(`/fault/${dir}/base.pfdsl`),
					api.parseSource(state.base.body).model,
					"I8 viewer base equals authoritative state at command boundary",
				);
		}
}
function assertDefaults(f) {
	for (const [dir, expected] of f.expectedDefaults)
		assert.equal(
			f.viewState(dir).diagram,
			expected,
			"I9 applied diagram destination becomes the default",
		);
}
function evidence(f) {
	assertBase(f);
	assertDefaults(f);
	const sourceCounts = new Map();
	for (const record of f.records.values())
		if (record.artifact.type === "generic") {
			const sourceId = record.versions
				.find((v) => /source id=/.test(v.body))
				?.body.match(/source id=([a-f0-9-]+)/)?.[1];
			if (sourceId)
				sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
		}
	for (const count of sourceCounts.values())
		assert.equal(count, 1, "I2 no duplicate sourceId artifacts");
	for (const dir of ["A", "B"]) {
		if (!f.files.has(`/fault/${dir}/issue-pfd.json`)) continue;
		for (const op of f.state(dir).operations) {
			if (op.body === undefined) {
				assert.ok(
					op.artifact && op.version && op.bodySha256,
					"I4 body retained until artifact/version/hash exist",
				);
				const sent = f.calls.find(
					(c) =>
						c.invocation === f.origins.get(op.id) &&
						c.body &&
						(op.stage === "source"
							? c.body.includes(`op=${op.id}`)
							: c.type === "embedded_html" ||
								f.records.get(c.artifact)?.artifact.type === "embedded_html"),
				);
				assert.ok(
					f.intents.has(op.id),
					"I4 compacted operation has a recorded intent",
				);
				assert.equal(
					op.bodySha256,
					hash(sent?.body ?? f.intents.get(op.id)),
					"I4 sent digest is preserved by reconciliation",
				);
			}
			if (op.stage === "source") {
				assert.ok(
					f.sourceWrites().filter((c) => c.body?.includes(`op=${op.id}`))
						.length <= 1,
					"I7 no automatic resend of a source operation",
				);
				const post = f.calls.filter(
					(c) => c.method === "POST" && c.body?.includes(`op=${op.id}`),
				);
				assert.ok(post.length <= 1, "I2 at most one POST per operation");
				const r = f.records.get(op.artifact ?? f.state(dir).artifact);
				const versions = [...(r?.versions ?? [])].reverse();
				const index = versions.findIndex((v) => v.body.includes(`op=${op.id}`));
				if (
					index >= 0 &&
					(versions[index - 1]?.version ?? 0) !== op.baseVersion
				)
					assert.equal(
						op.status,
						"overwrote",
						"I1 earliest own operation must report overwritten predecessor",
					);
			} else if (op.artifact) {
				const origin = f.origins.get(op.id);
				const sent = f.calls.find(
					(c) =>
						c.invocation === origin &&
						c.method === "PATCH" &&
						f.records.get(c.artifact)?.artifact.type === "embedded_html",
				);
				if (sent) {
					assert.equal(
						sent.artifact,
						origin.expectedDiagram,
						"I6 actual diagram request matches command destination",
					);
					assert.equal(
						op.artifact,
						sent.artifact,
						"I6 reconcile only the sent-to diagram",
					);
				}
			}
		}
	}
}

test("I3 restore followed by publish never resends the unedited old working copy (r5/r12)", async () => {
	for (const mode of ["none", "before", "crash"]) {
		const f = fixture();
		f.add(1, body("second >> p -> b\n"));
		await f.run("pull");
		f.arm((e) =>
			e.name === "write" && e.path.endsWith("/model.pfdsl") ? mode : undefined,
		);
		await f.attempt("restore", { version: 1 });
		f.recover();
		const count = f.sourceWrites().length;
		await f.attempt("publish");
		assert.equal(
			f.sourceWrites().length,
			count,
			`I3 no unedited source resend after restore/${mode}`,
		);
		evidence(f);
	}
});

test("I2 abandoned delayed create cannot reuse an older definite failure (r5)", async () => {
	const f = fixture();
	f.files.set("/fault/input.pfdsl", "a >> p -> b\n");
	f.rule((c) => (c.method === "POST" ? "4xx" : undefined));
	await f.attempt("create", { file: "/fault/input.pfdsl" });
	f.rule((c) => (c.method === "POST" ? "delay20" : undefined));
	await f.attempt("create", { file: "/fault/input.pfdsl" });
	const op = f.state().operations.at(-1);
	await f.run("resolve", { abandon: op.id });
	f.rule(undefined);
	const count = f.sourceWrites().length;
	await f.attempt("create", { file: "/fault/input.pfdsl" });
	for (let i = 0; i < 7; i++) await f.drain();
	const matching = [...f.records.values()].filter(
		(r) =>
			r.artifact.type === "generic" &&
			r.versions.some((v) =>
				v.body.includes(`source id=${f.state().sourceId}`),
			),
	);
	assert.equal(
		matching.length,
		1,
		"I2 delayed create must not produce a second source artifact",
	);
	assert.equal(
		f.sourceWrites().length,
		count,
		"I2 no new POST while an earlier create can still settle",
	);
});

test("I6 explicit diagram destination survives lost PATCH with two diagrams (r5)", async () => {
	const f = fixture();
	await f.run("pull");
	await f.run("publish-diagram");
	const r = structuredClone(f.records.get(2));
	r.artifact.number = 3;
	f.records.set(3, r);
	const stamp = api.readStamp(f.records.get(2).versions[0].body);
	f.records.get(2).versions[0].body = api.diagramBody(
		{ ...stamp, sourceVersion: 0 },
		"<svg></svg>",
	);
	f.rule((c) =>
		c.method === "PATCH" && c.artifact === 2 ? "network" : undefined,
	);
	await f.attempt("publish-diagram", { diagram: 2 });
	f.rule(undefined);
	await f.run("status", { diagram: 2 });
	const op = f.state().operations.at(-1);
	assert.equal(op.artifact, 2, "I6 destination recorded before PATCH");
	assert.notEqual(
		f.state().diagram,
		3,
		"I6 reconciliation cannot select another saved destination",
	);
	evidence(f);
});

test("diagram unknown does not block a new edited source (r12)", async () => {
	const f = fixture();
	await f.run("pull");
	await f.run("publish-diagram");
	f.edit();
	f.rule((c) =>
		c.method === "PATCH" && c.artifact === 2 ? "network" : undefined,
	);
	await f.attempt("publish");
	f.rule(undefined);
	f.edit("third >> p -> b\n");
	await f.attempt("publish");
	assert.equal(
		f.records.get(1).versions[0].version,
		3,
		"I7 only source unknown blocks source publication",
	);
	evidence(f);
});

const remoteModes = [
	"4xx",
	"network",
	"after",
	"delay1",
	"delay3",
	"unavailable-before",
	"unavailable-after",
];
test("guarantee-table product: two actors, web edits, delayed writes, recovery and abandonment", async (t) => {
	let cases = 0,
		reached = 0;
	for (const tail of [
		"status",
		"publish",
		"restore",
		"publish-diagram",
		"abandon",
	])
		for (const web of ["none", "retain", "break", "comment-svg"])
			for (const mode of remoteModes) {
				const baseline = fixture();
				await baseline.run("pull");
				await baseline.run("pull", { work: "B" });
				baseline.edit();
				const start = baseline.calls.length;
				await baseline.attempt("publish");
				const width = baseline.calls.length - start;
				for (let position = 1; position <= width; position++) {
					const f = fixture();
					await f.run("pull");
					await f.run("pull", { work: "B" });
					f.edit();
					let n = 0,
						hit = false;
					f.rule(() => {
						if (++n === position) {
							hit = true;
							return mode;
						}
					});
					await f.attempt("publish");
					f.rule(undefined);
					if (web === "comment-svg") {
						for (const r of f.records.values())
							if (r.artifact.type === "embedded_html")
								f.add(
									r.artifact.number,
									r.versions[0].body.replace(
										"<svg></svg>",
										"<!-- <svg></svg> -->",
									),
								);
					} else if (web !== "none")
						f.add(
							1,
							web === "retain"
								? f.records
										.get(1)
										.versions[0].body.replace(
											/```pfdsl\n[\s\S]*?```/,
											"```pfdsl\nweb >> p -> b\n```",
										)
								: "broken fence\n",
						);
					const before = f.sourceWrites().length;
					const unresolved = f
						.state()
						.operations.some(
							(op) =>
								op.stage === "source" &&
								["sent", "unknown"].includes(op.status),
						);
					if (tail === "abandon") {
						const op = f
							.state()
							.operations.find((op) => ["sent", "unknown"].includes(op.status));
						if (op) await f.attempt("resolve", { abandon: op.id });
					} else
						await f.attempt(tail, {
							version: tail === "restore" ? 1 : undefined,
						});
					if (
						unresolved &&
						tail !== "abandon" &&
						f
							.state()
							.operations.some(
								(op) =>
									op.stage === "source" &&
									["sent", "unknown"].includes(op.status),
							)
					)
						assert.equal(
							f.sourceWrites().length,
							before,
							`I7 no automatic resend of unknown source [${tail}/${web}/${mode}/call${position}]`,
						);
					await f.attempt("status");
					const bModel = f.files.get("/fault/B/model.pfdsl");
					await f.attempt("publish", { work: "B" });
					assert.equal(
						f.files.get("/fault/B/model.pfdsl"),
						bModel,
						"I3 other actor's working edits survive conflicts",
					);
					await f.attempt("status");
					try {
						evidence(f);
					} catch (error) {
						error.message += ` [${tail}/${web}/${mode}/call${position}]`;
						throw error;
					}
					cases++;
					if (hit) reached++;
				}
			}
	assert.ok(cases >= 500);
	t.diagnostic(
		`${cases} remote fault / operation-tail / web-edit cases; injection reached ${reached}`,
	);
});

const entries = [
	"publish",
	"restore",
	"create",
	"publish-diagram",
	"diagram-patch",
	"pull",
	"status",
	"resolve",
	"render",
	"show",
	"show-private",
	"show-shared",
	"restore-applied",
	"ambiguous-diagram",
	"diagram-switch",
	"comment-repair",
	"template-repair",
	"script-repair",
	"duplicate-svg-repair",
	"backup-create",
	"linked-base",
	"pull-model-race",
	"pull-base-race",
	"pull-state-race",
	"pull-model-commit-race",
	"pull-base-commit-race",
	"pull-state-commit-race",
];
async function prepareEntry(command) {
	const f = fixture();
	f.files.set("/fault/input.pfdsl", "a >> p -> b\n");
	if (command.startsWith("pull-")) {
		let saved = false;
		const name = command.startsWith("pull-model")
			? "model.pfdsl"
			: command.startsWith("pull-base")
				? "base.pfdsl"
				: "issue-pfd.json";
		const save = () => {
			if (!saved) {
				saved = true;
				const text =
					name === "issue-pfd.json"
						? JSON.stringify({
								schema: 2,
								host: "github.com",
								owner: "saved",
								repo: "work",
								artifact: 1,
								issue: 7,
								sourceId: id(1),
								operations: [],
								base: null,
								diagram: null,
							})
						: "unpublished >> p -> saved\n";
				f.protect(`/fault/A/${name}`, text);
			}
		};
		if (command.includes("commit"))
			f.observeMutation((event) => {
				if (event.name === "link" && event.value === `/fault/A/${name}`) save();
			});
		else
			f.observe((call) => {
				if (call.method === "GET") save();
			});
	}
	if (command === "backup-create") {
		f.rule((c) =>
			c.method === "POST" && c.type === "generic" ? "4xx" : undefined,
		);
		await f.attempt("create", { file: "/fault/input.pfdsl" });
		const backup = f.backup();
		f.rule(undefined);
		await f.run("create", { file: "/fault/input.pfdsl" });
		f.restoreBackup(backup);
	}
	if (
		![
			"create",
			"pull",
			"show",
			"show-private",
			"show-shared",
			"backup-create",
		].includes(command) &&
		!command.startsWith("pull-")
	) {
		f.add(1, body("second >> p -> b\n"));
		await f.run("pull");
		if (command === "diagram-patch") await f.run("publish-diagram");
		if (command === "linked-base") {
			f.fs.rmSync("/fault/A/base.pfdsl");
			f.fs.linkSync("/fault/A/model.pfdsl", "/fault/A/base.pfdsl");
			f.fs.writeFileSync("/fault/A/model.pfdsl", "draft >> p -> b\n");
			f.protect("/fault/A/model.pfdsl", "draft >> p -> b\n");
		}
		if (
			["template-repair", "script-repair", "duplicate-svg-repair"].includes(
				command,
			)
		) {
			await f.run("publish-diagram");
			const html = f.records.get(2).versions[0].body;
			const svg = "<svg></svg>",
				old = "<svg>old</svg>";
			f.add(
				2,
				html.replace(
					svg,
					command === "duplicate-svg-repair"
						? svg + old
						: `<${command === "template-repair" ? "template" : "script"}>${svg}</${command === "template-repair" ? "template" : "script"}>${old}`,
				),
			);
		}
		if (["diagram-switch", "comment-repair"].includes(command)) {
			await f.run("publish-diagram");
			if (command === "diagram-switch") {
				const copy = structuredClone(f.records.get(2));
				copy.artifact.number = 3;
				f.records.set(3, copy);
				await f.run("publish-diagram", { diagram: 2 });
				await f.run("publish-diagram", { diagram: 3 });
				evidence(f); // Identical bytes sent to #2 then #3 are valid.
				f.edit();
			} else
				f.add(
					2,
					f.records
						.get(2)
						.versions[0].body.replace("<svg></svg>", "<!-- <svg></svg> -->"),
				);
		}
		if (command === "restore-applied") {
			await f.run("restore", { version: 1 });
			const state = f.state();
			delete state.retired;
			f.files.set("/fault/A/issue-pfd.json", JSON.stringify(state));
		}
		if (command === "ambiguous-diagram") {
			f.rule((c) => (c.method === "POST" ? "after" : undefined));
			await f.attempt("publish-diagram");
			f.rule(undefined);
			const copy = structuredClone(f.records.get(2));
			copy.artifact.number = 3;
			f.records.set(3, copy);
			f.edit();
		}
		if (["publish", "status", "resolve"].includes(command)) f.edit();
		if (["status", "resolve"].includes(command)) {
			f.rule((c) =>
				c.method === "PATCH" && c.artifact === 1 ? "after" : undefined,
			);
			await f.attempt("publish");
			f.rule(undefined);
		}
	}
	f.arm(undefined);
	if (command === "show-private") {
		f.files.set("/fault/output", "private backup");
		f.modes.set("/fault/output", 0o600);
	}
	if (command === "show-shared") {
		f.files.set("/fault/output", "shared backup");
		f.modes.set("/fault/output", 0o640);
	}
	f.opts = {
		...(command.startsWith("pull-") ? { command: "pull" } : {}),
		...(command === "backup-create" ? { command: "create", write: true } : {}),
		...(command === "linked-base" ? { command: "status" } : {}),
		...(["template-repair", "script-repair", "duplicate-svg-repair"].includes(
			command,
		)
			? { command: "publish", write: true }
			: {}),
		...(["show-private", "show-shared"].includes(command)
			? { command: "show" }
			: {}),
		...([
			"restore-applied",
			"ambiguous-diagram",
			"diagram-switch",
			"comment-repair",
		].includes(command)
			? { command: "publish", write: true }
			: {}),
		...(command === "diagram-switch" ? { diagram: 2 } : {}),
		...(command === "diagram-patch"
			? { command: "publish-diagram", write: true }
			: {}),
		version: ["restore", "show", "show-private", "show-shared"].includes(
			command,
		)
			? 1
			: undefined,
		file: "/fault/input.pfdsl",
		out: ["render", "show", "show-private", "show-shared"].includes(command)
			? "/fault/output"
			: undefined,
		abandon: command === "resolve" ? f.state().operations[0].id : undefined,
	};
	return f;
}

test("all entry GitHub boundaries: fault at every call, then recovery without resending", async (t) => {
	let cases = 0,
		reached = 0;
	for (const command of entries) {
		await t.test(command, async () => {
			const baseline = await prepareEntry(command);
			const start = baseline.calls.length;
			await baseline.attempt(command, baseline.opts);
			if (command.startsWith("pull-"))
				assert.equal(
					baseline.protectedFiles.size,
					1,
					"pull race must reach the simulated editor save",
				);
			if (command === "diagram-patch")
				assert.ok(
					baseline.calls
						.slice(start)
						.some((c) => c.method === "PATCH" && c.artifact === 2),
					"existing diagram PATCH route must execute",
				);
			for (
				let position = 1;
				position <= baseline.calls.length - start;
				position++
			)
				for (const mode of remoteModes) {
					const f = await prepareEntry(command);
					let n = 0,
						hit = false;
					f.rule(() => {
						if (++n === position) {
							hit = true;
							return mode;
						}
					});
					await f.attempt(command, f.opts);
					f.rule(undefined);
					await f.drain();
					await f.attempt("status", {
						artifact: undefined,
						dir: f.files.has("/fault/A/issue-pfd.json")
							? "/fault/A"
							: undefined,
					});
					if (command === "diagram-switch") {
						f.edit("next >> p -> b\n");
						await f.attempt("publish");
					}
					if (command === "create") await f.attempt("create", f.opts);
					await f.attempt("status", {
						artifact: undefined,
						dir: f.files.has("/fault/A/issue-pfd.json")
							? "/fault/A"
							: undefined,
					});
					try {
						evidence(f);
					} catch (error) {
						error.message += ` [${command}/call${position}/${mode}]`;
						throw error;
					}
					cases++;
					if (hit) reached++;
				}
		});
	}
	t.diagnostic(
		`${cases} all-entry remote call-boundary cases; injection reached ${reached}`,
	);
});

test("local write product: each write seam before failure and interruption, then recovery", async (t) => {
	let cases = 0,
		localReached = 0,
		remoteReached = 0,
		bothReached = 0,
		remoteRequested = 0;
	for (const command of entries) {
		await t.test(command, async () => {
			const baseline = await prepareEntry(command);
			const callsBefore = baseline.calls.length;
			await baseline.attempt(command, baseline.opts);
			assert.ok(
				baseline.writes.length > 0,
				`${command} must exercise its local mutation seams`,
			);
			t.diagnostic(
				`${command}: ${baseline.writes.length} local mutation seams`,
			);
			const crossModes = baseline.calls
				.slice(callsBefore)
				.some((c) => ["POST", "PATCH"].includes(c.method))
				? ["none", ...remoteModes]
				: ["none"];
			for (let point = 1; point <= baseline.writes.length; point++)
				for (const mode of ["before", "crash"])
					for (const remote of crossModes) {
						const f = await prepareEntry(command);
						const opts = f.opts;
						let hit = false;
						f.arm((_, n) => {
							if (n === point) {
								hit = true;
								return mode;
							}
						});
						let injected = false;
						f.rule((c) => {
							if (!injected && ["POST", "PATCH"].includes(c.method)) {
								injected = true;
								return remote;
							}
						});
						await f.attempt(command, opts);
						f.recover();
						f.rule(undefined);
						const local = f.files.get("/fault/A/model.pfdsl");
						const before = f.sourceWrites().length;
						await f.attempt("status");
						await f.attempt(
							command === "create" ? "create" : "publish",
							command === "create" ? opts : {},
						);
						await f.attempt("status");
						if (
							command === "restore" &&
							f.records.get(1).versions.some((v) => /base=2/.test(v.body))
						)
							assert.equal(
								f.sourceWrites().length,
								before,
								"I3 restore recovery cannot resend the old working copy",
							);
						if (command !== "restore" && local !== undefined)
							assert.equal(
								f.files.get("/fault/A/model.pfdsl"),
								local,
								`I3 no recovery deletes unpublished edits [${command}/write${point}/${mode}/${remote}]`,
							);
						try {
							evidence(f);
						} catch (error) {
							error.message += ` [${command}/write${point}/${mode}/${remote}]`;
							throw error;
						}
						cases++;
						if (hit) localReached++;
						if (remote !== "none") {
							remoteRequested++;
							if (injected) remoteReached++;
							if (hit && injected) bothReached++;
						}
					}
		});
	}
	t.diagnostic(
		`${cases} local seam / interruption / remote-fault cases; local reached ${localReached}; remote requested ${remoteRequested}, reached ${remoteReached}; both reached ${bothReached}`,
	);
});

test("I5 current requires SVG presence and all three actual hashes", async () => {
	const real =
		"<svg><!-- keep SVG bytes, including </svg> in comments --></svg>";
	assert.equal(api.svgElement(`<!-- <svg></svg> -->${real}`), real);
	assert.equal(
		api.svgElement('<svg data-label="X"/>'),
		'<svg data-label="X"/>',
	);
	for (const html of [
		"<svg/><svg/>",
		"<svg><svg/></svg>",
		"<svg data-label=X/>",
		"<frameset></frameset>",
		"<template><svg/></template>",
		"<script>const fake = '<svg/>';</script>",
		"<textarea><svg/></textarea>",
	])
		assert.equal(
			api.svgElement(html),
			null,
			"I15 exactly one body SVG outside non-rendered containers",
		);
	for (const tag of [
		"template",
		"script",
		"style",
		"textarea",
		"title",
		"xmp",
		"iframe",
		"noembed",
		"noframes",
		"noscript",
	])
		assert.equal(
			api.svgElement(`<${tag}><svg>hidden</svg></${tag}>${real}`),
			real,
			"I15 ignore inert content before counting body SVGs",
		);
	for (const tag of ["script", "style", "textarea", "title", "xmp", "iframe"])
		assert.equal(
			api.svgElement(
				`${real}<${tag}>hidden</${tag} data-x=">"><svg>extra</svg>`,
			),
			null,
			"I15 raw-text end tags cannot hide an extra body SVG",
		);
	assert.equal(
		api.svgElement(`<div title="<svg>attribute text</svg>"></div>${real}`),
		real,
	);
	for (const field of [
		"modelSha256",
		"sourceBodySha256",
		"svgSha256",
		"absent-svg",
		"comment-svg",
	]) {
		const f = fixture();
		await f.run("pull");
		await f.run("publish-diagram");
		const r = f.records.get(2);
		const stamp = api.readStamp(r.versions[0].body);
		r.versions[0].body =
			field === "comment-svg"
				? api.diagramBody(stamp, "<!-- <svg></svg> -->")
				: field === "absent-svg"
					? api.diagramBody({ ...stamp, svgSha256: hash("") }, "")
					: api.diagramBody(
							{ ...stamp, [field]: "0".repeat(64) },
							"<svg></svg>",
						);
		assert.notEqual(
			(await f.run("status")).classification,
			"current",
			`I5 ${field}`,
		);
	}
});

test("accepted POST then unavailable GET retains evidence and resolves without another POST", async () => {
	for (const stage of ["source", "diagram"]) {
		const f = fixture();
		if (stage === "diagram") await f.run("pull");
		f.files.set("/fault/input.pfdsl", "a >> p -> b\n");
		let posted = false;
		f.rule((c) => {
			if (c.method === "POST") posted = true;
			else if (posted && c.method === "GET" && c.artifact === 2)
				return "unavailable-before";
		});
		await f.attempt(stage === "source" ? "create" : "publish-diagram", {
			file: "/fault/input.pfdsl",
		});
		const unknown = f.state().operations.at(-1);
		assert.equal(unknown.status, "unknown");
		assert.equal(typeof unknown.body, "string");
		f.rule(undefined);
		await f.run("status", { artifact: f.state().artifact });
		const op = f.state().operations.at(-1);
		assert.equal(op.status, "applied");
		assert.equal(op.bodySha256, hash(unknown.body));
		assert.equal(f.calls.filter((c) => c.method === "POST").length, 1);
		evidence(f);
	}
});

test("I6 repair reconciliation checks all input fields and SVG, keeps sent/observed digests distinct", async () => {
	for (const field of [
		"modelSha256",
		"sourceBodySha256",
		"result",
		"svg",
		"none",
	])
		for (const mode of ["network", "after", "delay1"]) {
			const f = fixture();
			await f.run("pull");
			await f.run("publish-diagram");
			const original = f.records.get(2).versions[0].body;
			let injected = false;
			f.rule((c) => {
				if (!injected && c.method === "PATCH") {
					injected = true;
					return mode;
				}
			});
			await f.attempt("publish-diagram");
			f.rule(undefined);
			await f.drain();
			const op = f.state().operations.at(-1);
			const stamp = api.readStamp(original);
			f.add(
				2,
				field === "svg"
					? api.diagramBody(stamp, "")
					: `${api.diagramBody(
							{
								...stamp,
								...(field === "none"
									? {}
									: {
											[field]: field === "result" ? "failed" : "0".repeat(64),
										}),
							},
							"<svg></svg>",
						)}<!-- external prose -->`,
			);
			await f.run("status");
			const reconciled = f.state().operations.at(-1);
			assert.equal(
				reconciled.status,
				field === "none" ? "applied" : "unknown",
				`I6 ${field}/${mode}`,
			);
			if (field === "none") {
				assert.equal(reconciled.bodySha256, hash(op.body));
				assert.equal(
					reconciled.observedBodySha256,
					hash(f.records.get(2).versions[0].body),
				);
				assert.notEqual(reconciled.bodySha256, reconciled.observedBodySha256);
			} else
				assert.equal(
					reconciled.body,
					op.body,
					"I4 uncertain operation retains body",
				);
		}
});

test("restore clean check uses reconciled base and retired directories reject both commands", async () => {
	const f = fixture();
	await f.run("pull");
	f.edit();
	f.rule((c) => (c.method === "PATCH" ? "after" : undefined));
	await f.attempt("publish");
	f.rule(undefined);
	f.edit("a >> p -> b\n");
	const count = f.sourceWrites().length;
	const dirty = await f.attempt("restore", { version: 1 });
	assert.match(dirty.error?.message ?? "", /unpublished/i);
	assert.equal(
		f.sourceWrites().length,
		count,
		"I3 reconciliation cannot publish newly dirty input",
	);
	f.edit("b >> p -> c\n");
	await f.run("restore", { version: 1 });
	for (const command of ["publish", "restore"]) {
		const result = await f.attempt(command, { version: 1 });
		assert.match(result.error?.message ?? "", /retired.*pull/i);
	}
});

test("show uses output-directory atomic replacement without acquiring a lock; render out has no SVG stdout", async () => {
	const f = fixture();
	await f.run("pull");
	f.files.set("/fault/.issue-pfd.lock", "other writer");
	f.files.set("/fault/output.md", "preserve old output");
	f.arm((e) => (e.name === "rename" ? "before" : undefined));
	await f.attempt("show", {
		version: 1,
		out: "/fault/output.md",
		dir: undefined,
		write: false,
	});
	assert.equal(f.files.get("/fault/output.md"), "preserve old output");
	assert.ok(
		f.writes.some((e) => e.name === "rename"),
		"show must reach atomic rename despite another lock",
	);
	assert.ok(
		!f.writes.some((e) => e.path.endsWith(".lock")),
		"show takes no lock",
	);
	const temp = f.writes.find((e) => e.name === "write");
	assert.equal(dirname(temp.path), "/fault");
	f.recover();
	const shown = await f.run("show", {
		version: 1,
		out: "/fault/output.md",
		dir: undefined,
		write: false,
	});
	assert.equal(shown.output, undefined);
	assert.equal(f.files.get("/fault/output.md"), body());
	const rendered = await f.run("render", {
		out: "/fault/output.svg",
		write: false,
	});
	assert.equal(rendered.output, undefined);
	assert.equal(f.files.get("/fault/output.svg"), "<svg></svg>");
});

test("guarantee table boundaries: conflict, direct edits, regression, observation, lock, environment and snapshots", async () => {
	// Two actors publishing in order: conflict preserves all local files.
	{
		const f = fixture();
		await f.run("pull");
		await f.run("pull", { work: "B" });
		f.edit();
		await f.run("publish");
		f.edit("other >> p -> b\n", "B");
		const before = [...f.files].filter(([p]) => p.startsWith("/fault/B/"));
		assert.match(
			(await f.attempt("publish", { work: "B" })).error?.message ?? "",
			/Conflict/,
		);
		assert.deepEqual(
			[...f.files].filter(([p]) => p.startsWith("/fault/B/")),
			before,
		);
	}
	// Web edits are not attributed to this entry; malformed source gets an explicit notice.
	{
		const f = fixture();
		await f.run("pull");
		await f.run("publish-diagram");
		f.add(1, body("web >> p -> b\n"));
		assert.equal((await f.run("status")).classification, "stale");
		f.add(1, "broken fence\n");
		const invalid = await f.run("status");
		assert.equal(invalid.classification, "invalid-source");
		assert.equal(invalid.lastGoodVersion, 1);
		await f.run("publish-diagram");
		assert.equal(
			api.readStamp(f.records.get(2).versions[0].body).result,
			"invalid-source",
		);
		assert.ok(f.state().operations.every((op) => op.stage === "diagram"));
	}
	// An older rendering cannot overwrite a newer diagram; status detects a changing source.
	{
		const f = fixture();
		await f.run("pull");
		f.edit();
		await f.run("publish");
		const before = f.calls.filter((c) => c.method === "PATCH").length;
		assert.equal(
			(await f.run("publish-diagram", { version: 1 })).skipped,
			"newer diagram",
		);
		assert.equal(f.calls.filter((c) => c.method === "PATCH").length, before);
		let changed = false;
		f.rule((c) => {
			if (!changed && c.method === "GET" && c.artifact === 2) {
				changed = true;
				f.add(1, body("web >> p -> b\n"));
			}
		});
		assert.equal(
			(await f.run("status")).classification,
			"changed-during-check",
		);
	}
	// Directory exclusion, repository mismatch and CLI environment reject before send.
	for (const failure of ["lock", "repository", "cli"]) {
		const f = fixture();
		await f.run("pull");
		f.edit();
		const before = f.sourceWrites().length;
		if (failure === "lock")
			f.files.set("/fault/A/.issue-pfd.lock", "another process");
		if (failure === "repository") f.repo.repo = "another";
		if (failure === "cli")
			f.cli.preflight = async () => {
				throw Object.assign(new Error("CLI environment error"), {
					exitCode: 3,
				});
			};
		assert.ok((await f.attempt("publish")).error);
		assert.equal(f.sourceWrites().length, before);
	}
	// Snapshot pinning and dry run protect unpublished edits.
	{
		const f = fixture();
		await f.run("pull");
		f.edit();
		const before = [...f.files];
		const sends = f.sourceWrites().length;
		await f.run("publish", { write: false });
		assert.deepEqual([...f.files], before);
		assert.equal(f.sourceWrites().length, sends);
		f.rule((c) => {
			if (c.method === "PATCH" && c.artifact === 1) f.edit("later >> p -> b\n");
		});
		await f.run("publish");
		assert.equal(api.parseSource(f.state().base.body).model, "b >> p -> c\n");
		assert.equal(f.files.get("/fault/A/model.pfdsl"), "later >> p -> b\n");
		evidence(f);
	}
});

test("I4 compaction waits for artifact and version, even for a terminal operation", async () => {
	for (const missing of ["artifact", "version"]) {
		const f = fixture();
		await f.run("pull");
		const state = f.state();
		const op = {
			id: id(99),
			kind: "publish-diagram",
			stage: "diagram",
			status: "applied",
			artifact: 2,
			version: 1,
			body: "evidence",
			bodySha256: hash("evidence"),
		};
		delete op[missing];
		state.operations.push(op);
		f.files.set("/fault/A/issue-pfd.json", JSON.stringify(state));
		await f.run("status");
		assert.equal(f.state().operations.at(-1).body, "evidence");
	}
});

test("unknown POST with multiple diagrams requires explicit destination and adopts its confirmed target", async () => {
	const f = fixture();
	await f.run("pull");
	f.rule((c) => (c.method === "POST" ? "after" : undefined));
	await f.attempt("publish-diagram");
	f.rule(undefined);
	const duplicate = structuredClone(f.records.get(2));
	duplicate.artifact.number = 3;
	f.records.set(3, duplicate);
	const ambiguous = await f.attempt("status");
	assert.match(
		ambiguous.error?.message ?? ambiguous.result?.diagnostic ?? "",
		/Multiple diagram.*--diagram/,
	);
	assert.equal(f.state().operations.at(-1).status, "unknown");
	await f.run("status", { diagram: 2 });
	assert.equal(f.state().operations.at(-1).artifact, 2);
	assert.equal(f.state().diagram, 2);
});

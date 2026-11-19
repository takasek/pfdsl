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

function memoryFs() {
	const files = new Map();
	const dirs = new Set(["/", "/fault"]);
	const writes = [];
	let fault,
		crashed = false;
	function mutate(name, args, apply) {
		const event = { name, path: resolve(args[0]), value: args[1] };
		writes.push(event);
		if (crashed) throw new Error("process interrupted");
		const hit = fault?.(event, writes.length);
		if (hit === "before") throw new Error("local write failed");
		const result = apply();
		if (hit === "crash") {
			crashed = true;
			throw new Error("process interrupted");
		}
		return result;
	}
	const fs = {
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
				files.set(p, String(args[1]));
			});
		},
		renameSync(...args) {
			return mutate("rename", args, () => {
				files.set(resolve(args[1]), fs.readFileSync(args[0]));
				files.delete(resolve(args[0]));
			});
		},
		rmSync(...args) {
			return mutate("rm", args, () => {
				files.delete(resolve(args[0]));
			});
		},
	};
	return {
		fs,
		files,
		writes,
		arm(fn) {
			fault = fn;
			writes.length = 0;
		},
		recover() {
			fault = undefined;
			crashed = false;
			for (const p of files.keys())
				if (p.endsWith(".issue-pfd.lock")) files.delete(p);
		},
	};
}

function fixture() {
	const local = memoryFs();
	globalThis.__issuePfdFaultFs = local.fs;
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
		tick++;
		const entry = { method, ...args, tick };
		calls.push(entry);
		let mode = rule?.(entry);
		if (unavailableRead && method === "GET") {
			unavailableRead = false;
			mode = "unavailable-before";
		}
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
	const cli = async () => ({
		exitCode: 0,
		stdout: "<svg></svg>",
		stderr: "",
		cliVersion: "test",
	});
	const repo = { host: "github.com", owner: "o", repo: "r" };
	const runner = api.createIssuePfd({
		github,
		fs: local.fs,
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
		edit(text = "b >> p -> c\n", dir = "A") {
			local.files.set(`/fault/${dir}/model.pfdsl`, text);
		},
		async run(command, opts = {}) {
			const { work = "A", ...rest } = opts;
			return runner.run({
				command,
				issue: 7,
				artifact: 1,
				dir: `/fault/${work}`,
				write: ["publish", "restore", "publish-diagram", "create"].includes(
					command,
				),
				...rest,
			});
		},
		async attempt(command, opts) {
			try {
				return { result: await f.run(command, opts) };
			} catch (error) {
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
function evidence(f) {
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
						c.body &&
						(op.stage === "source"
							? c.body.includes(`op=${op.id}`)
							: hash(c.body) === op.bodySha256),
				);
				assert.ok(sent, "I4 sent digest equals the actual transmitted bytes");
				assert.equal(
					op.bodySha256,
					hash(sent.body),
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
				const sent = f.calls.find(
					(c) =>
						c.method === "PATCH" &&
						c.body &&
						hash(c.body) === (op.bodySha256 ?? hash(op.body)),
				);
				if (sent)
					assert.equal(
						op.artifact,
						sent.artifact,
						"I6 reconcile only the sent-to diagram",
					);
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
	let cases = 0;
	for (const tail of [
		"status",
		"publish",
		"restore",
		"publish-diagram",
		"abandon",
	])
		for (const web of ["none", "retain", "break"])
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
					let n = 0;
					f.rule(() => (++n === position ? mode : undefined));
					await f.attempt("publish");
					f.rule(undefined);
					if (web !== "none")
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
				}
			}
	assert.ok(cases >= 500);
	t.diagnostic(`${cases} remote fault / operation-tail / web-edit cases`);
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
];
async function prepareEntry(command) {
	const f = fixture();
	f.files.set("/fault/input.pfdsl", "a >> p -> b\n");
	if (!["create", "pull", "show"].includes(command)) {
		f.add(1, body("second >> p -> b\n"));
		await f.run("pull");
		if (command === "diagram-patch") await f.run("publish-diagram");
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
	f.opts = {
		...(command === "diagram-patch"
			? { command: "publish-diagram", write: true }
			: {}),
		version: ["restore", "show"].includes(command) ? 1 : undefined,
		file: "/fault/input.pfdsl",
		out: ["render", "show"].includes(command) ? "/fault/output" : undefined,
		abandon: command === "resolve" ? f.state().operations[0].id : undefined,
	};
	return f;
}

test("all entry GitHub boundaries: fault at every call, then recovery without resending", async (t) => {
	let cases = 0;
	for (const command of entries) {
		const baseline = await prepareEntry(command);
		const start = baseline.calls.length;
		await baseline.attempt(command, baseline.opts);
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
				let n = 0;
				f.rule(() => (++n === position ? mode : undefined));
				await f.attempt(command, f.opts);
				f.rule(undefined);
				await f.drain();
				await f.attempt("status", {
					artifact: undefined,
					dir: f.files.has("/fault/A/issue-pfd.json") ? "/fault/A" : undefined,
				});
				if (command === "create") await f.attempt("create", f.opts);
				await f.attempt("status", {
					artifact: undefined,
					dir: f.files.has("/fault/A/issue-pfd.json") ? "/fault/A" : undefined,
				});
				try {
					evidence(f);
				} catch (error) {
					error.message += ` [${command}/call${position}/${mode}]`;
					throw error;
				}
				cases++;
			}
	}
	t.diagnostic(`${cases} all-entry remote call-boundary cases`);
});

test("local write product: each write seam before failure and interruption, then recovery", async (t) => {
	let cases = 0;
	for (const command of entries) {
		const baseline = await prepareEntry(command);
		await baseline.attempt(command, baseline.opts);
		assert.ok(
			baseline.writes.length > 0,
			`${command} must exercise its local mutation seams`,
		);
		t.diagnostic(`${command}: ${baseline.writes.length} local mutation seams`);
		for (let point = 1; point <= baseline.writes.length; point++)
			for (const mode of ["before", "crash"])
				for (const remote of ["none", ...remoteModes]) {
					const f = await prepareEntry(command);
					const opts = f.opts;
					f.arm((_, n) => (n === point ? mode : undefined));
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
					await f.attempt(command === "create" ? "create" : "publish", opts);
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
				}
	}
	t.diagnostic(`${cases} local seam / interruption / remote-fault cases`);
});

test("I5 current requires SVG presence and all three actual hashes", async () => {
	for (const field of [
		"modelSha256",
		"sourceBodySha256",
		"svgSha256",
		"absent-svg",
	]) {
		const f = fixture();
		await f.run("pull");
		await f.run("publish-diagram");
		const r = f.records.get(2);
		const stamp = api.readStamp(r.versions[0].body);
		r.versions[0].body =
			field === "absent-svg"
				? api.diagramBody({ ...stamp, svgSha256: hash("") }, "")
				: api.diagramBody({ ...stamp, [field]: "0".repeat(64) }, "<svg></svg>");
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

test("unknown POST with multiple diagrams requires explicit destination without changing saved publication target", async () => {
	const f = fixture();
	await f.run("pull");
	f.rule((c) => (c.method === "POST" ? "after" : undefined));
	await f.attempt("publish-diagram");
	f.rule(undefined);
	const duplicate = structuredClone(f.records.get(2));
	duplicate.artifact.number = 3;
	f.records.set(3, duplicate);
	const before = f.state().diagram;
	const ambiguous = await f.attempt("status");
	assert.match(
		ambiguous.error?.message ?? ambiguous.result?.diagnostic ?? "",
		/Multiple diagram.*--diagram/,
	);
	assert.equal(f.state().operations.at(-1).status, "unknown");
	await f.run("status", { diagram: 2 });
	assert.equal(f.state().operations.at(-1).artifact, 2);
	assert.equal(f.state().diagram, before);
});

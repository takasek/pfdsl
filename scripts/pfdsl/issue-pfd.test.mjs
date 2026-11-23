import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	linkSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { GitHubUnavailableError } from "./lib/github-ops.mjs";
import {
	createIssuePfd,
	diagramBody,
	modelHash,
	parseSource,
	readStamp,
} from "./lib/issue-pfd.mjs";

const identity = { host: "github.com", owner: "o", repo: "r" };
const id = "12345678-1234-4234-8234-123456789abc";
const source = (model = "a >> p -> b\n", prose = "Notes\n") =>
	`<!-- pfdsl:issue-pfd source id=${id} op=${id} base=0 -->\n${prose}\`\`\`pfdsl\n${model}\`\`\`\nAfter\n`;
function fixture(t) {
	const root = mkdtempSync(resolve(".issue-pfd-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const records = new Map([
		[
			1,
			{
				artifact: { number: 1, type: "generic", name: "Source" },
				versions: [{ version: 1, body: source() }],
			},
		],
	]);
	const calls = [];
	let beforePatch;
	let afterPatch;
	let afterCreate;
	let beforeCreate;
	let clock = 0;
	let repo = identity;
	let invalid = false;
	let svg = "<svg></svg>";
	let onGet;
	let onList;
	const add = (number, body) =>
		records.get(number).versions.unshift({
			version: records.get(number).versions[0].version + 1,
			body,
		});
	const github = {
		listArtifacts: async () => {
			await onList?.();
			return [...records.values()].map((x) => ({
				...x.artifact,
				body: x.versions[0].body,
			}));
		},
		getArtifact: async ({ artifact }) => {
			const result = structuredClone(records.get(artifact));
			await onGet?.(artifact);
			return result;
		},
		createArtifact: async ({ type, name, body }) => {
			calls.push(["POST", type]);
			beforeCreate?.(type, body);
			const number = records.size + 1;
			records.set(number, {
				artifact: { number, type, name },
				versions: [{ version: 1, body }],
			});
			afterCreate?.(number);
			return { number, type, name };
		},
		updateArtifact: async ({ artifact, body }) => {
			calls.push(["PATCH", artifact]);
			beforePatch?.(artifact, body);
			add(artifact, body);
			afterPatch?.(artifact, body);
			return records.get(artifact).artifact;
		},
	};
	const cliCalls = [];
	const api = createIssuePfd({
		root,
		now: () => new Date(1700000000000 + clock++).toISOString(),
		github,
		repository: () => repo,
		cli: async (input) => {
			cliCalls.push(input);
			return {
				exitCode: invalid ? 1 : 0,
				stdout: input.command === "render" ? svg : "ok",
				stderr: invalid ? "Invalid model" : "",
				cliVersion: "1.2.3",
			};
		},
	});
	const dir = resolve(root, "work");
	const run = (command, opts = {}) =>
		api.run({
			command,
			issue: 7,
			dir:
				[
					"create",
					"pull",
					"publish",
					"restore",
					"resolve",
					"check",
					"render",
				].includes(command) || existsSync(resolve(dir, "issue-pfd.json"))
					? dir
					: undefined,
			...opts,
		});
	return {
		root,
		dir,
		run,
		records,
		calls,
		add,
		cliCalls,
		setRepo: (x) => (repo = x),
		setInvalid: () => (invalid = true),
		setSvg: (output) => (svg = output),
		onGet: (x) => (onGet = x),
		onList: (x) => (onList = x),
		beforePatch: (x) => (beforePatch = x),
		afterPatch: (x) => (afterPatch = x),
		afterCreate: (x) => (afterCreate = x),
		beforeCreate: (x) => (beforeCreate = x),
		state: () =>
			JSON.parse(readFileSync(resolve(dir, "issue-pfd.json"), "utf8")),
		edit: (model = "b >> q -> c\n") =>
			writeFileSync(resolve(dir, "model.pfdsl"), model),
		snapshot: () =>
			readdirSync(dir)
				.sort()
				.map((x) => [x, readFileSync(resolve(dir, x), "utf8")]),
	};
}

test("explicit diagram GET ignores unrelated broken artifacts and validates type", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	await f.run("publish-diagram", { write: true });
	const diagram = f.records.get(2);
	f.records.set(9, {
		...structuredClone(diagram),
		artifact: { ...diagram.artifact, number: 9 },
	});
	const seen = [];
	f.onList(() => {
		throw new Error("unrelated listing failed");
	});
	f.onGet((number) => {
		seen.push(number);
		if (number === 9) throw Error("unrelated history failed");
	});
	assert.equal(
		(await f.run("status", { artifact: 1, diagram: 2 })).classification,
		"current",
	);
	assert.ok(seen.includes(2));
	assert.ok(!seen.includes(9));
	diagram.artifact.type = "generic";
	await assert.rejects(
		f.run("status", { artifact: 1, diagram: 2 }),
		/does not match/,
	);
});

for (const command of ["publish", "check", "render", "restore", "create"])
	test(`${command} rejects invalid UTF-8 before validation and publication`, async (t) => {
		const f = fixture(t);
		await f.run("pull");
		const invalid = Buffer.concat([
			Buffer.from("a >> p -> b\n# "),
			Buffer.from([255]),
			Buffer.from("\n"),
		]);
		f.edit(invalid);
		const file = resolve(f.root, "input.pfdsl");
		writeFileSync(file, invalid);
		const before = f.cliCalls.length;
		await assert.rejects(
			f.run(command, {
				write: true,
				version: 1,
				file,
				dir: command === "create" ? resolve(f.root, "new") : f.dir,
				out: resolve(f.root, "out.svg"),
			}),
			/UTF-8/,
		);
		assert.equal(f.cliCalls.length, before);
		assert.deepEqual(f.calls, []);
	});

for (const command of ["show", "render"])
	test(`${command} rejects non-regular output without replacing it`, async (t) => {
		const f = fixture(t);
		await f.run("pull");
		const fifo = resolve(f.root, "output.fifo");
		execFileSync("mkfifo", [fifo]);
		await assert.rejects(
			f.run(command, { artifact: 1, version: 1, out: fifo }),
			/regular file/,
		);
		assert.ok(statSync(fifo).isFIFO());
		await assert.rejects(
			f.run(command, { artifact: 1, version: 1, out: f.root }),
			/regular file/,
		);
	});

for (const stage of ["source", "diagram"])
	test(`unsent ${stage} launch failure is failed and retryable`, async (t) => {
		const f = fixture(t);
		await f.run("pull");
		if (stage === "source") f.edit();
		const command = stage === "source" ? "publish" : "publish-diagram";
		const fail = () => {
			throw Object.assign(Error("spawn E2BIG"), {
				unsent: true,
				code: "E2BIG",
			});
		};
		if (stage === "source") f.beforePatch(fail);
		else f.beforeCreate(fail);
		await assert.rejects(f.run(command, { write: true }), /E2BIG/);
		assert.equal(f.state().operations.at(-1).status, "failed");
		f.beforePatch(undefined);
		f.beforeCreate(undefined);
		await f.run(command, { write: true });
		assert.equal(f.state().operations.at(-1).status, "applied");
	});

test("hash uses UTF-8 model lines including LF and normalizes CRLF", () => {
	const parsed = parseSource(source("あ >> p -> b\n").replaceAll("\n", "\r\n"));
	assert.equal(parsed.model, "あ >> p -> b\n");
	assert.equal(
		modelHash(parsed.model),
		createHash("sha256").update("あ >> p -> b\n").digest("hex"),
	);
	assert.equal(modelHash("あ >> p -> b\r\n"), modelHash(parsed.model));
	assert.equal(
		parsed.prefix + parsed.model + parsed.suffix,
		source("あ >> p -> b\n"),
	);
	assert.throws(
		() => parseSource(`${source()}\`\`\`pfdsl\nx\n\`\`\`\n`),
		/exactly one/,
	);
});

test("source extraction uses top-level Markdown code blocks and preserves the original slice", () => {
	const comment = "<!--\n```pfdsl\nhidden\n```\n-->\n";
	const marker = source().split("\n")[0];
	assert.throws(() => parseSource(`${marker}\n${comment}`), /exactly one/);

	const model = "  あ >> p -> b\n\n";
	const prefix = `${marker}\n${comment}\n> \`\`\`pfdsl\n> quoted example\n> \`\`\`\n\n  ~~~~pfdsl\n`;
	const suffix = "  ~~~~~\t\nAfter\n";
	assert.deepEqual(
		{ ...parseSource(prefix + model + suffix) },
		{ sourceId: id, op: id, base: 0, prefix, model, suffix },
	);
	assert.throws(() => parseSource(prefix + model), /exactly one/);
});

test("source extraction ignores a fence swallowed by a rendered HTML comment", () => {
	const marker = source().split("\n")[0];
	const hidden = "<!-- note --> <!--\n\n```pfdsl\nhidden\n```\n\n<div> -->\n";
	assert.throws(() => parseSource(`${marker}\n${hidden}`), /exactly one/);

	const visible = `${marker}\n${hidden}\n`;
	const fenced = "```pfdsl\na >> p -> b\n```\n";
	const parsed = parseSource(visible + fenced);
	assert.equal(parsed.model, "a >> p -> b\n");
	assert.equal(parsed.prefix + parsed.model + parsed.suffix, visible + fenced);
});

test("base repair replaces its inode and preserves a hardlinked unpublished model", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	const model = resolve(f.dir, "model.pfdsl"),
		base = resolve(f.dir, "base.pfdsl");
	rmSync(base);
	linkSync(model, base);
	f.edit("draft >> p -> b\n");
	assert.equal(statSync(model).ino, statSync(base).ino);
	await f.run("status");
	assert.equal(readFileSync(model, "utf8"), "draft >> p -> b\n");
	assert.equal(readFileSync(base, "utf8"), "a >> p -> b\n");
	assert.notEqual(statSync(model).ino, statSync(base).ino);
});

for (const name of ["model.pfdsl", "base.pfdsl", "issue-pfd.json"]) {
	test(`pull never replaces ${name} created while awaiting GitHub`, async (t) => {
		const f = fixture(t);
		const path = resolve(f.dir, name),
			text = "editor-owned bytes\n";
		f.onGet(() => {
			f.onGet(undefined);
			writeFileSync(path, text, { flag: "wx" });
		});
		await assert.rejects(f.run("pull"));
		assert.equal(readFileSync(path, "utf8"), text);
	});
}

test("pull refuses nonempty directories and selects --version", async (t) => {
	const f = fixture(t);
	f.add(1, source("new >> p -> b\n"));
	await f.run("pull", { version: 1 });
	assert.equal(
		readFileSync(resolve(f.dir, "base.pfdsl"), "utf8"),
		"a >> p -> b\n",
	);
	assert.equal(f.state().base.version, 1);
	const before = f.snapshot();
	await assert.rejects(f.run("pull"), /empty/);
	assert.deepEqual(f.snapshot(), before);
});

test("conflict leaves the entire working directory unchanged", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.add(1, source("other >> p -> b\n"));
	const before = f.snapshot();
	await assert.rejects(
		f.run("publish", { write: true }),
		/Conflict.*show.*--version 2.*pull.*base.pfdsl/s,
	);
	assert.deepEqual(f.snapshot(), before);
	assert.deepEqual(f.calls, []);
});

test("step 6 detects overwritten intervening version", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.beforePatch((n) => {
		if (n === 1) f.add(1, source("other >> p -> b\n"));
	});
	await assert.rejects(
		f.run("publish", { write: true }),
		/overwrote.*v2.*--version 2/s,
	);
	assert.equal(f.records.get(1).versions.length, 3);
	assert.equal(
		readFileSync(resolve(f.dir, "base.pfdsl"), "utf8"),
		"a >> p -> b\n",
	);
});

test("pending history tolerates malformed intervening source and reports its version", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.beforePatch((n) => {
		if (n === 1) f.add(1, "Broken Markdown");
	});
	let message;
	await assert.rejects(f.run("publish", { write: true }), (error) => {
		message = error.message;
		return /overwrote.*v2/.test(message);
	});
	const command = message.match(/show (\d+) --artifact (\d+) --version (\d+)/);
	assert.ok(command);
	const recovered = await f.run("show", {
		issue: Number(command[1]),
		artifact: Number(command[2]),
		version: Number(command[3]),
	});
	assert.equal(recovered.output, "Broken Markdown");
	assert.equal(
		readFileSync(resolve(f.dir, "base.pfdsl"), "utf8"),
		"a >> p -> b\n",
	);
});

test("publish honors explicit --diagram when another diagram appears after pull", async (t) => {
	const f = fixture(t);
	await f.run("publish-diagram", { write: true });
	await f.run("pull");
	f.records.set(3, structuredClone(f.records.get(2)));
	f.records.get(3).artifact.number = 3;
	f.edit();
	await f.run("publish", { write: true, diagram: 3 });
	assert.ok(f.calls.some((x) => x[0] === "PATCH" && x[1] === 3));
	assert.equal(f.state().diagram, 3);
});

for (const outcome of ["applied", "unknown", "overwritten"]) {
	test(`operation resolves ${outcome} without resending`, async (t) => {
		const f = fixture(t);
		await f.run("pull");
		f.edit();
		if (outcome === "overwritten")
			f.beforePatch((n) => {
				if (n === 1) f.add(1, source("other >> p -> b\n"));
			});
		f.afterPatch(() => {
			throw new Error("response lost");
		});
		await assert.rejects(f.run("publish", { write: true }), /response lost/);
		assert.equal(f.state().operations.at(-1).status, "unknown");
		if (outcome === "unknown") f.records.get(1).versions.splice(0, 1);
		f.afterPatch(undefined);
		f.beforePatch(undefined);
		const count = f.calls.filter((x) => x[0] === "PATCH").length;
		if (outcome === "overwritten")
			await assert.rejects(f.run("publish", { write: true }), /overwrote/);
		else if (outcome === "unknown")
			await assert.rejects(f.run("publish", { write: true }), /unknown/i);
		else await f.run("publish", { write: true });
		assert.equal(
			f.calls.filter((x) => x[0] === "PATCH" && x[1] === 1).length,
			count,
		);
		assert.equal(
			f.state().operations[0].status,
			outcome === "overwritten" ? "overwrote" : outcome,
		);
		assert.equal(f.state().base.version, outcome === "applied" ? 2 : 1);
		assert.equal(
			readFileSync(resolve(f.dir, "base.pfdsl"), "utf8"),
			outcome === "applied" ? "b >> q -> c\n" : "a >> p -> b\n",
		);
	});
}

test("publish retry skips source PATCH and preserves prose and concurrent local edits", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.afterPatch((n) => {
		if (n === 1) f.edit("later >> p -> b\n");
	});
	f.afterCreate(() => {
		throw new Error("diagram response lost");
	});
	await assert.rejects(
		f.run("publish", { write: true }),
		/diagram response lost/,
	);
	assert.equal(f.state().base.version, 2);
	assert.equal(
		readFileSync(resolve(f.dir, "model.pfdsl"), "utf8"),
		"later >> p -> b\n",
	);
	assert.match(
		f.records.get(1).versions[0].body,
		/Notes\n```pfdsl\nb >> q -> c\n```\nAfter/,
	);
	f.edit();
	f.afterCreate(undefined);
	await f.run("publish", { write: true });
	assert.equal(f.calls.filter((x) => x[0] === "PATCH" && x[1] === 1).length, 1);
	assert.ok(f.cliCalls.every((x) => !Object.hasOwn(x.context, "basis")));
});

test("repository mismatch never writes", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.setRepo({ ...identity, repo: "elsewhere" });
	const before = f.snapshot();
	await assert.rejects(f.run("publish", { write: true }), /repository/i);
	assert.deepEqual(f.calls, []);
	assert.deepEqual(f.snapshot(), before);
});

test("newer diagram is never replaced by an older version", async (t) => {
	const f = fixture(t);
	f.add(1, source("new >> p -> b\n"));
	await f.run("publish-diagram", { write: true });
	const body = f.records.get(2).versions[0].body;
	await f.run("publish-diagram", { version: 1, write: true });
	assert.equal(f.records.get(2).versions[0].body, body);
	assert.equal(f.calls.length, 1);
});

test("invalid published model gets a stamped failed notice; publish refuses it", async (t) => {
	const f = fixture(t);
	f.setInvalid();
	await f.run("publish-diagram", { write: true });
	const body = f.records.get(2).versions[0].body;
	assert.equal(readStamp(body).result, "failed");
	assert.match(body, /Invalid model/);
	assert.doesNotMatch(body, /<svg/);
	await f.run("pull");
	await assert.rejects(f.run("publish", { write: true }), /Invalid model/);
	assert.equal(f.calls.length, 1);
});

test("status distinguishes missing current current-model stale failed", async (t) => {
	const f = fixture(t);
	assert.equal((await f.run("status")).classification, "missing");
	await f.run("publish-diagram", { write: true });
	assert.equal((await f.run("status")).classification, "current");
	const originalDiagram = f.records.get(2).versions[0].body;
	f.records.get(2).versions[0].body = originalDiagram.replaceAll(
		readStamp(originalDiagram).sourceBodySha256,
		"0".repeat(64),
	);
	assert.equal((await f.run("status")).classification, "stale");
	f.records.get(2).versions[0].body = originalDiagram;
	f.add(1, source(undefined, "Changed prose\n"));
	assert.equal((await f.run("status")).classification, "current-model");
	f.add(1, source("new >> p -> b\n"));
	const stale = await f.run("status");
	assert.equal(stale.classification, "stale");
	assert.equal(stale.sourceVersion, 3);
	assert.equal(stale.diagramVersion, 1);
	f.setInvalid();
	await f.run("publish-diagram", { write: true });
	assert.equal((await f.run("status")).classification, "failed");
});

test("dry runs do not write GitHub or local state", async (t) => {
	const f = fixture(t);
	const file = resolve(f.root, "input.pfdsl");
	writeFileSync(file, "a >> p -> b\n");
	await f.run("create", { file });
	assert.deepEqual(readdirSync(f.root), ["input.pfdsl"]);
	await f.run("publish-diagram");
	assert.deepEqual(f.calls, []);
	await f.run("pull");
	f.edit();
	const before = f.snapshot();
	await f.run("publish");
	assert.deepEqual(f.snapshot(), before);
	assert.deepEqual(f.calls, []);
});

for (const stage of ["source", "diagram"]) {
	test(`create resumes after lost ${stage} response using sourceId`, async (t) => {
		const f = fixture(t);
		const file = resolve(f.root, "input.pfdsl");
		writeFileSync(file, "a >> p -> b\n");
		f.afterCreate((n) => {
			if (n === (stage === "source" ? 2 : 3)) throw new Error("response lost");
		});
		await assert.rejects(
			f.run("create", { file, write: true }),
			/response lost/,
		);
		assert.equal(f.state().operations.at(-1).kind, "create");
		f.afterCreate(undefined);
		await f.run("create", { file, write: true });
		assert.equal(f.calls.length, 2);
		assert.ok(f.state().operations.every((op) => op.status === "applied"));
		assert.equal(f.state().artifact, 2);
	});
}

test("create with unknown result and no matching marker stops without duplicate POST", async (t) => {
	const f = fixture(t);
	const file = resolve(f.root, "input.pfdsl");
	writeFileSync(file, "a >> p -> b\n");
	f.afterCreate((n) => {
		f.records.delete(n);
		throw new Error("response lost");
	});
	await assert.rejects(f.run("create", { file, write: true }), /response lost/);
	await assert.rejects(
		f.run("create", { file, write: true }),
		/unknown.*not.*recreat/i,
	);
	assert.equal(f.calls.length, 1);
});

test("diagram stamp round trips and diagnostics are escaped", () => {
	const stamp = {
		schema: 2,
		sourceId: id,
		sourceArtifact: 1,
		sourceVersion: 2,
		sourceBodySha256: modelHash("source\n"),
		modelSha256: modelHash("x\n"),
		result: "failed",
		cliVersion: "1",
		generatedAt: "now",
	};
	const body = diagramBody(stamp, "<script>bad</script>");
	assert.deepEqual(readStamp(body), stamp);
	assert.doesNotMatch(body, /<script>/);
	assert.match(body, /&lt;script&gt;/);
});

test("create and publish preserve literal Markdown fences inside a valid PFD", async (t) => {
	const f = fixture(t);
	const file = resolve(f.root, "input.pfdsl");
	const model = "---\ntitle: |\n  ```\n---\na >> p -> b\n";
	writeFileSync(file, model);
	await f.run("create", { file, write: true });
	assert.equal(parseSource(f.records.get(2).versions[0].body).model, model);
	const edited = model.replace("  ```", "  ``````");
	f.edit(edited);
	await f.run("publish", { write: true });
	assert.equal(parseSource(f.records.get(2).versions[0].body).model, edited);
});

test("operation identity chooses the oldest occurrence when the same body appears twice", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.afterPatch((n, body) => {
		if (n === 1) {
			f.add(1, body);
			throw new Error("response lost");
		}
	});
	await assert.rejects(f.run("publish", { write: true }), /response lost/);
	f.afterPatch(undefined);
	await f.run("status");
	assert.equal(f.state().base.version, 2);
	assert.equal(f.state().operations[0].status, "applied");
});

test("operation identity does not mistake another writer's identical model for its own write", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.beforePatch((n, body) => {
		if (n === 1) f.add(1, body.replace(/op=[0-9a-f-]+/, `op=${id}`));
	});
	await assert.rejects(f.run("publish", { write: true }), /overwrote.*v2/);
	assert.equal(f.state().operations[0].overwrittenVersion, 2);
});

test("unchanged source preserves authored long fences and skips source PATCH", async (t) => {
	const f = fixture(t);
	f.records.get(1).versions[0].body = source().replaceAll("```", "````");
	await f.run("pull");
	await f.run("publish", { write: true });
	assert.equal(f.calls.filter((x) => x[0] === "PATCH" && x[1] === 1).length, 0);
});

test("unknown survives a recovery read before the delayed PATCH appears and status resolves it", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	let sent;
	f.beforePatch((n, body) => {
		if (n === 1) {
			sent = body;
			throw new Error("timeout");
		}
	});
	await assert.rejects(f.run("publish", { write: true }), /timeout/);
	f.beforePatch(undefined);
	f.onGet((n) => {
		if (n === 1) {
			f.onGet(undefined);
			f.add(1, sent);
		}
	});
	await assert.rejects(f.run("publish", { write: true }), /unknown/i);
	assert.equal(f.state().operations[0].status, "unknown");
	const result = await f.run("status");
	assert.equal(f.state().operations[0].status, "applied");
	assert.equal(f.state().base.version, 2);
	assert.equal(result.operations[0].status, "applied");
	assert.equal(f.calls.filter((x) => x[0] === "PATCH").length, 1);
});

test("abandoned operations remain in history and report late overwrites", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	let sent;
	f.beforePatch((n, body) => {
		if (n === 1) {
			sent = body;
			throw new Error("timeout");
		}
	});
	await assert.rejects(f.run("publish", { write: true }), /timeout/);
	f.beforePatch(undefined);
	const op = f.state().operations[0].id;
	await f.run("resolve", { abandon: op });
	assert.equal(f.state().operations[0].abandoned, true);
	f.add(1, source("other >> p -> b\n"));
	f.add(1, sent);
	const result = await f.run("status");
	assert.equal(result.operations[0].status, "overwrote");
	assert.equal(result.operations[0].overwrittenVersion, 2);
	assert.equal(f.state().base.version, 1);
});

test("only definite 4xx rejection becomes failed and permits a new operation", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.beforePatch(() => {
		throw Object.assign(new Error("rejected"), { httpStatus: 422 });
	});
	await assert.rejects(f.run("publish", { write: true }), /rejected/);
	assert.equal(f.state().operations[0].status, "failed");
	f.beforePatch(undefined);
	await f.run("publish", { write: true });
	const operations = f.state().operations.filter((op) => op.stage === "source");
	assert.equal(operations.length, 2);
	assert.equal(operations[1].status, "applied");
});

test("a second edit can undo the last addition using the atomically promoted base", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	await f.run("publish", { write: true });
	f.edit("a >> p -> b\n");
	writeFileSync(resolve(f.dir, "base.pfdsl"), "corrupted viewer copy\n");
	await f.run("publish", { write: true });
	assert.equal(f.state().base.version, 3);
	assert.equal(parseSource(f.state().base.body).model, "a >> p -> b\n");
	assert.equal(
		f.state().base.sourceBodySha256,
		createHash("sha256").update(f.state().base.body).digest("hex"),
	);
	assert.equal(
		readFileSync(resolve(f.dir, "base.pfdsl"), "utf8"),
		"a >> p -> b\n",
	);
	assert.equal(
		f.state().operations.filter((op) => op.stage === "source")[1].baseVersion,
		2,
	);
});

for (const broken of ["fence", "marker"]) {
	test(`broken ${broken} produces invalid-source with full-body identity and last good version`, async (t) => {
		const f = fixture(t);
		await f.run("publish-diagram", { write: true });
		const body =
			broken === "fence"
				? source().replace("```pfdsl", "```text")
				: source().replace("pfdsl:issue-pfd source", "broken source");
		f.add(1, body);
		assert.equal((await f.run("status")).classification, "invalid-source");
		await f.run("publish-diagram", { write: true });
		const html = f.records.get(2).versions[0].body;
		const stamp = readStamp(html);
		assert.equal(stamp.result, "invalid-source");
		assert.equal(stamp.sourceVersion, 2);
		assert.equal(
			stamp.sourceBodySha256,
			createHash("sha256").update(body).digest("hex"),
		);
		assert.equal(Object.hasOwn(stamp, "modelSha256"), false);
		assert.match(html, /Generated from source v2/);
		assert.match(html, /https:\/\/github.com\/o\/r\/issues\/7\/artifacts\/1/);
		assert.equal((await f.run("status")).lastGoodVersion, 1);
	});
}

test("status checks actual SVG bytes and rejects a diagram with only SVG removed", async (t) => {
	const f = fixture(t);
	await f.run("publish-diagram", { write: true });
	const stamp = readStamp(f.records.get(2).versions[0].body);
	assert.equal(
		stamp.svgSha256,
		createHash("sha256").update("<svg></svg>").digest("hex"),
	);
	f.records.get(2).versions[0].body = f.records
		.get(2)
		.versions[0].body.replace("<svg></svg>", "");
	assert.equal((await f.run("status")).classification, "stale");
});

test("publish-diagram preserves and verifies SVG with a self-closing title", async (t) => {
	const f = fixture(t);
	const svg = "<svg><title/></svg>";
	f.setSvg(svg);
	const published = await f.run("publish-diagram", { write: true });
	assert.equal(published.result, "rendered");
	assert.equal(
		published.svgSha256,
		createHash("sha256").update(svg).digest("hex"),
	);
	assert.ok(f.records.get(2).versions[0].body.includes(svg));
	assert.equal((await f.run("status")).classification, "current");
});

test("status returns changed-during-check when source changes while reading diagram", async (t) => {
	const f = fixture(t);
	await f.run("publish-diagram", { write: true });
	f.onGet((n) => {
		if (n === 2) {
			f.onGet(undefined);
			f.add(1, source("new >> p -> b\n"));
		}
	});
	assert.equal((await f.run("status")).classification, "changed-during-check");
});

test("unavailable source never reports an old diagram as current", async (t) => {
	const f = fixture(t);
	await f.run("publish-diagram", { write: true });
	f.onGet((n) => {
		if (n === 1) throw new Error("offline");
	});
	const result = await f.run("status");
	assert.equal(result.classification, "unavailable");
	assert.match(result.diagnostic, /offline/);
});

test("status distinguishes source selection from a read failure with the same diagnostic", async (t) => {
	const f = fixture(t);
	const message =
		"No PFD source identity in artifact history; select --artifact with an existing PFD source";
	const options = { artifact: 1 };
	f.onGet(() => {
		throw new Error(message);
	});
	assert.deepEqual(await f.run("status", options), {
		classification: "unavailable",
		diagnostic: message,
	});

	f.onGet(undefined);
	f.records.get(1).versions[0].body = "A regular artifact";
	await assert.rejects(f.run("status", options), {
		code: "ISSUE_PFD_SOURCE_SELECTION",
		message,
	});
	await assert.rejects(f.run("status"), /Found 0 source artifacts/);
});

test("directory lock reports its owner and prevents concurrent write operations", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	const before = f.snapshot();
	const lock = resolve(f.dir, ".issue-pfd.lock");
	writeFileSync(lock, JSON.stringify({ pid: 12345, command: "publish" }));
	await assert.rejects(f.run("publish", { write: true }), /lock.*12345/i);
	assert.deepEqual(f.calls, []);
	assert.ok(existsSync(lock));
	assert.deepEqual(
		f.snapshot().filter(([name]) => name !== ".issue-pfd.lock"),
		before,
	);
});

test("restore publishes historical prose and model as a new operation based on the current version", async (t) => {
	const f = fixture(t);
	f.add(1, source("new >> p -> b\n", "New prose\n"));
	await f.run("pull");
	const before = f.snapshot();
	await f.run("restore", { version: 1 });
	assert.deepEqual(f.snapshot(), before);
	await f.run("restore", { version: 1, write: true });
	assert.equal(f.state().base.version, 3);
	assert.equal(f.state().operations[0].kind, "restore");
	assert.equal(f.state().operations[0].baseVersion, 2);
	assert.equal(parseSource(f.state().base.body).model, "a >> p -> b\n");
	assert.match(f.state().base.body, /Notes/);
	assert.equal(
		readFileSync(resolve(f.dir, "model.pfdsl"), "utf8"),
		"new >> p -> b\n",
	);
	assert.equal(f.state().retired, true);
	const sourceWrites = f.calls.filter(
		(x) => x[0] === "PATCH" && x[1] === 1,
	).length;
	const callsBeforePublish = structuredClone(f.calls);
	await assert.rejects(f.run("publish", { write: true }), /retired.*pull/i);
	assert.deepEqual(f.calls, callsBeforePublish);
	assert.equal(
		f.calls.filter((x) => x[0] === "PATCH" && x[1] === 1).length,
		sourceWrites,
	);
});

test("dirty restore refuses all writes and asks to save unpublished edits", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	const before = f.snapshot();
	for (const write of [false, true])
		await assert.rejects(
			f.run("restore", { version: 1, write }),
			/unpublished.*save|save.*unpublished/i,
		);
	assert.deepEqual(f.calls, []);
	assert.deepEqual(f.snapshot(), before);
});

test("restore preserves edits made while the request is running", async (t) => {
	const f = fixture(t);
	f.add(1, source("b >> p -> c\n"));
	await f.run("pull");
	f.afterPatch((n) => {
		if (n === 1) f.edit("concurrent >> p -> edit\n");
	});
	await f.run("restore", { version: 1, write: true });
	assert.equal(
		readFileSync(resolve(f.dir, "model.pfdsl"), "utf8"),
		"concurrent >> p -> edit\n",
	);
	assert.equal(parseSource(f.state().base.body).model, "a >> p -> b\n");
});

test("restore can repair a broken current source using its current version as base", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.add(1, "Broken source with no fence\n");
	await f.run("restore", { version: 1, write: true });
	assert.equal(f.state().base.version, 3);
	assert.equal(f.state().operations[0].baseVersion, 2);
	assert.equal(parseSource(f.state().base.body).model, "a >> p -> b\n");
});

test("diagram readback 404 after accepted POST remains unknown until reconciled", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.onGet((n) => {
		if (n === 2)
			throw Object.assign(new Error("readback unavailable"), {
				httpStatus: 404,
			});
	});
	await assert.rejects(
		f.run("publish", { write: true }),
		/readback unavailable/,
	);
	assert.equal(f.state().operations.at(-1).status, "unknown");
	f.onGet(undefined);
	await f.run("publish", { write: true });
	assert.equal(f.state().operations.at(-1).status, "applied");
	assert.equal(f.calls.filter((x) => x[0] === "POST").length, 1);
});

test("server errors remain unknown and retain the sent operation body", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.beforePatch(() => {
		throw Object.assign(new Error("server error"), { httpStatus: 500 });
	});
	await assert.rejects(f.run("publish", { write: true }), /server error/);
	const op = f.state().operations[0];
	assert.equal(op.status, "unknown");
	assert.equal(parseSource(op.body).op, op.id);
	assert.equal(parseSource(op.body).model, "b >> q -> c\n");
	f.beforePatch(undefined);
	await assert.rejects(f.run("publish", { write: true }), /unknown/i);
	assert.equal(f.calls.filter((x) => x[0] === "PATCH").length, 1);
});

test("lost existing diagram PATCH is recorded and reconciled without another source publication", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	await f.run("publish", { write: true });
	f.edit("c >> p -> d\n");
	f.afterPatch((n) => {
		if (n === 2) throw new Error("diagram timeout");
	});
	await assert.rejects(f.run("publish", { write: true }), /diagram timeout/);
	assert.equal(f.state().operations.at(-1).stage, "diagram");
	assert.equal(f.state().operations.at(-1).status, "unknown");
	f.afterPatch(undefined);
	await f.run("publish", { write: true });
	assert.equal(
		f.state().operations.filter((op) => op.stage === "source").length,
		2,
	);
	assert.ok(f.state().operations.every((op) => op.status === "applied"));
});

test("diagram PATCH absent from history does not block a new source and becomes superseded", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	await f.run("publish", { write: true });
	f.edit("c >> p -> d\n");
	f.beforePatch((n) => {
		if (n === 2) throw new Error("diagram timeout before acceptance");
	});
	await assert.rejects(f.run("publish", { write: true }), /diagram timeout/);
	const unknown = f.state().operations.at(-1);
	assert.equal(unknown.status, "unknown");
	assert.ok(!f.records.get(2).versions.some((v) => v.body === unknown.body));
	f.beforePatch(undefined);
	f.edit("d >> p -> e\n");
	await f.run("publish", { write: true });
	assert.equal(f.state().base.version, 4);
	const result = await f.run("status");
	assert.equal(
		result.operations.find((op) => op.id === unknown.id).status,
		"superseded",
	);
	const closed = f.state().operations.find((op) => op.id === unknown.id);
	assert.equal(closed.body, undefined);
	assert.equal(
		closed.bodySha256,
		createHash("sha256").update(unknown.body).digest("hex"),
	);
	assert.ok(closed.artifact);
	assert.ok(closed.version);
});

test("regenerated diagram closes unknown PATCH using the current source stamp", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	await f.run("publish", { write: true });
	f.edit("c >> p -> d\n");
	f.beforePatch((n) => {
		if (n === 2) throw new Error("not in history");
	});
	await assert.rejects(f.run("publish", { write: true }), /not in history/);
	const unknown = f.state().operations.at(-1);
	f.beforePatch(undefined);
	await f.run("publish-diagram", { write: true });
	assert.equal(
		f.state().operations.find((op) => op.id === unknown.id).status,
		"applied",
	);
	assert.equal(
		f.state().operations.filter((op) => op.stage === "source").length,
		2,
	);
});

test("unknown diagram create prevents duplicate POST but permits a new source", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	f.beforeCreate((type) => {
		if (type === "embedded_html") throw new Error("unobserved diagram create");
	});
	await assert.rejects(f.run("publish", { write: true }), /unobserved/);
	f.beforeCreate(undefined);
	f.edit("c >> p -> d\n");
	await assert.rejects(
		f.run("publish", { write: true }),
		/diagram.*unknown.*status.*publish-diagram/i,
	);
	assert.equal(f.state().base.version, 3);
	await assert.rejects(
		f.run("publish-diagram", { write: true }),
		/diagram.*unknown/i,
	);
	assert.equal(f.calls.filter((x) => x[0] === "POST").length, 1);
	await f.run("publish-diagram", { dir: undefined, write: true });
	const result = await f.run("status");
	assert.equal(
		result.operations.find((op) => op.stage === "diagram").status,
		"superseded",
	);
});

for (const field of ["modelSha256", "sourceBodySha256", "svgSha256"]) {
	test(`status rejects a corrupted ${field} stamp`, async (t) => {
		const f = fixture(t);
		await f.run("publish-diagram", { write: true });
		const html = f.records.get(2).versions[0].body;
		f.records.get(2).versions[0].body = html.replaceAll(
			readStamp(html)[field],
			"0".repeat(64),
		);
		assert.equal((await f.run("status")).classification, "stale");
	});
}

test("lastGoodVersion ignores rendered history with a broken SVG", async (t) => {
	const f = fixture(t);
	await f.run("publish-diagram", { write: true });
	f.add(1, source("b >> p -> c\n"));
	await f.run("publish-diagram", { write: true });
	f.records.get(2).versions[0].body = f.records
		.get(2)
		.versions[0].body.replace("<svg></svg>", "<svg>corrupted</svg>");
	f.add(1, "Broken source\n");
	assert.equal((await f.run("status")).lastGoodVersion, 1);
});

test("show retrieves malformed historical raw bytes without parsing", async (t) => {
	const f = fixture(t);
	const body = "broken marker\r\n```pfdsl\r\nno closing fence\r\n";
	f.add(1, body);
	const result = await f.run("show", { artifact: 1, version: 2 });
	assert.equal(result.output, body);
	const out = resolve(f.root, "overwritten.md");
	await f.run("show", { artifact: 1, version: 2, out });
	assert.equal(readFileSync(out, "utf8"), body);
	assert.deepEqual(f.calls, []);
});

for (const command of ["status", "publish-diagram"]) {
	test(`${command} requires state when dir is explicit`, async (t) => {
		const f = fixture(t);
		await assert.rejects(
			f.run(command, { dir: f.dir, write: command === "publish-diagram" }),
			/state.*missing|issue-pfd.json/i,
		);
		assert.deepEqual(f.calls, []);
		assert.ok(!existsSync(f.dir));
	});
}

test("unavailable create is failed unsent and retries in the same directory", async (t) => {
	const f = fixture(t);
	const file = resolve(f.root, "model.pfdsl");
	writeFileSync(file, "a >> p -> b\n");
	f.beforeCreate(() => {
		throw new GitHubUnavailableError("createArtifact");
	});
	await assert.rejects(
		f.run("create", { file, write: true }),
		(error) => error instanceof GitHubUnavailableError,
	);
	assert.equal(f.state().operations[0].status, "failed");
	f.beforeCreate(undefined);
	await f.run("create", { file, write: true });
	assert.ok(f.state().base);
	assert.equal(
		f
			.state()
			.operations.filter(
				(op) => op.stage === "source" && op.status === "applied",
			).length,
		1,
	);
});

test("terminal operations discard bodies while unresolved and overwritten sources retain evidence", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	await f.run("publish", { write: true });
	for (const op of f.state().operations) {
		assert.equal(op.body, undefined);
		assert.equal(
			op.bodySha256,
			createHash("sha256")
				.update(
					f.records
						.get(op.artifact)
						.versions.find((v) => v.version === op.version).body,
				)
				.digest("hex"),
		);
		assert.ok(op.artifact);
		assert.ok(op.version);
	}
	f.edit("c >> p -> d\n");
	f.beforePatch((n, body) => {
		if (n === 1) f.add(1, body.replace(/op=[0-9a-f-]+/, `op=${id}`));
	});
	await assert.rejects(f.run("publish", { write: true }), /overwrote/);
	assert.equal(typeof f.state().operations.at(-1).body, "string");
});

test("status with terminal operations does not serialize unchanged state", async (t) => {
	const f = fixture(t);
	await f.run("pull");
	f.edit();
	await f.run("publish", { write: true });
	const stringify = JSON.stringify;
	let serializations = 0;
	JSON.stringify = (value, ...args) => {
		if (value?.schema === 2 && Array.isArray(value.operations))
			serializations++;
		return stringify(value, ...args);
	};
	try {
		await f.run("status");
		assert.equal(serializations, 0);
	} finally {
		JSON.stringify = stringify;
	}
});

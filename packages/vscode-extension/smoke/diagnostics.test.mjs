import assert from "node:assert/strict";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { bestEffort, startCloseTrace } from "./close-trace.mjs";
import { preserveSmokeEvidence } from "./evidence.mjs";
import { createRunDirectory } from "./harness.mjs";
import { instrumentSource } from "./instrument.mjs";
import {
	cleanupSmokeSession,
	closeSourceTab,
	withWorkbenchOperation,
} from "./run.mjs";

test("diagnostic start, stop and transport failures do not retry or replace close", async () => {
	for (const step of ["start", "stop", "finish"]) {
		let clicks = 0;
		const result = await closeSourceTab(
			{},
			{
				getByRole: () => ({
					click: async () => {
						clicks++;
					},
				}),
			},
			{
				log: () => {},
				readState: async () => ({ sourceTabs: 0, previewTabs: 1, groups: 1 }),
				diagnostics: {
					start: async () => {
						if (step === "start") throw Error(step);
						return {
							stop: () => {
								throw Error("stop");
							},
						};
					},
					finish: async () => {
						if (step === "finish") throw Error(step);
					},
				},
			},
		);
		assert.equal(clicks, 1);
		assert.equal(result.sourceTabs, 0);
	}
});

test("a stalled diagnostic is bounded and leaves no timer", async () => {
	assert.deepEqual(await bestEffort(() => new Promise(() => {}), 1), {
		unavailable: "diagnostic deadline exceeded",
	});
});

test("all ten production source-open sites have deterministic provenance", async () => {
	const counts = {
		"preview.ts": 5,
		"def-insertion.ts": 1,
		"document-link.ts": 2,
		"hover.ts": 2,
	};
	for (const [name, count] of Object.entries(counts)) {
		const original = await readFile(
			new URL(`../src/${name}`, import.meta.url),
			"utf8",
		);
		const transformed = instrumentSource(original, `src/${name}`);
		assert.equal(transformed.sites.length, count);
		assert.equal(
			transformed.contents.includes("vscode.window.showTextDocument("),
			false,
		);
		for (const site of transformed.sites)
			assert.ok(transformed.contents.includes(JSON.stringify(site)));
	}
});

async function makeRuntime(api) {
	const code = await readFile(
		new URL("./trace-runtime.cjs", import.meta.url),
		"utf8",
	);
	const require = createRequire(import.meta.url);
	const module = { exports: {} };
	vm.runInNewContext(code, {
		module,
		process: { env: {} },
		require: (name) => (name === "vscode" ? api : require(name)),
	});
	return module.exports.makeTrace;
}

test("source-open tracing preserves receiver, original thenable, rejection and synchronous error", async () => {
	const original = Error("open failed");
	const api = {
		window: {
			showTextDocument() {
				assert.equal(this, api.window);
				return promise;
			},
		},
	};
	let promise = Promise.resolve({
		viewColumn: 2,
		document: { uri: { toString: () => "file:///fixture" }, isDirty: false },
	});
	const trace = (await makeRuntime(api))(api, 2);
	assert.equal(trace.show("source:1", {}), promise);
	await promise;
	assert.equal(trace.snapshot().events.at(-1).kind, "show.resolved");
	promise = Promise.reject(original);
	assert.equal(trace.show("source:2", {}), promise);
	await assert.rejects(promise, (error) => error === original);
	api.window.showTextDocument = () => {
		throw original;
	};
	assert.throws(
		() => trace.show("source:3", {}),
		(error) => error === original,
	);
	assert.ok(trace.snapshot().dropped > 0);
	assert.equal(trace.snapshot().events.length, 2);
});

test("renderer trace observes physical groups, close hit and rapid removal/reopen; then detaches", async () => {
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM(
		'<div class="editor-group-container"><div role="tab" aria-label="source, Editor Group 2"><button role="button" aria-label="Close (source)">x</button></div></div><div class="editor-group-container"><div role="tab" aria-label="PFDSL Preview, Editor Group 2"></div></div>',
		{ runScripts: "outside-only" },
	);
	const { window } = dom;
	const button = window.document.querySelector("button");
	window.document.elementFromPoint = () => button;
	const evaluate = (fn, ...args) => window.eval(`(${fn.toString()})`)(...args);
	const trace = await startCloseTrace(
		{ evaluate: (fn, arg) => evaluate(fn, arg) },
		{ getByRole: () => ({ evaluate: (fn, arg) => evaluate(fn, button, arg) }) },
	);
	button.dispatchEvent(
		new window.MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
	);
	const tab = button.parentElement,
		group = tab.parentElement;
	group.removeChild(tab);
	group.append(tab);
	await new Promise((resolve) => setImmediate(resolve));
	const result = await trace.stop();
	assert.equal(
		result.events.find((event) => event.kind === "click").value.closeTarget,
		true,
	);
	assert.notEqual(
		result.events[0].value.groups[0].id,
		result.events[0].value.groups[1].id,
	);
	assert.ok(result.events.some((event) => event.kind === "removedNodes"));
	assert.ok(result.events.some((event) => event.kind === "addedNodes"));
	assert.equal(window.__pfdslCloseTraces, undefined);
	window.close();
});

test("failure evidence survives cleanup while the issued run directory is removed", async () => {
	const runDir = await createRunDirectory();
	const destination = await mkdtemp(
		join(tmpdir(), "pfdsl-smoke-evidence-test-"),
	);
	try {
		await mkdir(join(runDir, "profile/logs"), { recursive: true });
		await writeFile(
			join(runDir, "fixture.pfdsl"),
			"source >> process -> result\n",
		);
		await writeFile(join(runDir, "profile/logs/exthost.log"), "last event\n");
		await preserveSmokeEvidence(runDir, destination);
		assert.deepEqual(
			await cleanupSmokeSession({ runDir, evidenceDirectory: destination }),
			[],
		);
		await assert.rejects(access(runDir));
		assert.equal(
			await readFile(join(destination, "profile/logs/exthost.log"), "utf8"),
			"last event\n",
		);
		assert.equal(
			await readFile(join(destination, "fixture.pfdsl"), "utf8"),
			"source >> process -> result\n",
		);
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

test("an empty opt-out destination preserves failure evidence before cleanup", async () => {
	const runDir = await createRunDirectory();
	let destination;
	try {
		await writeFile(join(runDir, "fixture.pfdsl"), "failed smoke evidence\n");
		destination = await preserveSmokeEvidence(runDir, "");
		assert.ok(destination);
		assert.deepEqual(
			await cleanupSmokeSession({ runDir, evidenceDirectory: destination }),
			[],
		);
		await assert.rejects(access(runDir));
		assert.equal(
			await readFile(join(destination, "fixture.pfdsl"), "utf8"),
			"failed smoke evidence\n",
		);
	} finally {
		await rm(runDir, { recursive: true, force: true });
		if (destination) await rm(destination, { recursive: true, force: true });
	}
});

test("a failing diagnostic logger cannot prevent an operation or replace its result", async () => {
	let calls = 0;
	const result = await withWorkbenchOperation(
		{},
		"close",
		async () => {
			calls++;
			return "closed";
		},
		{
			readState: async () => ({}),
			log: () => {
				throw new Error("sink failed");
			},
		},
	);
	assert.equal(calls, 1);
	assert.equal(result, "closed");
});

test("a failing diagnostic logger preserves the original operation error", async () => {
	const original = new Error("click failed");
	await assert.rejects(
		withWorkbenchOperation(
			{},
			"close",
			async () => {
				throw original;
			},
			{
				readState: async () => ({}),
				log: () => {
					throw new Error("sink failed");
				},
			},
		),
		(error) => error.cause === original,
	);
});

test("a trace installed after its deadline is detached without retrying close", async () => {
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM(
		'<div class="editor-group-container"><div role="tab"><button>close</button></div></div>',
		{ runScripts: "outside-only" },
	);
	const { window } = dom;
	const button = window.document.querySelector("button");
	const evaluate = (fn, ...args) => window.eval(`(${fn.toString()})`)(...args);
	let clicks = 0;
	let resolveEvaluation;
	const delayed = new Promise((resolve) => {
		resolveEvaluation = resolve;
	});
	const page = { evaluate: (fn, arg) => evaluate(fn, arg) };
	const source = {
		getByRole: () => ({
			evaluate: async (fn, arg) => {
				await delayed;
				return evaluate(fn, button, arg);
			},
			click: async () => {
				clicks++;
			},
		}),
	};
	try {
		const result = await closeSourceTab(page, source, {
			log: () => {},
			readState: async () => ({ sourceTabs: 0, previewTabs: 1, groups: 1 }),
			diagnostics: {
				finish: async (data) => {
					assert.equal(data.dom.unavailable, "diagnostic deadline exceeded");
				},
			},
		});
		assert.equal(result.sourceTabs, 0);
		assert.equal(clicks, 1);
		resolveEvaluation();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(window.__pfdslCloseTraces, undefined);
	} finally {
		window.close();
	}
});

test("slow evidence preservation completes before its source can be removed", async () => {
	const runDir = await createRunDirectory();
	const destination = await mkdtemp(
		join(tmpdir(), "pfdsl-evidence-slow-test-"),
	);
	await writeFile(join(runDir, "fixture.pfdsl"), "preserve me\n");
	try {
		const preserved = await bestEffort(async () => {
			await new Promise((resolve) => setTimeout(resolve, 1_100));
			return preserveSmokeEvidence(runDir, destination);
		}, null);
		assert.equal(preserved, destination);
		assert.deepEqual(
			await cleanupSmokeSession({ runDir, evidenceDirectory: preserved }),
			[],
		);
		assert.equal(
			await readFile(join(destination, "fixture.pfdsl"), "utf8"),
			"preserve me\n",
		);
		await assert.rejects(access(runDir));
	} finally {
		await rm(destination, { recursive: true, force: true });
	}
});

test("failed preservation closes the owned browser and retains the issued fixture", async () => {
	const runDir = await createRunDirectory();
	await writeFile(join(runDir, "fixture.pfdsl"), "unsaved evidence\n");
	let closed = 0;
	try {
		const errors = await cleanupSmokeSession({
			runDir,
			browser: {
				close: async () => {
					closed++;
				},
			},
			evidenceDirectory: "/unused",
			preserveEvidence: async () => {
				throw new Error("copy failed");
			},
		});
		assert.equal(closed, 1);
		assert.match(errors[0].message, /copy failed/);
		assert.ok(errors.some((error) => error.message.includes(runDir)));
		assert.equal(
			await readFile(join(runDir, "fixture.pfdsl"), "utf8"),
			"unsaved evidence\n",
		);
	} finally {
		await rm(runDir, { recursive: true, force: true });
	}
});

test("overlapping traces detach their own listeners and keep the other trace", async () => {
	const { JSDOM } = await import("jsdom");
	const dom = new JSDOM(
		'<div class="editor-group-container"><div role="tab"><button>close</button></div></div>',
		{ runScripts: "outside-only" },
	);
	const { window } = dom;
	const button = window.document.querySelector("button");
	window.document.elementFromPoint = () => button;
	const evaluate = (fn, ...args) => window.eval(`(${fn.toString()})`)(...args);
	const page = { evaluate: (fn, arg) => evaluate(fn, arg) };
	let release;
	const delayed = new Promise((resolve) => {
		release = resolve;
	});
	const latePending = startCloseTrace(page, {
		getByRole: () => ({
			evaluate: async (fn, arg) => {
				await delayed;
				return evaluate(fn, button, arg);
			},
		}),
	});
	try {
		const current = await startCloseTrace(page, {
			getByRole: () => ({ evaluate: (fn, arg) => evaluate(fn, button, arg) }),
		});
		release();
		const late = await latePending;
		await late.stop();
		assert.equal(window.__pfdslCloseTraces.size, 1);
		button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		const result = await current.stop();
		assert.ok(result.events.some((event) => event.kind === "click"));
		assert.equal(window.__pfdslCloseTraces, undefined);
	} finally {
		window.close();
	}
});

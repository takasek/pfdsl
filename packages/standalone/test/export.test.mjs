import assert from "node:assert/strict";
import test from "node:test";
import { createExportRun } from "../src/export-run.ts";

test("export captures unsaved source once, preserves partial results and releases the selected capability", async () => {
	const events = [],
		results = [];
	let source = "unsaved",
		available = true,
		finish;
	const run = createExportRun({
		snapshot: async () => {
			events.push(source);
			return { dot: source, tsv: "metadata", warnings: ["preset"] };
		},
		available: () => available,
		choose: async () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
		convert: async (format, sources) => {
			if (format === "pdf") throw new Error("PDF failed");
			return new TextEncoder().encode(sources.dot);
		},
		write: async (_id, format) => {
			if (format === "png") throw new Error("disk full");
			events.push(format);
			return `/chosen/a.${format}`;
		},
		release: async (id) => events.push(["release", id]),
		show: (value) => results.push(value),
	});
	const pending = run.run(["dot", "svg", "pdf", "png", "tsv"]);
	await new Promise((resolve) => setImmediate(resolve));
	source = "new editor text";
	finish({ id: 3 });
	await pending;
	assert.equal(events[0], "unsaved");
	assert.equal(results.at(-1).filter((r) => r.status === "saved").length, 3);
	assert.deepEqual(events.at(-1), ["release", 3]);
	const late = run.run(["dot"]);
	await new Promise((resolve) => setImmediate(resolve));
	available = false;
	finish({ id: 4 });
	await late;
	assert.deepEqual(events.at(-1), ["release", 4]);
	assert.equal(results.length, 1);
});

test("switching tabs after saving begins retains all format results", async () => {
	let next,
		result,
		available = true;
	const run = createExportRun({
		snapshot: async () => ({ dot: "source", tsv: "metadata", warnings: [] }),
		available: () => available,
		choose: async () => ({ id: 1 }),
		convert: async () =>
			new Promise((resolve) => {
				next = resolve;
			}),
		write: async () => "/saved.dot",
		release: async () => {},
		show: (value) => {
			result = value;
		},
	});
	const pending = run.run(["dot"]);
	await new Promise((resolve) => setImmediate(resolve));
	run.cancelPending();
	available = false;
	next(new Uint8Array());
	await pending;
	assert.equal(result[0].savedPath, "/saved.dot");
});

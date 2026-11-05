import assert from "node:assert/strict";
import test from "node:test";
import { createComparison } from "../src/comparison.ts";

test("a comparison read rejected after an edit cannot publish a stale error", async () => {
	let revision = 1,
		reject;
	const statuses = [];
	const controller = createComparison(
		() => "a >> p -> b",
		() => revision,
		() => {},
		(message) => statuses.push(message),
	);
	const pending = controller.compare(
		() =>
			new Promise((_, fail) => {
				reject = fail;
			}),
	);
	revision++;
	reject(new Error("old read failed"));
	await pending;
	assert.deepEqual(statuses, []);
});

test("successful comparison and clear resolve the comparison notification", async () => {
	const statuses = [];
	const controller = createComparison(
		() => "a >> p -> b",
		() => 1,
		() => {},
		(message) => statuses.push(message),
	);
	await controller.compare(async () => {
		throw new Error("read failed");
	});
	assert.match(statuses.at(-1), /read failed/);
	await controller.compare(async () => ({
		source: "a >> p -> b",
		label: "HEAD",
	}));
	assert.equal(statuses.at(-1), "");
	await controller.compare(async () => {
		throw new Error("read failed again");
	});
	controller.clear();
	assert.equal(statuses.at(-1), "");
});

test("comparison uses unsaved metadata, preserves baseline across edits and rejects late reads", async () => {
	let source = "---\nartifact: {a: {label: After}}\n---\na >> p -> b\n";
	let revision = 1;
	const messages = [],
		statuses = [];
	const controller = createComparison(
		() => source,
		() => revision,
		(message) => messages.push(message),
		(message) => statuses.push(message),
	);
	const baseline = { source: source.replace("After", "Before"), label: "HEAD" };
	await controller.compare(async () => baseline);
	assert.deepEqual(messages.at(-1).report.changedNodes, ["a"]);
	source += "b >> q -> c\n";
	revision++;
	controller.refresh();
	assert.deepEqual(messages.at(-1).report.addedNodes, ["c", "q"]);
	let finish;
	const pending = controller.compare(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	controller.clear();
	finish(baseline);
	await pending;
	assert.equal(messages.at(-1).type, "clearDiff");
	const pendingEdit = controller.compare(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	revision++;
	finish(baseline);
	await pendingEdit;
	assert.equal(messages.at(-1).type, "clearDiff");
	controller.dispose();
	await controller.compare(async () =>
		assert.fail("disposed comparison must not read"),
	);
});

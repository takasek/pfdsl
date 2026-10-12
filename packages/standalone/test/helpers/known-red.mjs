// Cells that fail until their fix lands run as todo, so the suite stays green
// while each red cell is still proven red. A listed cell that passes fails the
// guard test: the commit that fixes a cell must delete it from the list.
import assert from "node:assert/strict";
import test from "node:test";

export const KNOWN_RED = new Set([
	// F1: an edit after the Save decision was asked but before the pre-save inspection answered is saved without a new decision.
	"lifetime | pending-inspect | edit | close-save",
	"lifetime | pending-inspect | edit | quit-save",
]);

const results = new Map();

/** Registers one cell. `run` returns its violations; a throw counts as one. */
export function cell(label, run) {
	test(label, KNOWN_RED.has(label) ? { todo: "known red" } : {}, async () => {
		let violations;
		try {
			violations = (await run()) ?? [];
		} catch (error) {
			violations = [`error: ${error?.message ?? error}`];
		}
		results.set(label, violations);
		assert.deepEqual(violations, [], label);
	});
}

/** Call once at the end of a test file. */
export function guardKnownRed() {
	test("known-red cells still fail", () => {
		const stale = [...KNOWN_RED].filter(
			(label) => results.has(label) && results.get(label).length === 0,
		);
		assert.deepEqual(stale, [], "remove these cells from KNOWN_RED");
	});
}

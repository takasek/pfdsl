// Cells that fail until their fix lands run as todo, so the suite stays green
// while each red cell is still proven red. A listed cell that passes fails the
// guard test: the commit that fixes a cell must delete it from the list.
import assert from "node:assert/strict";
import test from "node:test";

export const KNOWN_RED = new Set([
	// F1: an edit after the Save decision was asked but before the pre-save inspection answered is saved without a new decision.
	"lifetime | pending-inspect | edit | close-save",
	"lifetime | pending-inspect | edit | quit-save",
	// F2: a failed pre-save inspection leaves the tab looking clean.
	"clean | unreadable | unpolled | cmd-s",
	"failure memory | clean | cmd-s | same | poll",
	"failure memory | clean | cmd-s | same | cmd-s",
	"failure memory | clean | cmd-s | same | close-discard",
	"failure memory | clean | cmd-s | different | poll",
	"failure memory | clean | cmd-s | different | cmd-s",
	"failure memory | clean | cmd-s | different | close-discard",
	// F3: the notice that the original also changed outlives the failed Save of the original.
	"stale notice | the original returns to its first content",
	// F4: the panel names the moved recovery target by its old path.
	"moved target | Use Current Disk Version before 0 poll(s)",
	"moved target | Use Current Disk Version before 1 poll(s)",
	"save-as-conflict | A none | B moved-changed | unpolled | use",
	"save-as-conflict | A content-changed | B moved-changed | unpolled | use",
	"save-as-conflict | A metadata-only | B moved-changed | unpolled | use",
	"save-as-conflict | A deleted | B moved-changed | unpolled | use",
	"save-as-conflict | A unreadable | B moved-changed | unpolled | use",
	"untitled-conflict | A none | B moved-changed | unpolled | use",
	// N2: the close needs a second attempt after a Save that succeeded during the confirmation.
	"close after an unreadable first save | the target recovers during the confirmation",
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

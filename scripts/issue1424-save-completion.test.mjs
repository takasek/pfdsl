import assert from "node:assert/strict";
import test from "node:test";
import { hasCompletedSave } from "./issue1424-diagnostics/save-completion.mjs";

const uri = "file:///tmp/fixture.pfdsl";
const save = (version = 10) => ({
	event: "document-save",
	details: { uri, version, dirty: false, closed: false },
});
const state = (version = 10, dirty = false) => ({
	active: { doc: { uri, version, dirty, closed: false } },
	visible: [],
	groups: [{ tabs: [{ uri, dirty }] }],
});

test("disk publication or a clean-looking tab alone is not a completed save", () => {
	assert.equal(hasCompletedSave([state(10, true)], uri), false);
	assert.equal(hasCompletedSave([state()], uri), false);
	assert.equal(hasCompletedSave([save(), state(10, true)], uri), false);
});

test("only a save of the current open document can release the close barrier", () => {
	assert.equal(hasCompletedSave([save(), state()], uri), true);
	assert.equal(hasCompletedSave([save(), state(11, true)], uri), false);
	assert.equal(hasCompletedSave([save(), state(11, false)], uri), false);
	assert.equal(
		hasCompletedSave([save(), { visible: [], groups: [] }], uri),
		false,
	);
	assert.equal(
		hasCompletedSave([save(), state()], "file:///other.pfdsl"),
		false,
	);
});

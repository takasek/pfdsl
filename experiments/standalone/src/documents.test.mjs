import assert from "node:assert/strict";
import test from "node:test";
import { Documents } from "./documents.mjs";

test("tabs retain their own text and preview while a late render completes", () => {
	const docs = new Documents();
	docs.open("a.pfdsl", "[a] -> (p) -> [b]");
	docs.open("b.pfdsl", "[c] -> (q) -> [d]");
	docs.rendered("a.pfdsl", 0, { svg: "A", diagnostics: [] });
	assert.equal(docs.active.path, "b.pfdsl");
	assert.equal(docs.active.render, null);
	docs.select("a.pfdsl");
	assert.equal(docs.active.render.svg, "A");
	assert.equal(docs.active.text, "[a] -> (p) -> [b]");
});

test("older renders cannot replace a newer revision or a reopened tab", () => {
	const docs = new Documents();
	const first = docs.open("a.pfdsl", "old");
	const token = first.revision;
	docs.edit("a.pfdsl", "new");
	assert.equal(docs.rendered("a.pfdsl", token, { svg: "old" }), false);
	docs.close("a.pfdsl", true);
	docs.open("a.pfdsl", "reopened");
	assert.equal(docs.rendered("a.pfdsl", token, { svg: "old" }), false);
});

test("editing and switching never write; explicit save writes its captured document", async () => {
	const docs = new Documents();
	docs.open("a.pfdsl", "original");
	docs.edit("a.pfdsl", "edited");
	docs.open("b.pfdsl", "other");
	assert.equal(docs.tabs.get("a.pfdsl").savedText, "original");
	let finish;
	const writes = [];
	const saving = docs.save("a.pfdsl", (path, text, expectedText) => {
		writes.push({ path, text, expectedText });
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	docs.edit("a.pfdsl", "newer edit during save");
	finish();
	await saving;
	assert.deepEqual(writes, [
		{ path: "a.pfdsl", text: "edited", expectedText: "original" },
	]);
	assert.equal(docs.tabs.get("a.pfdsl").savedText, "edited");
	assert.equal(docs.tabs.get("a.pfdsl").dirty, true);
	assert.equal(docs.active.path, "b.pfdsl");
});

test("external changes reload a clean buffer and preserve a dirty one", () => {
	const docs = new Documents();
	docs.open("a.pfdsl", "original");
	assert.equal(docs.refresh("a.pfdsl", "external"), "reloaded");
	assert.equal(docs.active.text, "external");
	docs.edit("a.pfdsl", "local");
	assert.equal(docs.refresh("a.pfdsl", "external again"), "conflict");
	assert.equal(docs.active.text, "local");
	assert.equal(docs.active.savedText, "external");
	assert.equal(docs.close("a.pfdsl"), false);
});

test("failed saves keep the buffer dirty and retain its saved baseline", async () => {
	const docs = new Documents();
	docs.open("a.pfdsl", "original");
	docs.edit("a.pfdsl", "local");
	await assert.rejects(
		docs.save("a.pfdsl", async () => {
			throw new Error("Disk conflict");
		}),
		/Disk conflict/,
	);
	assert.equal(docs.active.text, "local");
	assert.equal(docs.active.savedText, "original");
	assert.equal(docs.active.dirty, true);
});

test("disk reads begun before save or close-reopen cannot overwrite current state", async () => {
	const docs = new Documents();
	docs.open("a.pfdsl", "original");
	const firstRead = docs.snapshot("a.pfdsl");
	docs.edit("a.pfdsl", "saved");
	await docs.save("a.pfdsl", async () => {});
	assert.equal(docs.refresh("a.pfdsl", "original", firstRead), "stale");
	assert.equal(docs.active.text, "saved");
	const secondRead = docs.snapshot("a.pfdsl");
	docs.close("a.pfdsl");
	docs.open("a.pfdsl", "reopened");
	assert.equal(docs.refresh("a.pfdsl", "stale result", secondRead), "stale");
	assert.equal(docs.active.text, "reopened");
});

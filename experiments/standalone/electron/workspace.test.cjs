const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { Workspace } = require("./workspace.cjs");

function fixture(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pfdsl-electron-test-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	for (const directory of ["docs/samples", ".pfdsl", "exports"]) {
		fs.mkdirSync(path.join(root, directory), { recursive: true });
	}
	fs.writeFileSync(path.join(root, "docs/samples/a.pfdsl"), "original");
	fs.writeFileSync(path.join(root, ".pfdsl/roadmap.pfdsl"), "roadmap");
	return { root, workspace: new Workspace(root) };
}

test("lists only the requested corpus and reads normalized relative paths", (t) => {
	const { root, workspace } = fixture(t);
	fs.writeFileSync(path.join(root, ".pfdsl/other.pfdsl"), "ignored");
	fs.writeFileSync(path.join(root, "docs/samples/readme.md"), "ignored");
	assert.deepEqual(workspace.documents(), [
		{ path: ".pfdsl/roadmap.pfdsl", name: "roadmap.pfdsl" },
		{ path: "docs/samples/a.pfdsl", name: "a.pfdsl" },
	]);
	assert.equal(workspace.read("docs/samples/../samples/a.pfdsl"), "original");
});

test("rejects absolute, escaping, empty, and non-document paths", (t) => {
	const { workspace } = fixture(t);
	for (const file of [
		"/etc/passwd",
		"../outside.pfdsl",
		"docs/../../outside.pfdsl",
		"",
		"exports/a.json",
	]) {
		assert.throws(() => workspace.read(file), undefined, file);
		assert.throws(
			() => workspace.writeDocument(file, "bad", "original"),
			undefined,
			file,
		);
	}
});

test("saves only when disk matches expected text and preserves conflicting edits", (t) => {
	const { root, workspace } = fixture(t);
	workspace.writeDocument("docs/samples/a.pfdsl", "edited 日本語", "original");
	assert.equal(workspace.read("docs/samples/a.pfdsl"), "edited 日本語");
	fs.writeFileSync(path.join(root, "docs/samples/a.pfdsl"), "external edit");
	assert.throws(
		() =>
			workspace.writeDocument("docs/samples/a.pfdsl", "stale", "edited 日本語"),
		/changed on disk/,
	);
	assert.equal(workspace.read("docs/samples/a.pfdsl"), "external edit");
	assert.deepEqual(fs.readdirSync(path.join(root, "docs/samples")), [
		"a.pfdsl",
	]);
});

test("exports only allowed bytes beneath exports without changing documents", (t) => {
	const { root, workspace } = fixture(t);
	for (const extension of ["svg", "png", "pdf", "json"]) {
		workspace.writeExport(`exports/chart.${extension}`, [0, 128, 255]);
		assert.deepEqual(
			[...fs.readFileSync(path.join(root, `exports/chart.${extension}`))],
			[0, 128, 255],
		);
	}
	for (const file of [
		"docs/samples/a.pfdsl",
		"docs/samples/a.svg",
		"exports/../a.pdf",
		"exports/a.exe",
	]) {
		assert.throws(() => workspace.writeExport(file, [1]), undefined, file);
	}
	for (const bytes of [[256], [-1], [1.5], ["1"], null]) {
		assert.throws(() => workspace.writeExport("exports/invalid.pdf", bytes));
	}
	assert.equal(workspace.read("docs/samples/a.pfdsl"), "original");
});

test("rejects symlink escapes for documents, export directories, and existing exports", (t) => {
	const { root, workspace } = fixture(t);
	const outside = fixture(t);
	fs.symlinkSync(
		path.join(outside.root, "docs/samples/a.pfdsl"),
		path.join(root, "docs/samples/link.pfdsl"),
	);
	fs.symlinkSync(outside.root, path.join(root, "exports/escape"));
	fs.writeFileSync(path.join(outside.root, "outside.pdf"), "untouched");
	fs.symlinkSync(
		path.join(outside.root, "outside.pdf"),
		path.join(root, "exports/link.pdf"),
	);
	assert.throws(
		() => workspace.read("docs/samples/link.pfdsl"),
		/inside the workspace/,
	);
	assert.throws(() =>
		workspace.writeDocument("docs/samples/link.pfdsl", "bad", "original"),
	);
	assert.throws(() => workspace.writeExport("exports/escape/new.pdf", [1]));
	assert.throws(() => workspace.writeExport("exports/link.pdf", [1]));
	assert.equal(
		fs.readFileSync(path.join(outside.root, "outside.pdf"), "utf8"),
		"untouched",
	);
	assert.equal(outside.workspace.read("docs/samples/a.pfdsl"), "original");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
	closeDocuments,
	DocumentSession,
	sameDiskContent,
	sameDocument,
} from "../src/document-session.ts";

function view(source = "original") {
	let text = source;
	let revision = 0;
	return {
		getSource: () => text,
		getRevision: () => revision,
		setSource: (value) => {
			text = value;
			revision++;
		},
		edit: (value) => {
			text = value;
			revision++;
		},
	};
}
const snap = (source, revision = source, path = "/a.pfdsl", id = 1) => ({
	id,
	path,
	source,
	revision,
	identity: `file:${id}`,
	binding: `directory:${path}`,
});
const gone = (path = "/a.pfdsl", id = 1) => ({
	...snap(null, null, path, id),
	identity: null,
});
const B = (source = "old B", revision = "b0") =>
	snap(source, revision, "/B/b.pfdsl", 2);
const ok = (snapshot) => ({ snapshot });
const failed = (error = "unreadable") => ({ error: new Error(error) });
const write = (result) => async () => result;

for (const kind of ["save", "adopt", "close"])
	for (const moved of [false, true])
		test(`plan rebind | ${kind} | ${moved ? "moved path" : "new capability"}`, async () => {
			const editor = view();
			const original = snap("original");
			const doc = new DocumentSession(editor, original);
			editor.edit("local");
			const plan = doc.plan(kind, kind === "close" ? null : original);
			const rebound = {
				...original,
				id: moved ? 1 : 9,
				path: moved ? "/moved/a.pfdsl" : original.path,
			};
			assert.equal(doc.rebindDisk(rebound), true);
			const violations = [];
			if (doc.holds(plan))
				violations.push("V: old plan survived a target rebind");
			if (doc.holds(plan, "editor"))
				violations.push(
					"V: editor-only close-save validation accepted a rebound plan",
				);
			if (kind === "save") {
				await doc.save(plan, async () => {
					violations.push("V: save executed the old capability after rebind");
					return { outcome: "saved", current: original };
				});
			} else if (kind === "adopt" && doc.adopt(plan))
				violations.push(
					"V: adoption executed a plan with the old displayed path",
				);
			assert.deepEqual(violations, []);
		});

test("close plan editor scope permits an ordinary pre-save observation", () => {
	const editor = view();
	const original = snap("original");
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	const plan = doc.plan("close", null);
	const changed = snap("external", "r2");
	doc.observe(changed, ok(changed));
	assert.equal(doc.holds(plan), false);
	assert.equal(doc.holds(plan, "editor"), true);
});

test("plan rebind | close editor scope rejects a capability rebound back to its original tuple", () => {
	const editor = view();
	const original = snap("original");
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	const plan = doc.plan("close", null);
	assert.equal(doc.rebindDisk({ ...original, id: 9 }), true);
	assert.equal(doc.rebindDisk(original), true);
	assert.equal(
		doc.holds(plan, "editor"),
		false,
		"V: a rebind round trip resurrected the old close plan",
	);
});

/** A session whose Save As to B failed with a conflict, leaving B as the recovery target. */
async function recovering(disk = snap("original", "r1")) {
	const editor = view();
	const doc = new DocumentSession(editor, disk);
	editor.edit("local");
	const external = B("external B", "b1");
	const plan = doc.plan("save", B());
	const outcome = await doc.save(
		plan,
		write({ outcome: "conflict", current: external, message: "raced" }),
	);
	return { doc, editor, external, outcome, plan };
}

test("sameDocument matches selected capabilities, not display paths", () => {
	const original = snap("original");
	const alias = {
		...original,
		id: 2,
		path: "/alias.pfdsl",
		binding: "d:alias",
	};
	assert.equal(sameDocument(original, alias), false);
	assert.equal(sameDocument(original, { ...original, id: 5 }), true);
	assert.equal(
		sameDocument(original, { ...alias, identity: "file:1" }, true),
		true,
	);
	assert.equal(
		sameDocument(original, { ...alias, identity: "file:9" }, true),
		false,
	);
});

test("equal content is judged on the raw disk text or the revision", () => {
	const original = snap("a\r\nb\n", "r1");
	assert.equal(
		sameDiskContent(original, { ...original, revision: "r2" }),
		true,
	);
	assert.equal(sameDiskContent(original, snap("a\nb\n", "r2")), false);
	assert.equal(sameDiskContent(gone(), gone()), true);
	assert.equal(sameDiskContent(original, gone()), false);
});

test("a clean editor follows a readable file with other content", () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	const changed = snap("external", "r2");
	assert.equal(doc.observe(changed, ok(changed)), "reloaded");
	assert.equal(editor.getSource(), "external");
	assert.equal(doc.isDirty(), false);
	assert.equal(doc.disk, changed);
	assert.equal(doc.panel(), null);
});

test("a dirty editor keeps its text and shows the observed file in a panel", () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	editor.edit("local");
	const changed = snap("external", "r2");
	assert.equal(doc.observe(changed, ok(changed)), "changed");
	assert.equal(editor.getSource(), "local");
	assert.equal(doc.disk.source, "original");
	const panel = doc.panel();
	assert.equal(panel.observed.source, "external");
	assert.equal(panel.targetPath, "/a.pfdsl");
	assert.match(panel.message, /The disk changed/);
	assert.equal(panel.state, "");
	assert.equal(panel.originalChanged, null);
});

test("a deleted file protects even a clean editor and shows no text to adopt", () => {
	const doc = new DocumentSession(view(), snap("original", "r1"));
	assert.equal(doc.isDirty(), false);
	doc.observe(gone(), ok(gone()));
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.panel().observed.source, null);
	assert.match(doc.panel().message, /deleted or moved/);
});

for (const [name, touched] of [
	["metadata-only change", (disk) => ({ ...disk, revision: "touched" })],
	[
		"replacement by a new inode",
		(disk) => ({ ...disk, revision: "replaced", identity: "file:9" }),
	],
]) {
	test(`a ${name} with identical content is no change at all`, () => {
		for (const dirty of [false, true]) {
			const editor = view();
			const sets = [];
			const set = editor.setSource;
			editor.setSource = (value) => {
				sets.push(value);
				set(value);
			};
			const original = snap("original", "r1");
			const doc = new DocumentSession(editor, original);
			if (dirty) editor.edit("local");
			const version = doc.closeVersion();
			assert.equal(doc.observe(original, ok(touched(original))), "unchanged");
			assert.deepEqual(sets, []);
			assert.equal(doc.panel(), null);
			assert.equal(doc.isDirty(), dirty);
			assert.equal(
				doc.closeVersion(),
				version,
				"a touch invalidates a decision",
			);
		}
	});
}

test("identical content is compared as read from disk, not as the editor normalized it", () => {
	const text = "a\nb\n";
	const sets = [];
	const doc = new DocumentSession(
		{ getSource: () => text, setSource: (value) => sets.push(value) },
		snap("a\r\nb\n", "r1"),
	);
	const touched = snap("a\r\nb\n", "r2");
	assert.equal(doc.observe(touched, ok(touched)), "unchanged");
	assert.deepEqual(sets, []);
	assert.equal(doc.isDirty(), false);
});

test("a reload acknowledges the text the editor applied", () => {
	let text = "a\r\nb\r\n";
	const doc = new DocumentSession(
		{
			getSource: () => text,
			setSource: (value) => {
				text = value.replace(/\r?\n/g, "\r\n");
			},
		},
		snap(text, "r1"),
	);
	const mixed = snap("a\nb\r\n", "r2");
	assert.equal(doc.observe(mixed, ok(mixed)), "reloaded");
	assert.equal(text, "a\r\nb\r\n");
	assert.equal(doc.savedSource, "a\r\nb\r\n");
	assert.equal(doc.disk.source, "a\nb\r\n");
	assert.equal(doc.isDirty(), false);
	assert.equal(doc.observe(mixed, ok(mixed)), "unchanged");
	assert.equal(doc.isDirty(), false);
});

test("an unreadable file protects the editor until it reads as acknowledged again", () => {
	const editor = view();
	const original = snap("original", "r1");
	const doc = new DocumentSession(editor, original);
	assert.equal(doc.observe(original, failed()), "changed");
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.panel(), null, "no panel without a readable alternative");
	assert.equal(
		doc.observe(original, ok({ ...original, revision: "touched" })),
		"changed",
	);
	assert.equal(doc.isDirty(), false);
	// Content that differs after a failed read is a conflict, not a reload.
	doc.observe(original, failed());
	const changed = snap("external", "r2");
	assert.equal(doc.observe(changed, ok(changed)), "changed");
	assert.equal(editor.getSource(), "original");
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.panel().observed.source, "external");
});

test("a repeated failed read keeps the state a decision was asked for", () => {
	const doc = new DocumentSession(view(), snap("original", "r1"));
	const original = doc.disk;
	doc.observe(original, failed("one"));
	const asked = doc.closeVersion();
	doc.observe(original, failed("two"));
	assert.equal(doc.closeVersion(), asked);
	doc.observe(original, ok(original));
	assert.notEqual(doc.closeVersion(), asked, "recovering is a new state");
});

test("a file that returns to its acknowledged state leaves no conflict behind", () => {
	const editor = view();
	const original = snap("original", "r1");
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	for (const away of [snap("external", "r2"), gone()]) {
		doc.observe(original, ok(away));
		assert.notEqual(doc.panel(), null);
		doc.observe(original, ok({ ...original }));
		assert.equal(doc.panel(), null);
		assert.equal(doc.isDirty(), true);
		assert.equal(editor.getSource(), "local");
	}
});

test("an edit made while a read was in flight is not replaced by that read", () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	const scope = doc.begin();
	editor.edit("unsaved");
	const changed = snap("external", "r2");
	assert.equal(doc.observe(changed, ok(changed), scope), "changed");
	assert.equal(editor.getSource(), "unsaved");
	assert.equal(doc.panel().observed.source, "external");
	// An edit undone back to the acknowledged text is still an edit made during the read.
	const other = new DocumentSession(editor, snap("unsaved", "r1"));
	const again = other.begin();
	editor.edit("typed");
	editor.edit("unsaved");
	assert.equal(other.observe(changed, ok(changed), again), "changed");
	assert.equal(editor.getSource(), "unsaved");
});

test("a read that started before the document was replaced is dropped", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	let release;
	const check = doc.checkExternal(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	editor.edit("local");
	await doc.save(
		doc.plan("save", doc.disk),
		write({ outcome: "saved", current: snap("local", "r2") }),
	);
	release(snap("older external", "r0"));
	await check;
	assert.equal(editor.getSource(), "local");
	assert.equal(doc.isDirty(), false);
	assert.equal(doc.panel(), null);
});

test("disposal prevents a pending read from touching the editor", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	let release;
	const pending = doc.checkExternal(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	doc.dispose();
	release(snap("external", "r2"));
	await pending;
	assert.equal(editor.getSource(), "original");
	assert.equal(doc.observe(doc.disk, ok(snap("external", "r2"))), "stale");
});

test("reading every target does not let one failure skip another", async () => {
	const { doc, external } = await recovering();
	const later = { ...external, source: "later B", revision: "b2" };
	const before = doc.closeVersion();
	const reads = [];
	await assert.rejects(
		doc.checkExternal(async (id) => {
			reads.push(id);
			if (id === 1) throw new Error("original unreadable");
			return later;
		}),
		/original unreadable/,
	);
	assert.deepEqual(reads.sort(), [1, 2]);
	assert.equal(doc.panel().observed.source, "later B");
	assert.notEqual(doc.closeVersion(), before);
});

test("an untitled document with a failed first save reads its recovery target", async () => {
	const { doc, external } = await recovering(null);
	const reads = [];
	const later = { ...external, source: "later B", revision: "b2" };
	await doc.checkExternal(async (id) => {
		reads.push(id);
		return later;
	});
	assert.deepEqual(reads, [2]);
	assert.equal(doc.panel().observed, later);
	assert.equal(doc.isDirty(), true);
});

test("a started read finishes before close continues", async () => {
	const doc = new DocumentSession(view(), snap("original", "r1"));
	let release;
	const read = doc.checkExternal(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	let settled = false;
	const closing = closeDocuments(
		[doc],
		async () => "cancel",
		async () => true,
		() => {},
	).then((result) => {
		settled = true;
		return result;
	});
	for (let i = 0; i < 5; i++) await Promise.resolve();
	assert.equal(settled, false);
	release(gone());
	await read;
	assert.equal(await closing, false);
	assert.equal(doc.isDirty(), true);
});

test("a save failure keeps its target, receipt and unsaved state until resolved", async () => {
	const { doc, external, outcome } = await recovering();
	assert.equal(outcome.saved, false);
	assert.equal(outcome.stale, false);
	assert.equal(outcome.message, "raced");
	assert.equal(doc.disk.id, 1, "the original stays the document's file");
	assert.equal(doc.usesDocument(2), true);
	const panel = doc.panel();
	assert.equal(panel.observed, external);
	assert.equal(panel.targetPath, "/B/b.pfdsl");
	assert.equal(panel.message, "raced");
	// Observing the same version again leaves the failure that explains the panel.
	doc.observe(external, ok({ ...external, revision: "touched" }));
	assert.equal(doc.panel().message, "raced");
	const later = { ...external, source: "later B", revision: "b2" };
	doc.observe(external, ok(later));
	assert.match(doc.panel().message, /The disk changed/);
	assert.equal(doc.panel().observed, later);
});

test("a published receipt without a readable result names the target but offers no snapshot", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	editor.edit("local");
	const target = B();
	const result = {
		outcome: "published-but-unconfirmed",
		publication: "published",
		targetState: "unreadable",
		message: "Publication occurred; target cannot be read.",
	};
	assert.equal(
		(await doc.save(doc.plan("save", target), write(result))).saved,
		false,
	);
	const panel = doc.panel();
	assert.equal(panel.observed, null);
	assert.equal(panel.targetPath, "/B/b.pfdsl");
	assert.match(panel.state, /Content was published/);
	assert.equal(panel.message, result.message);
	// A later read of the target shows it, and the receipt still explains the panel.
	doc.observe(target, ok(target));
	assert.equal(doc.panel().observed, target);
	assert.match(doc.panel().state, /Content was published/);
	assert.equal(doc.isDirty(), true);
	assert.equal(editor.getSource(), "local");
});

test("a lost reply is an unknown publication, whether or not the write happened", async () => {
	const doc = new DocumentSession(view(), snap("original"));
	const target = B();
	const outcome = await doc.save(doc.plan("save", target), async () => {
		throw new Error("reply lost after native write");
	});
	assert.equal(outcome.saved, false);
	assert.match(outcome.message, /could not be confirmed/);
	assert.equal(doc.isDirty(), true, "a clean buffer is protected as well");
	assert.equal(doc.disk.id, 1);
	assert.equal(doc.usesDocument(2), true);
	const panel = doc.panel();
	assert.match(panel.state, /could not be confirmed/);
	assert.equal(panel.observed, null);
	assert.equal(panel.targetPath, "/B/b.pfdsl");
});

test("a successful save acknowledges the submitted text and keeps later edits unsaved", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	editor.edit("submitted");
	const plan = doc.plan("save", doc.disk);
	let release;
	const pending = doc.save(
		plan,
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	editor.edit("newer");
	release({ outcome: "saved", current: snap("submitted") });
	assert.equal((await pending).saved, true);
	assert.equal(doc.savedSource, "submitted");
	assert.equal(doc.isDirty(), true);
	assert.equal(editor.getSource(), "newer");
});

test("a save sends the plan's text and revision, not whatever the editor holds by then", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	editor.edit("shown");
	const target = snap("disk", "r2");
	const plan = doc.plan("save", target);
	const sent = [];
	await doc.save(plan, async (request) => {
		sent.push([request.editor, request.revision, request.target.id]);
		return { outcome: "saved", current: snap("shown", "r3") };
	});
	assert.deepEqual(sent, [["shown", "r2", 1]]);
});

test("a successful save leaves nothing for the next read to change", async () => {
	const { doc, editor } = await recovering(snap("original", "r1"));
	const saved = B("local", "b9");
	const outcome = await doc.save(
		doc.plan("save", B("external B", "b1")),
		write({ outcome: "saved", current: saved }),
	);
	assert.equal(outcome.saved, true);
	assert.equal(doc.disk, saved);
	assert.equal(doc.panel(), null);
	assert.equal(doc.isDirty(), false);
	const version = doc.closeVersion();
	assert.equal(doc.observe(saved, ok({ ...saved })), "unchanged");
	assert.equal(doc.closeVersion(), version);
	assert.equal(editor.getSource(), "local");
});

test("a plan that no longer describes the document is not executed", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	editor.edit("local");
	let sent = 0;
	const send = async () => {
		sent++;
		return { outcome: "saved", current: snap("local") };
	};
	const edited = doc.plan("save", doc.disk);
	editor.edit("newer");
	assert.equal(doc.holds(edited), false);
	assert.deepEqual(await doc.save(edited, send), {
		saved: false,
		stale: true,
		message: "",
	});
	const observed = doc.plan("save", doc.disk);
	const changed = snap("external", "r2");
	doc.observe(changed, ok(changed));
	assert.equal(doc.holds(observed), false);
	assert.equal((await doc.save(observed, send)).stale, true);
	assert.equal(sent, 0);
	const fresh = doc.plan("save", changed);
	doc.observe(changed, ok({ ...changed, revision: "touched" }));
	assert.equal(doc.holds(fresh), true, "a touch does not invalidate a plan");
	assert.equal((await doc.save(fresh, send)).saved, true);
	assert.equal(sent, 1);
});

test("a close decision is checked against the editor after the Save's own read", () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r1"));
	editor.edit("local");
	const asked = doc.plan("close", null);
	const changed = snap("external", "r2");
	doc.observe(changed, ok(changed));
	assert.equal(doc.holds(asked), false);
	assert.equal(doc.holds(asked, "editor"), true);
	editor.edit("local");
	assert.equal(
		doc.holds(asked, "editor"),
		false,
		"an edit and its undo are an edit",
	);
});

test("adopting a version needs the plan to hold and the target to be readable", async () => {
	const { doc, editor, external } = await recovering();
	const plan = doc.plan("adopt", external);
	assert.equal(doc.adopt(plan), true);
	assert.equal(editor.getSource(), "external B");
	assert.equal(doc.disk, external);
	assert.equal(doc.panel(), null);
	assert.equal(doc.isDirty(), false);
	assert.equal(doc.usesDocument(1), false);
	const again = await recovering();
	const stale = again.doc.plan("adopt", again.external);
	again.editor.edit("typed after the dialog");
	assert.equal(again.doc.adopt(stale), false);
	assert.equal(again.editor.getSource(), "typed after the dialog");
	const missing = await recovering();
	const plan2 = missing.doc.plan("adopt", missing.external);
	missing.doc.observe(missing.external, ok(gone("/B/b.pfdsl", 2)));
	assert.equal(missing.doc.adopt(plan2), false);
});

test("the original is reported as also changed only beside another recovery target", async () => {
	const original = snap("original", "r1");
	const { doc, external } = await recovering(original);
	doc.observe(original, ok({ ...original, revision: "touched" }));
	assert.equal(doc.panel().originalChanged, null);
	const changed = snap("external A", "r2");
	doc.observe(original, ok(changed));
	assert.equal(doc.panel().originalChanged, "/a.pfdsl");
	assert.equal(
		doc.panel().observed,
		external,
		"the recovery target keeps the panel",
	);
	doc.observe(original, failed());
	assert.equal(doc.panel().originalChanged, null);
	doc.observe(original, ok(original));
	assert.equal(doc.panel().originalChanged, null);
	// Once the original is itself the unresolved target, there is no other file to name.
	const editor = view();
	const own = new DocumentSession(editor, original);
	editor.edit("local");
	await own.save(
		own.plan("save", original),
		write({ outcome: "conflict", current: changed }),
	);
	assert.equal(own.panel().originalChanged, null);
	assert.equal(own.panel().targetPath, "/a.pfdsl");
});

test("the panel names a moved target by the path it was last seen at", async () => {
	const { doc, external } = await recovering();
	const moved = {
		...external,
		path: "/moved/B/b.pfdsl",
		source: "moved B",
		revision: "b3",
	};
	doc.observe(external, ok(moved));
	assert.equal(doc.panel().targetPath, "/moved/B/b.pfdsl");
	// An unreadable target is still named by the last snapshot, with its text.
	doc.observe(external, failed("gone"));
	assert.equal(doc.panel().targetPath, "/moved/B/b.pfdsl");
	assert.equal(doc.panel().observed.source, "moved B");
	assert.match(doc.panel().message, /could not be read/);
});

test("reopening a file with a new capability keeps unsaved text and adopts nothing for it", () => {
	const editor = view();
	const original = snap("original", "r0", "/a.pfdsl", 1);
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	const again = { ...original, id: 9 };
	assert.equal(doc.rebindDisk(again), true);
	assert.equal(doc.disk.id, 9);
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.panel(), null);
	assert.equal(doc.usesDocument(1), false);
	const replaced = {
		...again,
		id: 10,
		source: "external",
		revision: "new",
		identity: "file:2",
	};
	assert.equal(doc.rebindDisk(replaced), true);
	assert.equal(doc.disk.id, 10);
	assert.equal(
		doc.disk.source,
		"original",
		"the acknowledged text is not replaced",
	);
	assert.equal(editor.getSource(), "local");
	assert.equal(doc.panel().observed.source, "external");
});

test("a hard-link leaf is not the same document", () => {
	const original = snap("original");
	const alias = {
		...original,
		id: 2,
		path: "/alias.pfdsl",
		binding: "directory:/alias.pfdsl",
	};
	const doc = new DocumentSession(view(), original);
	assert.equal(doc.rebindDisk(alias), false);
	assert.equal(doc.disk, original);
});

test("reopening a renamed file reloads a clean editor and exposes the change beside dirty edits", () => {
	const changed = { ...snap("external", "r1", "/renamed.pfdsl"), id: 9 };
	const clean = new DocumentSession(view(), snap("original", "r0"));
	assert.equal(clean.rebindDisk(changed, true), true);
	assert.equal(clean.view.getSource(), "external");
	assert.equal(clean.isDirty(), false);
	assert.equal(clean.disk.id, 9);
	const editor = view();
	const dirty = new DocumentSession(editor, snap("original", "r0"));
	editor.edit("unique local edit");
	assert.equal(dirty.rebindDisk(changed, true), true);
	assert.equal(dirty.disk.id, 9);
	assert.equal(dirty.disk.revision, "r0");
	assert.equal(dirty.panel().observed.source, "external");
	assert.equal(editor.getSource(), "unique local edit");
	assert.equal(dirty.savedSource, "original");
});

test("a rename moves the recovery target that is the file itself and leaves a separate target alone", async () => {
	const original = snap("original", "r0", "/a.pfdsl");
	const own = new DocumentSession(view(), original);
	own.view.edit("local");
	await own.save(
		own.plan("save", original),
		write({ outcome: "failed-before-publication", current: original }),
	);
	const renamed = {
		...original,
		id: 9,
		path: "/renamed.pfdsl",
		binding: "directory:/renamed.pfdsl",
	};
	assert.equal(own.rebindDisk(renamed, true), true);
	assert.equal(own.usesDocument(9), true);
	assert.equal(own.usesDocument(1), false);
	assert.equal(own.panel().targetPath, "/renamed.pfdsl");
	const reads = [];
	await own.checkExternal(async (id) => {
		reads.push(id);
		return id === 9 ? renamed : gone();
	});
	assert.deepEqual(reads, [9]);
	const { doc, external } = await recovering(snap("original", "r0"));
	const moved = { ...snap("external A", "r1", "/renamed.pfdsl"), id: 9 };
	assert.equal(doc.rebindDisk(moved, true), true);
	assert.equal(doc.disk.id, 9);
	assert.equal(doc.usesDocument(2), true);
	assert.equal(doc.panel().observed, external);
	assert.equal(doc.panel().originalChanged, "/renamed.pfdsl");
});

test("a Save As target that reselects the original follows its rename", async () => {
	const original = snap("original", "r0");
	const editor = view();
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	const again = { ...original, id: 2 };
	await doc.save(
		doc.plan("save", again),
		write({ outcome: "failed-before-publication", current: again }),
	);
	const renamed = {
		...original,
		id: 9,
		path: "/renamed.pfdsl",
		binding: "directory:/renamed.pfdsl",
	};
	assert.equal(doc.rebindDisk(renamed, true), true);
	assert.equal(doc.usesDocument(9), true);
	assert.equal(doc.usesDocument(2), false);
	assert.equal(doc.usesDocument(1), false);
	const reads = [];
	await doc.checkExternal(async (id) => {
		reads.push(id);
		return renamed;
	});
	assert.deepEqual(reads, [9]);
	assert.equal(editor.getSource(), "local");
});

test("a hard-link Save As target keeps its own leaf when the original is renamed", async () => {
	const original = {
		...snap("original", "r0", "/old/a.pfdsl"),
		binding: "dir1:a.pfdsl",
	};
	const doc = new DocumentSession(view(), original);
	doc.view.edit("local");
	const link = {
		...original,
		id: 2,
		path: "/old/link.pfdsl",
		binding: "dir1:link.pfdsl",
	};
	await doc.save(
		doc.plan("save", link),
		write({ outcome: "failed-before-publication", current: link }),
	);
	const renamed = {
		...original,
		id: 9,
		path: "/old/c.pfdsl",
		binding: "dir1:c.pfdsl",
	};
	assert.equal(doc.rebindDisk(renamed, true), true);
	assert.equal(doc.usesDocument(2), true);
	assert.equal(doc.panel().observed, link);
});

// The close sequence as a function of what documents report.
test("discard decisions are deferred until every dirty tab accepts close", async () => {
	const a = { isDirty: () => true };
	const b = { isDirty: () => true };
	let disposed = 0;
	assert.equal(
		await closeDocuments(
			[a, b],
			async (doc) => (doc === a ? "discard" : "cancel"),
			async () => true,
			() => {
				disposed++;
			},
		),
		false,
	);
	assert.equal(disposed, 0);
	assert.equal(
		await closeDocuments(
			[a, b],
			async () => "discard",
			async () => true,
			() => {
				disposed++;
			},
		),
		true,
	);
	assert.equal(disposed, 2);
});

test("a failed save aborts a multi-tab close and keeps every document", async () => {
	const docs = [0, 1].map(() => ({
		dirty: true,
		isDirty() {
			return this.dirty;
		},
	}));
	let disposed = 0;
	let saves = 0;
	assert.equal(
		await closeDocuments(
			docs,
			async () => "save",
			async (doc) => {
				saves++;
				if (saves === 1) doc.dirty = false;
				return saves === 1;
			},
			() => {
				disposed++;
			},
		),
		false,
	);
	assert.equal(saves, 2);
	assert.equal(disposed, 0);
});

test("closing aborts if a discarded document changes while another decision is pending", async () => {
	const docs = [0, 1].map(() => ({
		revision: 0,
		isDirty: () => true,
		closeVersion() {
			return this.revision;
		},
	}));
	let disposed = 0;
	const result = await closeDocuments(
		docs,
		async (doc) => {
			if (doc === docs[1]) docs[0].revision++;
			return "discard";
		},
		async () => true,
		() => {
			disposed++;
		},
	);
	assert.equal(result, false);
	assert.equal(disposed, 0);
});

test("a clean document that turns dirty during another decision stops the close", async () => {
	const a = {
		dirty: false,
		isDirty() {
			return this.dirty;
		},
		closeVersion: () => 0,
	};
	const b = { isDirty: () => true, closeVersion: () => 0 };
	const disposed = [];
	const closed = await closeDocuments(
		[a, b],
		async () => {
			a.dirty = true;
			return "discard";
		},
		async () => true,
		(doc) => disposed.push(doc),
	);
	assert.equal(closed, false);
	assert.deepEqual(disposed, []);
});

test("a close hands the plan made when the decision was asked to the save", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	editor.edit("asked about this");
	const plans = [];
	await closeDocuments(
		[Object.assign(doc, { closePlan: () => doc.plan("close", null) })],
		async () => "save",
		async (_document, plan) => {
			plans.push(plan);
			return false;
		},
		() => {},
	);
	assert.equal(plans.length, 1);
	assert.equal(plans[0].kind, "close");
	assert.equal(plans[0].editor, "asked about this");
});

for (const decision of ["save", "discard", "cancel"]) {
	test(`an unchanged document still accepts normal ${decision}`, async () => {
		const editor = view();
		const doc = new DocumentSession(editor, snap("original"));
		editor.edit("source A");
		let disposed = 0;
		let saves = 0;
		const result = await closeDocuments(
			[doc],
			async () => decision,
			async () => {
				saves++;
				return (
					await doc.save(
						doc.plan("save", doc.disk),
						write({ outcome: "saved", current: snap("source A") }),
					)
				).saved;
			},
			() => {
				disposed++;
				doc.dispose();
			},
		);
		assert.equal(result, decision !== "cancel");
		assert.equal(disposed, decision === "cancel" ? 0 : 1);
		assert.equal(saves, decision === "save" ? 1 : 0);
	});
}

for (const change of ["source", "state epoch", "edit then undo"]) {
	for (const decision of ["discard", "save"]) {
		test(`closing retains the document after ${change} changes during a pending ${decision}`, async () => {
			const editor = view();
			const doc = new DocumentSession(editor, snap("original", "r1"));
			editor.edit("source A");
			let release;
			let requested;
			const ready = new Promise((resolve) => {
				requested = resolve;
			});
			let disposed = 0;
			let saves = 0;
			const pending = closeDocuments(
				[doc],
				() =>
					new Promise((resolve) => {
						release = resolve;
						requested();
					}),
				async () => {
					saves++;
					return true;
				},
				() => {
					disposed++;
					doc.dispose();
				},
			);
			await ready;
			const asked = doc.closeVersion();
			if (change === "source") editor.edit("source B");
			if (change === "state epoch") {
				const changed = snap("changed on disk", "r2");
				doc.observe(changed, ok(changed));
			}
			if (change === "edit then undo") {
				editor.edit("source B");
				editor.edit("source A");
			}
			assert.notEqual(doc.closeVersion(), asked);
			release(decision);
			assert.equal(await pending, false);
			assert.equal(disposed, 0);
			assert.equal(saves, 0);
			assert.equal(doc.isDirty(), true);
		});
	}
}

test("a changed document can be confirmed afresh after a stale discard was cancelled", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	editor.edit("source A");
	let disposed = 0;
	const close = (decide) =>
		closeDocuments(
			[doc],
			decide,
			async () => false,
			() => {
				disposed++;
				doc.dispose();
			},
		);
	assert.equal(
		await close(async () => {
			editor.edit("source B");
			return "discard";
		}),
		false,
	);
	assert.equal(disposed, 0);
	assert.equal(await close(async () => "discard"), true);
	assert.equal(disposed, 1);
});

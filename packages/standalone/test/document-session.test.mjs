import assert from "node:assert/strict";
import test from "node:test";
import { closeDocuments, DocumentSession } from "../src/document-session.ts";

function view(source = "original") {
	let text = source;
	return {
		getSource: () => text,
		setSource: (value) => {
			text = value;
		},
		edit: (value) => {
			text = value;
		},
	};
}
const snap = (source, revision = source, path = "/a.pfdsl") => ({
	id: 1,
	path,
	source,
	revision,
	identity: "file:1",
	retained: [],
});

test("a rejected native reply preserves a clean buffer as uncertain at the selected Save As target", async () => {
	const editor = view();
	const original = snap("original");
	const target = { ...snap("previous B", "B:1", "/B.pfdsl"), id: 2 };
	const doc = new DocumentSession(editor, original);
	assert.equal(
		await doc.save(async () => {
			throw new Error("reply lost after native write");
		}, target),
		false,
	);
	assert.equal(editor.getSource(), "original");
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.disk, original);
	assert.equal(doc.pendingTarget, target);
	assert.equal(doc.saveFailure.publication, "unknown");
	assert.equal(doc.saveFailure.targetState, "unreadable");
	assert.equal(doc.saveFailure.current, undefined);
	assert.match(doc.message, /could not be confirmed/i);
});

test("a published native failure keeps its receipt and buffer without claiming an old snapshot is current", async () => {
	const editor = view();
	const original = snap("original");
	const doc = new DocumentSession(editor, original);
	const result = {
		outcome: "published-but-unconfirmed",
		publication: "published",
		targetState: "unreadable",
		retained: ["/old-inode"],
		message: "Publication occurred; target cannot be read.",
	};
	assert.equal(await doc.save(async () => result), false);
	assert.equal(editor.getSource(), "original");
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.disk, original);
	assert.equal(doc.observed, null);
	assert.equal(doc.pendingTarget, original);
	assert.equal(doc.saveFailure, result);
	await doc.checkExternal(async () => snap("external", "later"));
	assert.equal(doc.saveFailure, result);
	assert.equal(doc.isDirty(), true);
	assert.equal(editor.getSource(), "original");
	doc.useDisk(snap("reviewed", "accepted"));
	assert.equal(doc.saveFailure, null);
	assert.equal(doc.isDirty(), false);
});

test("save acknowledges the submitted snapshot and keeps edits made during I/O dirty", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	editor.edit("submitted");
	let release;
	const pending = doc.save(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	editor.edit("newer");
	release({
		outcome: "saved",
		current: snap("submitted"),
		retained: ["/backup"],
	});
	assert.equal(await pending, true);
	assert.equal(doc.isDirty(), true);
	assert.equal(editor.getSource(), "newer");
	assert.deepEqual(doc.retained, ["/backup"]);
});

test("a slow clean reload cannot replace edits made while reading", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	let release;
	const pending = doc.checkExternal(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	editor.edit("unsaved");
	release(snap("external"));
	await pending;
	assert.equal(editor.getSource(), "unsaved");
	assert.equal(doc.conflict.source, "external");
	assert.equal(doc.isDirty(), true);
});

test("clean external reload applies; dirty deletion and changed disk retain buffer", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	await doc.checkExternal(async () => snap("external"));
	assert.equal(editor.getSource(), "external");
	assert.equal(doc.isDirty(), false);
	editor.edit("local");
	await doc.checkExternal(async () => snap(null, null));
	assert.equal(editor.getSource(), "local");
	assert.equal(doc.conflict.source, null);
	assert.equal(doc.isDirty(), true);
});

test("a publication-time conflict keeps the buffer dirty and exposes both disk versions", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	editor.edit("local");
	assert.equal(
		await doc.save(async () => ({
			outcome: "conflict",
			current: snap("local"),
			displaced: snap("racing writer"),
			retained: ["/old-inode"],
			message: "A race was observed",
		})),
		false,
	);
	assert.equal(editor.getSource(), "local");
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.conflict.source, "racing writer");
	assert.deepEqual(doc.retained, ["/old-inode"]);
});

test("discard decisions are deferred until every dirty tab accepts close", async () => {
	const a = { isDirty: () => true },
		b = { isDirty: () => true };
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

test("failed save aborts multi-tab close and keeps every document", async () => {
	const docs = [0, 1].map(() => ({
		dirty: true,
		isDirty() {
			return this.dirty;
		},
	}));
	let disposed = 0,
		saves = 0;
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

for (const decision of ["save", "discard", "cancel"]) {
	test(`an unchanged document still accepts normal ${decision}`, async () => {
		const editor = view();
		const doc = new DocumentSession(editor, snap("original"));
		editor.edit("source A");
		let disposed = 0,
			saves = 0;
		const result = await closeDocuments(
			[doc],
			async () => decision,
			async () => {
				saves++;
				return doc.save(async (source) => ({
					outcome: "saved",
					current: snap(source),
					retained: [],
				}));
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
	assert.equal(
		await close(async () => {
			assert.equal(editor.getSource(), "source B");
			return "discard";
		}),
		true,
	);
	assert.equal(disposed, 1);
});

for (const change of ["source", "state epoch", "edit then undo"]) {
	for (const decision of ["discard", "save"]) {
		test(`closing retains the same document after ${change} changes during pending ${decision}`, async () => {
			const editor = view();
			let revision = 1;
			editor.getRevision = () => revision;
			const doc = new DocumentSession(editor, snap("original"));
			editor.edit("source A");
			let release;
			let requested;
			const ready = new Promise((resolve) => {
				requested = resolve;
			});
			let disposed = 0,
				saves = 0;
			const pending = closeDocuments(
				[doc],
				() =>
					new Promise((resolve) => {
						release = resolve;
						requested();
					}),
				async () => {
					saves++;
					return doc.save(async (source) => ({
						outcome: "saved",
						current: snap(source),
						retained: [],
					}));
				},
				() => {
					disposed++;
					doc.dispose();
				},
			);
			await ready;
			const requestVersion = doc.closeVersion();
			if (change === "source") {
				editor.edit("source B");
				revision++;
			}
			if (change === "state epoch")
				await doc.checkExternal(async () => snap("original", "disk:2"));
			if (change === "edit then undo") {
				editor.edit("source B");
				revision++;
				editor.edit("source A");
				revision++;
			}
			assert.notEqual(doc.closeVersion(), requestVersion);
			release(decision);
			const result = await pending;
			console.log(
				JSON.stringify({
					change,
					decision,
					result,
					disposed,
					saves,
					source: editor.getSource(),
					dirty: doc.isDirty(),
				}),
			);
			assert.equal(result, false);
			assert.equal(disposed, 0);
			assert.equal(saves, 0);
			assert.equal(
				editor.getSource(),
				change === "source" ? "source B" : "source A",
			);
			assert.equal(doc.isDirty(), true);
		});
	}
}

test("disposal prevents a pending external reload from touching the old editor", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	let release;
	const pending = doc.checkExternal(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	doc.dispose();
	release(snap("external"));
	await pending;
	assert.equal(editor.getSource(), "original");
});

test("an external read from before a completed save cannot rewind the saved baseline", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	let release;
	const check = doc.checkExternal(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	editor.edit("local");
	await doc.save(async () => ({
		outcome: "saved",
		current: snap("local"),
		retained: [],
	}));
	release(snap("older external"));
	await check;
	assert.equal(editor.getSource(), "local");
	assert.equal(doc.isDirty(), false);
	assert.equal(doc.conflict, null);
});

test("polling the same published target preserves the displaced conflict snapshot", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	editor.edit("local");
	await doc.save(async () => ({
		outcome: "conflict",
		current: snap("local"),
		displaced: snap("racing external"),
		retained: ["/retained"],
	}));
	await doc.checkExternal(async () => snap("local"));
	assert.equal(doc.conflict.source, "racing external");
	assert.equal(doc.isDirty(), true);
});

test("failed Save As keeps recovery target B when original A is polled", async () => {
	const editor = view();
	const original = snap("original");
	const target = { ...snap("old B", "b0", "/B/b.pfdsl"), id: 2 };
	const current = { ...target, source: "local", revision: "b1" };
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	await doc.save(
		async () => ({
			outcome: "conflict",
			current,
			displaced: { ...target, source: "external B" },
			retained: ["/B/retained"],
		}),
		target,
	);
	await doc.checkExternal(async (id) => (id === 2 ? current : original));
	assert.equal(doc.disk.id, 1);
	assert.equal(doc.observed.id, 2);
	assert.equal(doc.conflict.source, "external B");
	assert.equal(editor.getSource(), "local");
	const changedA = snap("external A");
	await doc.checkExternal(async (id) => (id === 2 ? current : changedA));
	assert.equal(doc.observed.id, 2);
	assert.equal(doc.sourceConflict.source, "external A");
	assert.equal(doc.conflict.source, "external B");
});

test("unconfirmed Save As without a readable result still belongs to the chosen target", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	const target = { ...snap("old B", "b0", "/B/b.pfdsl"), id: 2 };
	editor.edit("local");
	await doc.save(
		async () => ({
			outcome: "published-but-unconfirmed",
			retained: ["/B/retained"],
		}),
		target,
	);
	assert.equal(doc.disk.id, 1);
	assert.equal(doc.observed, null);
	assert.equal(doc.pendingTarget.id, 2);
	assert.equal(doc.isDirty(), true);
});

test("explicit disk adoption refuses edits made after confirmation", () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original"));
	const confirmed = doc.closeVersion();
	editor.edit("typed after confirmation");
	assert.equal(doc.useDiskIfUnchanged(snap("disk"), confirmed), false);
	assert.equal(editor.getSource(), "typed after confirmation");
	assert.equal(doc.useDiskIfUnchanged(snap("disk"), doc.closeVersion()), true);
	assert.equal(editor.getSource(), "disk");
});

test("close keeps every buffer when a disk observation makes a clean document missing during another close decision", async () => {
	const editor = view();
	editor.getRevision = () => 0;
	const a = new DocumentSession(editor, snap("original"));
	const b = new DocumentSession(view("draft"), null);
	b.view.edit("dirty B");
	let releaseRead;
	let releaseDecision;
	const decisions = [];
	const disposed = [];
	const closing = closeDocuments(
		[a, b],
		async (doc) => {
			decisions.push(doc);
			return new Promise((resolve) => {
				releaseDecision = resolve;
			});
		},
		async () => true,
		(doc) => disposed.push(doc),
	);
	for (let i = 0; i < 10; i++) await Promise.resolve();
	assert.deepEqual(decisions, [b]);
	const poll = a.checkExternal(
		() =>
			new Promise((resolve) => {
				releaseRead = resolve;
			}),
	);

	assert.equal(a.isDirty(), false);
	releaseRead(snap(null, null));
	await poll;
	assert.equal(a.isDirty(), true);
	assert.equal(a.view.getRevision(), 0);
	releaseDecision("discard");
	assert.equal(await closing, false);
	assert.deepEqual(disposed, []);
	assert.equal(editor.getSource(), "original");
	assert.equal(b.view.getSource(), "dirty B");
});

test("generic close state also rejects clean-to-dirty changes without an editor revision change", async () => {
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

test("same-inode explicit reopen rebinds a renamed dirty document without acknowledging edits", () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r0"));
	editor.edit("unique local edit");
	const renamed = { ...snap("original", "r0", "/renamed.pfdsl"), id: 9 };
	assert.equal(doc.rebindDisk(renamed), true);
	assert.equal(doc.disk.id, 9);
	assert.equal(doc.disk.path, renamed.path);
	assert.equal(editor.getSource(), "unique local edit");
	assert.equal(doc.savedSource, "original");
	assert.equal(doc.isDirty(), true);
});

test("same-inode explicit reopen reloads clean changes and exposes changed disk beside dirty edits", () => {
	const changed = { ...snap("external", "r1", "/renamed.pfdsl"), id: 9 };
	const clean = new DocumentSession(view(), snap("original", "r0"));
	assert.equal(clean.rebindDisk(changed), true);
	assert.equal(clean.view.getSource(), "external");
	assert.equal(clean.isDirty(), false);
	const editor = view();
	const dirty = new DocumentSession(editor, snap("original", "r0"));
	editor.edit("unique local edit");
	assert.equal(dirty.rebindDisk(changed), true);
	assert.equal(dirty.disk.id, 9);
	assert.equal(dirty.disk.revision, "r0");
	assert.equal(dirty.conflict.source, "external");
	assert.equal(editor.getSource(), "unique local edit");
	assert.equal(dirty.isDirty(), true);
});

test("rebinding source A preserves a separate unresolved Save As target B", async () => {
	const editor = view();
	const doc = new DocumentSession(editor, snap("original", "r0"));
	editor.edit("local");
	const B = { ...snap("B", "b0", "/B/b.pfdsl"), id: 2, identity: "file:2" };
	await doc.save(
		async () => ({
			outcome: "failed-before-publication",
			current: B,
			retained: [],
		}),
		B,
	);
	const renamed = { ...snap("external A", "r1", "/renamed.pfdsl"), id: 9 };
	assert.equal(doc.rebindDisk(renamed), true);
	assert.equal(doc.disk.id, 9);
	assert.equal(doc.pendingTarget, B);
	assert.equal(doc.observed, B);
	assert.equal(doc.sourceConflict, renamed);
	assert.equal(editor.getSource(), "local");
});

test("close waits for an already-running disk read and asks before discarding a newly missing clean buffer", async () => {
	const doc = new DocumentSession(view(), snap("original"));
	let release;
	const read = doc.checkExternal(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const disposed = [];
	let settled = false;
	const closing = closeDocuments(
		[doc],
		async () => "cancel",
		async () => true,
		(d) => disposed.push(d),
	).then((result) => {
		settled = true;
		return result;
	});
	for (let i = 0; i < 5; i++) await Promise.resolve();
	assert.equal(
		settled,
		false,
		"an unresolved preexisting poll must hold close",
	);
	assert.deepEqual(disposed, []);
	release(snap(null, null));
	await read;
	assert.equal(await closing, false);
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.view.getSource(), "original");
	assert.deepEqual(disposed, []);
});

test("unreadable disk state protects a previously clean editor as uncertain", async () => {
	const doc = new DocumentSession(view(), snap("original"));
	await assert.rejects(
		doc.checkExternal(async () => {
			throw new Error("Invalid UTF-8 or nonregular disk target");
		}),
	);
	assert.equal(doc.isDirty(), true);
	assert.equal(doc.view.getSource(), "original");
	let decisions = 0;
	const disposed = [];
	assert.equal(
		await closeDocuments(
			[doc],
			async () => {
				decisions++;
				return "cancel";
			},
			async () => true,
			(d) => disposed.push(d),
		),
		false,
	);
	assert.equal(decisions, 1);
	assert.deepEqual(disposed, []);
});

test("same-target failed Save recovery follows an explicit same-inode rename reopen", async () => {
	const original = snap("original", "r0");
	const editor = view();
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	await doc.save(async () => ({
		outcome: "failed-before-publication",
		current: original,
		retained: [],
	}));
	const renamed = { ...original, id: 9, path: "/renamed.pfdsl" };
	assert.equal(doc.rebindDisk(renamed), true);
	assert.equal(doc.pendingTarget.id, 9);
	assert.equal(doc.pendingTarget.path, renamed.path);
	const reads = [];
	await doc.checkExternal(async (id) => {
		reads.push(id);
		return id === 9 ? renamed : snap(null, null);
	});
	assert.deepEqual(reads, [9]);
	assert.equal(doc.observed.path, renamed.path);
	assert.equal(doc.view.getSource(), "local");
});

test("failed Save As selecting the same source with a new native id follows a same-inode rename", async () => {
	const original = snap("original", "r0");
	const editor = view();
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	const selectedAgain = { ...original, id: 2 };
	await doc.save(
		async () => ({
			outcome: "failed-before-publication",
			current: selectedAgain,
			retained: [],
		}),
		selectedAgain,
	);
	const renamed = { ...original, id: 9, path: "/renamed.pfdsl" };
	assert.equal(doc.rebindDisk(renamed), true);
	assert.equal(doc.pendingTarget.id, 9);
	assert.equal(doc.pendingTarget.path, renamed.path);
	const reads = [];
	await doc.checkExternal(async (id) => {
		reads.push(id);
		return id === 9 ? renamed : snap(null, null);
	});
	assert.deepEqual(reads, [9]);
	assert.equal(doc.observed.path, renamed.path);
	assert.equal(doc.view.getSource(), "local");
});

test("failed source Save after a parent move follows the same native capability on leaf rename", async () => {
	const original = snap("original", "r0", "/old-parent/a.pfdsl");
	const editor = view();
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	const movedParent = { ...original, path: "/moved-parent/a.pfdsl" };
	await doc.save(async () => ({
		outcome: "failed-before-publication",
		current: movedParent,
		retained: [],
	}));
	const renamed = { ...original, id: 9, path: "/moved-parent/c.pfdsl" };
	assert.equal(doc.rebindDisk(renamed), true);
	assert.equal(doc.pendingTarget.path, renamed.path);
	assert.equal(doc.pendingTarget.id, 9);
});

test("native parent-inode/leaf bindings distinguish reselected source capabilities from hard-link Save As targets", async () => {
	const original = {
		...snap("original", "r0", "/old-parent/a.pfdsl"),
		binding: "dir1:a.pfdsl",
	};
	const editor = view();
	const doc = new DocumentSession(editor, original);
	editor.edit("local");
	const selectedAgain = { ...original, id: 2, path: "/moved-parent/a.pfdsl" };
	await doc.save(
		async () => ({
			outcome: "failed-before-publication",
			current: selectedAgain,
			retained: [],
		}),
		selectedAgain,
	);
	const renamed = {
		...original,
		id: 9,
		path: "/moved-parent/c.pfdsl",
		binding: "dir1:c.pfdsl",
	};
	assert.equal(doc.rebindDisk(renamed), true);
	assert.equal(doc.pendingTarget.path, renamed.path);
	assert.equal(doc.pendingTarget.binding, renamed.binding);
	const alias = {
		...original,
		id: 2,
		path: "/old-parent/link.pfdsl",
		binding: "dir1:link.pfdsl",
	};
	const other = new DocumentSession(view(), original);
	other.view.edit("local");
	await other.save(
		async () => ({
			outcome: "failed-before-publication",
			current: alias,
			retained: [],
		}),
		alias,
	);
	assert.equal(other.rebindDisk(renamed), true);
	assert.equal(
		other.pendingTarget,
		alias,
		"a separate leaf remains its explicit Save As target",
	);
});

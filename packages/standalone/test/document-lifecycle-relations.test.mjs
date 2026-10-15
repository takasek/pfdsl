// Scenarios that tie a tab to the files around it: a renamed or reselected file,
// a target open in another tab, line-ending normalization, and the states a
// failed save or read leaves behind. They drive the production main.ts over the
// fake native filesystem and read only what the host records and the DOM shows.
import assert from "node:assert/strict";
import test from "node:test";
import {
	createHarness,
	FakeNative,
	flush,
	InspectGate,
	TEXT,
} from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("lifecycle-relations");

const change = (native, doc, source) => {
	doc.file = { source, ino: ++native.ino, mtime: ++native.clock };
};
/** An in-place write: the file keeps its inode, as it must for a rename to be recognised. */
const edit = (native, doc, source) => {
	doc.file = { ...doc.file, source, mtime: ++native.clock };
};
/** The same file under another leaf name; the old leaf is gone. */
const rename = (native, doc, id, name) => {
	const renamed = native.link(doc, id, name);
	doc.file = null;
	return renamed;
};
const inspected = (host) =>
	host.log.filter((item) => item.kind === "inspect").map((item) => item.id);
// Startup is empty; count the documents explicitly opened by each scenario.
const openTabs = (host) => host.tabs().filter((tab) => host.isOpen(tab));
const status = (host) => host.query("#status").textContent;

for (const external of [false, true]) {
	for (const dirty of [false, true]) {
		test(`reselecting a file that was ${external ? "changed" : "only touched"} (${dirty ? "dirty" : "clean"} tab)`, async () => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const again = native.reselect(a, 9);
			const host = await startHost(native, a, {});
			const tab = await host.open(a);
			if (dirty) tab.type(TEXT.edited);
			if (external) change(native, a, "disk v2 (external)\n");
			else a.file = { ...a.file, mtime: ++native.clock };
			const reopened = await host.open(again);
			try {
				assert.equal(reopened, tab);
				assert.equal(openTabs(host).length, 1);
				if (!external) {
					assert.equal(tab.setSourceCalls, 0, "a touch reloaded the editor");
					assert.equal(host.panel().present, false, "a touch raised a panel");
					assert.equal(host.isDirty(tab), dirty);
				} else if (dirty) {
					assert.equal(tab.getSource(), TEXT.edited);
					assert.equal(host.panel().present, true);
					assert.equal(host.panel().review.disabled, false);
					assert.equal(host.panel().preview, "disk v2 (external)\n");
				} else {
					assert.equal(tab.getSource(), "disk v2 (external)\n");
					assert.equal(host.isDirty(tab), false);
					assert.equal(host.panel().present, false);
				}
				if (dirty) {
					await host.cmdS();
					const saves = host.log.filter((item) => item.kind === "save");
					assert.deepEqual(
						saves.map((item) => item.id),
						[again.id],
					);
					assert.equal(a.file.source, TEXT.edited);
				}
			} finally {
				assert.deepEqual(await host.finish(), []);
			}
		});
	}
}

test("a dirty tab follows its file to a new leaf name only after the old leaf is seen missing", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const host = await startHost(native, a, {});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	const renamed = rename(native, a, 9, "renamed.pfdsl");
	try {
		const reopened = await host.open(renamed);
		assert.equal(reopened, tab);
		assert.equal(openTabs(host).length, 1);
		assert.equal(tab.getSource(), TEXT.edited);
		assert.equal(host.isDirty(tab), true);
		assert.equal(host.nameOf(tab), "renamed.pfdsl");
		assert.equal(host.panel().present, false);
		host.log.length = 0;
		await host.cmdS();
		assert.deepEqual(
			host.log.filter((item) => item.kind === "save").map((item) => item.id),
			[9],
		);
		assert.equal(renamed.file.source, TEXT.edited);
		assert.equal(a.file, null, "the old leaf was written again");
		assert.equal(host.isDirty(tab), false);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a renamed file whose old leaf still exists opens in a second tab", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const host = await startHost(native, a, {});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	const alias = native.link(a, 3, "alias.pfdsl");
	try {
		const second = await host.open(alias);
		assert.notEqual(second, tab);
		assert.equal(openTabs(host).length, 2);
		assert.equal(tab.getSource(), TEXT.edited);
		assert.equal(host.isDirty(second), false);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a clean tab reloads a renamed file whose content changed", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const host = await startHost(native, a, {});
	const tab = await host.open(a);
	const renamed = rename(native, a, 9, "renamed.pfdsl");
	edit(native, renamed, "disk v2 (external)\n");
	try {
		assert.equal(await host.open(renamed), tab);
		assert.equal(tab.getSource(), "disk v2 (external)\n");
		assert.equal(host.isDirty(tab), false);
		assert.equal(host.panel().present, false);
		assert.equal(host.nameOf(tab), "renamed.pfdsl");
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a renamed file that changed beside dirty edits keeps both and shows the disk version", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const host = await startHost(native, a, {});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	const renamed = rename(native, a, 9, "renamed.pfdsl");
	edit(native, renamed, "disk v2 (external)\n");
	try {
		assert.equal(await host.open(renamed), tab);
		assert.equal(tab.getSource(), TEXT.edited);
		assert.equal(tab.setSourceCalls, 0);
		assert.equal(host.isDirty(tab), true);
		const panel = host.panel();
		assert.equal(panel.present, true);
		assert.equal(panel.preview, "disk v2 (external)\n");
		assert.equal(panel.recoveryPath, renamed.path);
		assert.equal(panel.review.disabled, false);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a failed Save recovery follows an explicit rename of its file", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	let armed = true;
	const host = await startHost(native, a, {
		beforeSave() {
			if (!armed) return;
			armed = false;
			edit(native, a, "external A\n");
		},
		confirm: async () => "cancel",
	});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	// The file changes right before the write reaches the native side.
	await host.cmdS();
	try {
		assert.equal(host.panel().recoveryPath, a.path);
		const renamed = rename(native, a, 9, "renamed.pfdsl");
		assert.equal(await host.open(renamed), tab);
		assert.equal(openTabs(host).length, 1);
		assert.equal(tab.getSource(), TEXT.edited);
		assert.equal(host.panel().recoveryPath, renamed.path);
		assert.equal(host.panel().originalAlsoChanged, false);
		host.log.length = 0;
		await host.runPoll();
		assert.deepEqual(inspected(host), [9]);
		await host.click(host.panel().review);
		assert.equal(renamed.file.source, TEXT.edited);
		assert.equal(host.panel().present, false);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

/** Fails Save As to B, then runs `rename` for the original. */
async function failedSaveAs(options = {}) {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	let chosen = options.chosen ?? (() => native.snapshot(b));
	const host = await startHost(native, a, {
		choose: () => chosen(),
		confirm: async () => "cancel",
		saveFault: options.saveFault,
		beforeSave: (args) => options.beforeSave?.(args),
	});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	await host.click(host.query("#save-as"));
	return {
		native,
		a,
		b,
		host,
		tab,
		choose(next) {
			chosen = next;
		},
	};
}

for (const externalChange of [false, true]) {
	test(`a failed Save As target stays put when the original is renamed${externalChange ? " and changed" : ""}`, async () => {
		const { native, a, b, host, tab } = await failedSaveAs({
			saveFault: (args) => (args.id === 2 ? "before" : undefined),
		});
		try {
			assert.equal(host.panel().recoveryPath, b.path);
			const renamed = rename(native, a, 9, "renamed.pfdsl");
			if (externalChange) edit(native, renamed, "external A\n");
			assert.equal(await host.open(renamed), tab);
			assert.equal(openTabs(host).length, 1);
			assert.equal(tab.getSource(), TEXT.edited);
			assert.equal(host.panel().recoveryPath, b.path);
			assert.equal(host.nameOf(tab), "renamed.pfdsl");
			host.log.length = 0;
			await host.runPoll();
			assert.deepEqual([...new Set(inspected(host))].sort(), [2, 9]);
			assert.equal(host.panel().recoveryPath, b.path);
			assert.equal(host.panel().originalAlsoChanged, externalChange);
		} finally {
			assert.deepEqual(await host.finish(), []);
		}
	});
}

test("a hard-link Save As target keeps its own leaf when the original is renamed", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const link = native.link(a, 2, "link.pfdsl");
	const host = await startHost(native, a, {
		choose: () => native.snapshot(link),
		saveFault: (args) => (args.id === 2 ? "before" : undefined),
		confirm: async () => "cancel",
	});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	await host.click(host.query("#save-as"));
	try {
		assert.equal(host.panel().recoveryPath, link.path);
		const renamed = rename(native, a, 9, "renamed.pfdsl");
		assert.equal(await host.open(renamed), tab);
		assert.equal(openTabs(host).length, 1);
		assert.equal(host.panel().recoveryPath, link.path);
		host.log.length = 0;
		await host.runPoll();
		assert.deepEqual([...new Set(inspected(host))].sort(), [2, 9]);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a Save As target that reselects the original follows the original's rename", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const again = native.reselect(a, 2);
	let armed = true;
	const host = await startHost(native, a, {
		choose: () => native.snapshot(again),
		beforeSave(args) {
			if (!armed || args.id !== 2) return;
			armed = false;
			edit(native, a, "external A\n");
		},
		confirm: async () => "cancel",
	});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	await host.click(host.query("#save-as"));
	try {
		assert.equal(host.panel().present, true);
		const renamed = rename(native, a, 9, "renamed.pfdsl");
		assert.equal(await host.open(renamed), tab);
		assert.equal(openTabs(host).length, 1);
		assert.equal(tab.getSource(), TEXT.edited);
		assert.equal(host.panel().recoveryPath, renamed.path);
		host.log.length = 0;
		await host.runPoll();
		assert.deepEqual(inspected(host), [9]);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a parent move and a later leaf rename keep the failed Save recovery on the same file", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	let armed = true;
	const host = await startHost(native, a, {
		beforeSave() {
			if (!armed) return;
			armed = false;
			// The directory moved and the file changed, so the reply names the new path.
			native.move(a, "/moved/A/a.pfdsl");
			edit(native, a, "external A\n");
		},
		confirm: async () => "cancel",
	});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	await host.cmdS();
	try {
		assert.equal(host.panel().recoveryPath, "/moved/A/a.pfdsl");
		const renamed = rename(native, a, 9, "c.pfdsl");
		assert.equal(await host.open(renamed), tab);
		assert.equal(host.panel().recoveryPath, renamed.path);
		assert.equal(openTabs(host).length, 1);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

for (const dirty of [false, true]) {
	test(`an explicit Discard closes a ${dirty ? "dirty" : "clean"} tab whose file stays unreadable`, async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", TEXT.disk);
		const asked = [];
		const host = await startHost(native, a, {
			confirm: async (name) => {
				asked.push(name);
				return "discard";
			},
		});
		const tab = await host.open(a);
		if (dirty) tab.type(TEXT.edited);
		a.unreadable = true;
		await host.runPoll();
		try {
			await host.click(host.closeButton(tab));
			assert.equal(asked.length, 1);
			assert.equal(host.isOpen(tab), false);
			assert.equal(
				host.log.filter((item) => item.kind === "save").length,
				0,
				"Discard saved",
			);
		} finally {
			assert.deepEqual(await host.finish(), []);
		}
	});
}

for (const dirty of [false, true]) {
	test(`a file that becomes readable again during a Discard prompt refuses the decision (${dirty ? "dirty" : "clean"} tab)`, async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", TEXT.disk);
		let during = true;
		const host = await startHost(native, a, {
			async confirm() {
				if (during) {
					during = false;
					a.unreadable = false;
				}
				return "discard";
			},
		});
		const tab = await host.open(a);
		if (dirty) tab.type(TEXT.edited);
		a.unreadable = true;
		await host.runPoll();
		try {
			await host.click(host.closeButton(tab));
			assert.equal(host.isOpen(tab), true, "the stale decision closed the tab");
			assert.equal(tab.getSource(), dirty ? TEXT.edited : TEXT.disk);
		} finally {
			assert.deepEqual(await host.finish(), []);
		}
	});
}

test("an edit made while a poll is still reading wins over the file's change", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const gate = new InspectGate(native);
	const host = await startHost(native, a, {
		inspectGate: (id) => gate.hold(id),
		confirm: async () => "cancel",
	});
	const tab = await host.open(a);
	change(native, a, "disk v2 (external)\n");
	gate.arm(a.id);
	await host.runPoll();
	assert.equal(gate.isHeld, true);
	tab.type("typed during the read\n");
	gate.release();
	await flush();
	try {
		assert.equal(tab.getSource(), "typed during the read\n");
		assert.equal(tab.setSourceCalls, 0);
		assert.equal(host.isDirty(tab), true);
		assert.equal(host.panel().present, true);
		assert.equal(host.panel().preview, "disk v2 (external)\n");
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a poll that finishes after a successful save cannot rewind the saved state", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const gate = new InspectGate(native);
	const host = await startHost(native, a, {
		inspectGate: (id) => gate.hold(id),
		confirm: async () => "cancel",
	});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	gate.arm(a.id);
	await host.runPoll();
	assert.equal(gate.isHeld, true);
	await host.cmdS();
	try {
		assert.equal(a.file.source, TEXT.edited);
		gate.release();
		await flush();
		assert.equal(tab.getSource(), TEXT.edited);
		assert.equal(host.isDirty(tab), false);
		assert.equal(host.panel().present, false);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a close waits for a poll already reading and then asks about the file it found missing", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const gate = new InspectGate(native);
	const asked = [];
	const host = await startHost(native, a, {
		inspectGate: (id) => gate.hold(id),
		confirm: async (name) => {
			asked.push(name);
			return "cancel";
		},
	});
	const tab = await host.open(a);
	a.file = null;
	gate.arm(a.id);
	await host.runPoll();
	assert.equal(gate.isHeld, true);
	host.closeButton(tab).click();
	await flush();
	try {
		assert.deepEqual(asked, [], "the close did not wait for the running read");
		assert.equal(host.isOpen(tab), true);
		gate.release();
		await host.settle();
		assert.equal(asked.length, 1);
		assert.equal(host.isOpen(tab), true);
		assert.equal(host.isDirty(tab), true);
		assert.equal(tab.getSource(), TEXT.disk);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("Use Current Disk Version keeps an edit made while its dialog is open", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	let tab;
	const host = await startHost(native, a, {
		confirm: async () => "cancel",
		dialogChoice: (title) =>
			title === "Discard editor changes" ? "Use Disk Version" : undefined,
		onDialog(dialog) {
			if (dialog.title === "Discard editor changes")
				tab.type("typed while the dialog was open\n");
		},
	});
	tab = await host.open(a);
	tab.type(TEXT.edited);
	change(native, a, "disk v2 (external)\n");
	await host.runPoll();
	await host.click(host.panel().use);
	try {
		assert.equal(tab.getSource(), "typed while the dialog was open\n");
		assert.equal(tab.setSourceCalls, 0);
		assert.match(status(host), /editor changed/);
		assert.equal(host.panel().present, true);
		assert.equal(host.isDirty(tab), true);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("Save keeps an edit made while the write was in flight as unsaved text", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	let tab;
	const host = await startHost(native, a, {
		beforeSave() {
			tab.type("newer than the saved text\n");
		},
	});
	tab = await host.open(a);
	tab.type(TEXT.edited);
	await host.cmdS();
	try {
		assert.equal(a.file.source, TEXT.edited);
		assert.equal(tab.getSource(), "newer than the saved text\n");
		assert.equal(host.isDirty(tab), true);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

for (const how of ["content", "deletion"]) {
	test(`a dirty tab drops the conflict panel when the file returns to its acknowledged state after ${how}`, async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", TEXT.disk);
		const host = await startHost(native, a, { confirm: async () => "cancel" });
		const tab = await host.open(a);
		tab.type(TEXT.edited);
		const original = a.file;
		if (how === "content") change(native, a, "disk v2 (external)\n");
		else a.file = null;
		await host.runPoll();
		try {
			assert.equal(host.panel().present, true);
			a.file = original;
			await host.runPoll();
			assert.equal(host.panel().present, false);
			assert.equal(host.isDirty(tab), true, "the unsaved text lost its mark");
			assert.equal(tab.getSource(), TEXT.edited);
			assert.equal(tab.setSourceCalls, 0);
		} finally {
			assert.deepEqual(await host.finish(), []);
		}
	});
}

test("a clean tab keeps the unsaved mark after its Save As lost the reply", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const host = await startHost(native, a, {
		choose: () => native.snapshot(b),
		saveFault: (args) => (args.id === 2 ? "after" : undefined),
		confirm: async () => "cancel",
	});
	const tab = await host.open(a);
	await host.click(host.query("#save-as"));
	try {
		assert.equal(tab.getSource(), TEXT.disk);
		assert.equal(host.isDirty(tab), true);
		const panel = host.panel();
		assert.equal(panel.present, true);
		assert.equal(panel.recoveryPath, b.path);
		assert.match(
			host.query("#conflicts p").textContent,
			/could not be confirmed/,
		);
		assert.equal(panel.review.disabled, true);
		assert.equal(panel.use.disabled, true);
		assert.equal(panel.saveAs.disabled, false);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("a published but unconfirmed save keeps its receipt, the buffer and the recovery target", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const host = await startHost(native, a, {
		choose: () => native.snapshot(b),
		saveReply: (args) =>
			args.id === 2
				? {
						outcome: "published-but-unconfirmed",
						publication: "published",
						targetState: "unreadable",
						message: "Publication occurred; target cannot be read.",
					}
				: undefined,
		confirm: async () => "cancel",
		dialogChoice: (title) =>
			title === "Discard editor changes" ? "Use Disk Version" : undefined,
	});
	const tab = await host.open(a);
	tab.type(TEXT.edited);
	await host.click(host.query("#save-as"));
	try {
		const text = () => host.query("#conflicts p").textContent;
		assert.match(
			text(),
			/Content was published, but the save was not accepted/,
		);
		assert.match(text(), /Publication occurred; target cannot be read/);
		assert.match(text(), /Recovery target: \/A\/b\.pfdsl\./);
		assert.equal(host.panel().review.disabled, true);
		assert.equal(host.panel().use.disabled, true);
		assert.equal(host.panel().saveAs.disabled, false);
		assert.equal(host.isDirty(tab), true);
		assert.equal(tab.getSource(), TEXT.edited);
		await host.runPoll();
		assert.match(
			text(),
			/Content was published, but the save was not accepted/,
		);
		assert.equal(host.isDirty(tab), true);
		assert.equal(tab.getSource(), TEXT.edited);
		assert.equal(host.panel().preview, "old B\n");
		assert.equal(host.panel().use.disabled, false);
		await host.click(host.panel().use);
		assert.equal(tab.getSource(), "old B\n");
		assert.equal(host.panel().present, false);
		assert.equal(host.isDirty(tab), false);
		assert.equal(host.nameOf(tab), "b.pfdsl");
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("Save As onto a file that another tab has open is refused with both buffers kept", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const again = native.reselect(b, 20);
	const host = await startHost(native, a, {
		choose: () => native.snapshot(again),
		confirm: async () => "cancel",
	});
	const first = await host.open(a);
	first.type(TEXT.edited);
	const second = await host.open(b);
	second.type("unsaved B\n");
	first.button.click();
	host.log.length = 0;
	await host.click(host.query("#save-as"));
	try {
		assert.match(status(host), /already open as b\.pfdsl/);
		assert.equal(host.log.filter((item) => item.kind === "save").length, 0);
		assert.equal(host.log.filter((item) => item.kind === "dialog").length, 0);
		assert.equal(first.getSource(), TEXT.edited);
		assert.equal(second.getSource(), "unsaved B\n");
		assert.equal(b.file.source, "old B\n");
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("Use Current Disk Version refuses a recovery target that another tab has open", async () => {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const host = await startHost(native, a, {
		choose() {
			const chosen = native.snapshot(b);
			change(native, b, "external B\n");
			return chosen;
		},
		confirm: async () => "cancel",
		dialogChoice: (title) =>
			title === "Discard editor changes" ? "Use Disk Version" : undefined,
	});
	const first = await host.open(a);
	first.type(TEXT.edited);
	await host.click(host.query("#save-as"));
	assert.equal(host.panel().recoveryPath, b.path);
	const second = await host.open(b);
	second.type("unsaved B\n");
	first.button.click();
	host.log.length = 0;
	try {
		await host.click(host.panel().use);
		assert.match(status(host), /already open as b\.pfdsl/);
		assert.equal(host.log.filter((item) => item.kind === "dialog").length, 0);
		assert.equal(first.getSource(), TEXT.edited);
		assert.equal(second.getSource(), "unsaved B\n");
		assert.equal(host.nameOf(first), "a.pfdsl");
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

// Monaco rewrites mixed line endings to one style; the tab stub does the same
// while a test installs reviewNormalize.
const MIXED = "a >> p\np -> c\r\n";
const NORMALIZED = "a >> p\r\np -> c\r\n";
const normalize = (text) => {
	const crlf = (text.match(/\r\n/g) ?? []).length;
	const lf = (text.match(/\n/g) ?? []).length - crlf;
	return text.replace(/\r?\n/g, crlf >= lf ? "\r\n" : "\n");
};

async function withNormalization(body) {
	globalThis.reviewNormalize = normalize;
	try {
		await body();
	} finally {
		delete globalThis.reviewNormalize;
	}
}

test("a file with mixed line endings opens clean, stays clean and closes without a write", () =>
	withNormalization(async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", MIXED);
		const asked = [];
		const host = await startHost(native, a, {
			confirm: async (name) => {
				asked.push(name);
				return "cancel";
			},
		});
		const tab = await host.open(a);
		try {
			assert.equal(tab.getSource(), NORMALIZED);
			assert.equal(host.isDirty(tab), false);
			await host.runPoll();
			await host.runPoll();
			assert.equal(host.isDirty(tab), false);
			assert.equal(host.panel().present, false);
			a.file = { ...a.file, mtime: ++native.clock };
			await host.runPoll();
			assert.equal(host.isDirty(tab), false);
			assert.equal(tab.setSourceCalls, 0);
			await host.click(host.closeButton(tab));
			assert.deepEqual(asked, []);
			assert.equal(host.isOpen(tab), false);
			assert.equal(a.writes, 0);
			assert.equal(a.file.source, MIXED);
		} finally {
			assert.deepEqual(await host.finish(), []);
		}
	}));

test("an external change to mixed line endings reloads the normalized text without a dirty mark", () =>
	withNormalization(async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", "a >> p\np -> b\n");
		const host = await startHost(native, a, {});
		const tab = await host.open(a);
		change(native, a, MIXED);
		try {
			await host.runPoll();
			assert.equal(tab.getSource(), NORMALIZED);
			assert.equal(host.isDirty(tab), false);
			const reloads = tab.setSourceCalls;
			await host.runPoll();
			assert.equal(tab.setSourceCalls, reloads);
			assert.equal(host.isDirty(tab), false);
			assert.equal(host.panel().present, false);
		} finally {
			assert.deepEqual(await host.finish(), []);
		}
	}));

test("a manual Save of a clean mixed-ending tab writes the normalized text without a review", () =>
	withNormalization(async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", MIXED);
		const host = await startHost(native, a, {});
		const tab = await host.open(a);
		try {
			await host.cmdS();
			assert.equal(host.log.filter((item) => item.kind === "dialog").length, 0);
			assert.equal(a.file.source, NORMALIZED);
			assert.equal(a.writes, 1);
			assert.equal(host.isDirty(tab), false);
			await host.cmdS();
			assert.match(status(host), /Already saved|nothing to save/);
			assert.equal(a.writes, 1);
		} finally {
			assert.deepEqual(await host.finish(), []);
		}
	}));

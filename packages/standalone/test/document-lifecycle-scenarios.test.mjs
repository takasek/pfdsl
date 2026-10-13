// Single-state scenarios that the matrices cannot express: an inspection in
// flight while a dialog is open, undoing back to the saved text, the chooser
// picking an existing file, and what a dialog or a status line says.
import assert from "node:assert/strict";
import { cell, guardKnownRed } from "./helpers/known-red.mjs";
import {
	createHarness,
	FakeNative,
	InspectGate,
	TEXT,
} from "./helpers/lifecycle-harness.mjs";
import {
	beginAction,
	checkAction,
	checkPanel,
} from "./helpers/lifecycle-invariants.mjs";

const { startHost } = await createHarness("lifecycle-scenarios");

const external = (native, doc, source) => {
	doc.file = { source, ino: ++native.ino, mtime: ++native.clock };
};

/** Collects invariant violations. */
function judge() {
	const violations = [];
	return {
		violations,
		violate: (name, detail) => violations.push(`${name}: ${detail}`),
	};
}

for (const [name, setup] of [
	[
		"Save As onto an existing file",
		async ({ host, ctx }) => {
			ctx.chooser = () => ctx.native.snapshot(ctx.b);
			await host.click(host.query("#save-as"));
		},
	],
	[
		"Save with the file deleted",
		async ({ host, ctx }) => {
			ctx.a.file = null;
			await host.cmdS();
		},
	],
]) {
	cell(
		`an inspection in flight cannot change the text a review is about to use (${name})`,
		async () => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const b = native.add(2, "b.pfdsl", "old B\n");
			const gate = new InspectGate(native);
			const ctx = { native, a, b, chooser: undefined };
			const host = await startHost(native, a, {
				choose: () => ctx.chooser(),
				confirm: async () => "cancel",
				inspectGate: (id) => gate.hold(id),
				onDialog() {
					// The poll's read finishes while the dialog is open.
					if (!gate.isHeld) return;
					external(native, a, "changed while the dialog is open\n");
					gate.release();
				},
			});
			const { violate, violations } = judge();
			const tab = await host.open(a);
			gate.arm(a.id);
			await host.runPoll();
			const trace = beginAction({ host, tab, owned: [a.id] });
			await setup({ host, ctx });
			checkAction({ native, host, tab, trace, violate });
			checkPanel({ host, native, violate });
			assert.deepEqual(await host.finish(), []);
			return violations;
		},
	);
}

for (const confirm of [true, false]) {
	cell(
		`undoing back to the saved text keeps the unsaved state (${confirm ? "Replace" : "Keep Editing"})`,
		async () => {
			const native = new FakeNative();
			const a = native.add(1, "a.pfdsl", TEXT.disk);
			const host = await startHost(native, a, {
				confirm: async () => "cancel",
				dialogChoice: (title) =>
					title === "Review the target" && !confirm
						? "Keep Editing"
						: undefined,
			});
			const { violate, violations } = judge();
			const tab = await host.open(a);
			tab.type(TEXT.edited);
			external(native, a, "disk v2 (external)\n");
			await host.runPoll();
			tab.type(TEXT.disk);
			const trace = beginAction({ host, tab, owned: [a.id] });
			await host.cmdS();
			checkAction({ native, host, tab, trace, violate });
			checkPanel({ host, native, violate });
			if (!confirm) assert.equal(a.file.source, "disk v2 (external)\n");
			assert.deepEqual(await host.finish(), []);
			return violations;
		},
	);
}

for (const target of ["existing", "new"]) {
	for (const via of ["cmd-s", "save-as"]) {
		cell(
			`Untitled ${via} onto a ${target} file goes through the same review`,
			async () => {
				const native = new FakeNative();
				const c = native.add(3, "c.pfdsl", "old C\n");
				if (target === "new") c.file = null;
				const host = await startHost(native, c, {
					choose: () => native.snapshot(c),
					confirm: async () => "cancel",
				});
				const { violate, violations } = judge();
				const tab = await host.newDocument();
				tab.type(TEXT.edited);
				const trace = beginAction({ host, tab, owned: [c.id] });
				if (via === "cmd-s") await host.cmdS();
				else await host.click(host.query("#save-as"));
				checkAction({ native, host, tab, trace, violate });
				assert.equal(c.file?.source, TEXT.edited);
				const review = host.log.find(
					(item) =>
						item.kind === "dialog" && item.title === "Review the target",
				);
				assert.equal(Boolean(review), target === "existing");
				assert.deepEqual(await host.finish(), []);
				return violations;
			},
		);
	}
}

cell(
	"a review says that the disk version differs and that a further change stops the save",
	async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", TEXT.disk);
		const b = native.add(2, "b.pfdsl", "old B\n");
		const host = await startHost(native, a, {
			choose: () => native.snapshot(b),
			confirm: async () => "cancel",
		});
		const tab = await host.open(a);
		tab.type(TEXT.edited);
		await host.click(host.query("#save-as"));
		const review = host.log.find((item) => item.title === "Review the target");
		assert.match(review.text, /disk version .* differs from the editor/);
		assert.match(review.text, /further change before saving stops the save/);
		assert.deepEqual(await host.finish(), []);
	},
);

cell(
	"Use Current Disk Version ignores a touch that happens while its dialog is open",
	async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", TEXT.disk);
		const host = await startHost(native, a, {
			confirm: async () => "cancel",
			dialogChoice: (title) =>
				title === "Discard editor changes" ? "Use Disk Version" : undefined,
			onDialog(dialog) {
				if (dialog.title === "Discard editor changes")
					a.file = { ...a.file, mtime: ++native.clock };
			},
		});
		const tab = await host.open(a);
		tab.type(TEXT.edited);
		external(native, a, "disk v2 (external)\n");
		await host.runPoll();
		await host.click(host.panel().use);
		assert.equal(tab.getSource(), "disk v2 (external)\n");
		assert.doesNotMatch(host.query("#status").textContent, /changed again/);
		assert.deepEqual(await host.finish(), []);
	},
);

cell(
	"Review and Save Here on an unchanged target keeps the failure message",
	async () => {
		const native = new FakeNative();
		const a = native.add(1, "a.pfdsl", TEXT.disk);
		const b = native.add(2, "b.pfdsl", "old B\n");
		const ctx = { cancel: false, lose: true };
		const host = await startHost(native, a, {
			choose: () => native.snapshot(b),
			confirm: async () => "cancel",
			saveFault(args) {
				if (!ctx.lose || args.id !== 2) return undefined;
				ctx.lose = false;
				return "before";
			},
			dialogChoice: (title) =>
				ctx.cancel && title === "Review the target"
					? "Keep Editing"
					: undefined,
		});
		const tab = await host.open(a);
		tab.type(TEXT.edited);
		await host.click(host.query("#save-as"));
		// A poll learns what B holds, which enables Review and Save Here.
		await host.runPoll();
		const says = () => host.query("#conflicts p").textContent;
		const message = says();
		assert.match(message, /could not be confirmed/);
		assert.equal(host.panel().review.disabled, false);
		ctx.cancel = true;
		await host.click(host.panel().review);
		assert.equal(says(), message);
		assert.deepEqual(await host.finish(), []);
	},
);

cell(
	"the fake native creates exclusively and replaces only the expected revision",
	() => {
		const native = new FakeNative();
		const doc = native.add(1, "a.pfdsl", "existing\n");
		const violations = [];
		const create = native.save(doc, "new\n", null);
		if (create.outcome !== "conflict" || doc.file.source !== "existing\n")
			violations.push("an existing file was created over");
		const replace = native.save(doc, "new\n", native.snapshot(doc).revision);
		if (replace.outcome !== "saved" || doc.file.source !== "new\n")
			violations.push("the expected revision was refused");
		doc.file = null;
		if (native.save(doc, "again\n", null).outcome !== "saved")
			violations.push("a missing target was not created");
		return violations;
	},
);

guardKnownRed();

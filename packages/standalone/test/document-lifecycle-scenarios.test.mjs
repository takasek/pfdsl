// Single-state scenarios that the matrices cannot express: an inspection in
// flight while a dialog is open, undoing back to the saved text, the chooser
// picking an existing file, and what a dialog or a status line says.
import assert from "node:assert/strict";
import { cell, guardKnownRed } from "./helpers/known-red.mjs";
import {
	createHarness,
	FakeNative,
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
		async ({ native, host, ctx }) => {
			ctx.chooser = () => native.snapshot(ctx.b);
			await host.click(host.query("#save-as"));
		},
	],
	[
		"Save with the file deleted",
		async ({ native, host, ctx }) => {
			ctx.a.file = null;
			void native;
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
			const ctx = { a, b, hold: false, release: undefined, chooser: undefined };
			const host = await startHost(native, a, {
				choose: () => ctx.chooser(),
				confirm: async () => "cancel",
				inspectGate: (id) =>
					ctx.hold && id === 1
						? new Promise((resolve) => {
								ctx.hold = false;
								ctx.release = resolve;
							})
						: undefined,
				onDialog() {
					// The poll's read finishes while the dialog is open.
					if (!ctx.release) return;
					external(native, a, "changed while the dialog is open\n");
					ctx.release(native.snapshot(a));
					ctx.release = undefined;
				},
			});
			const { violate, violations } = judge();
			const entry = await host.open(a);
			ctx.hold = true;
			await host.runPoll();
			const trace = beginAction({ host, entry });
			await setup({ native, host, ctx });
			checkAction({ native, host, entry, trace, violate });
			checkPanel({ host, entry, violate });
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
			const entry = await host.open(a);
			entry.tab.type(TEXT.edited);
			external(native, a, "disk v2 (external)\n");
			await host.runPoll();
			entry.tab.type(TEXT.disk);
			const trace = beginAction({ host, entry });
			await host.cmdS();
			checkAction({ native, host, entry, trace, violate });
			checkPanel({ host, entry, violate });
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
				await host.click(host.query("#new"));
				const entry = globalThis.reviewActive();
				entry.tab.type(TEXT.edited);
				const trace = beginAction({ host, entry });
				if (via === "cmd-s") await host.cmdS();
				else await host.click(host.query("#save-as"));
				checkAction({ native, host, entry, trace, violate });
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
		const entry = await host.open(a);
		entry.tab.type(TEXT.edited);
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
		const entry = await host.open(a);
		entry.tab.type(TEXT.edited);
		external(native, a, "disk v2 (external)\n");
		await host.runPoll();
		const use = host
			.queryAll("#conflicts button")
			.find((item) => item.textContent === "Use Current Disk Version…");
		await host.click(use);
		assert.equal(entry.tab.getSource(), "disk v2 (external)\n");
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
		const entry = await host.open(a);
		entry.tab.type(TEXT.edited);
		await host.click(host.query("#save-as"));
		// A poll learns what B holds, which enables Review and Save Here.
		await host.runPoll();
		const message = entry.session.message;
		assert.match(message, /could not be confirmed/);
		assert.ok(entry.session.observed);
		ctx.cancel = true;
		const review = host
			.queryAll("#conflicts button")
			.find((item) => item.textContent === "Review and Save Here…");
		await host.click(review);
		assert.equal(entry.session.message, message);
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

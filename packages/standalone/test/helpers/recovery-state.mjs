// Builds the recovery states the lifecycle tests start from: a Save As or Save
// that did not complete, optionally followed by further user steps.
import { FakeNative, fsOf, InspectGate, TEXT } from "./lifecycle-harness.mjs";

/** Applies an external event to a fake file. */
export function apply(native, doc, event) {
	if (event === "content-changed")
		doc.file = {
			source: `external ${doc.id}\n`,
			ino: ++native.ino,
			mtime: ++native.clock,
		};
	else if (event === "metadata-only")
		doc.file = { ...doc.file, mtime: ++native.clock };
	else if (event === "deleted") doc.file = null;
	else if (event === "unreadable") doc.unreadable = true;
	else if (event === "recovered") doc.unreadable = false;
	// The selected directory moved: the same file, another path.
	else if (event === "moved") native.move(doc, `/moved${doc.path}`);
	else if (event === "moved-changed") {
		native.move(doc, `/moved${doc.path}`);
		apply(native, doc, "content-changed");
	}
}

/** What a user could see of a file: its text, "missing" or "unreadable". */
export const content = (native, doc) => {
	const snapshot = fsOf(native, doc);
	return snapshot.unreadable ? "unreadable" : (snapshot.source ?? "missing");
};

/**
 * Brings the tab into the recovery state of `failure`, then runs the user steps
 * of `history`:
 *   cancel-again  a second Save As is cancelled at its review;
 *   fail-again    a second Save As fails once more;
 *   other-fails   a plain Save of the original fails, so the recovery target
 *                 becomes the original itself.
 */
export async function establish(startHost, failure, history = "none") {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const ctx = {
		native,
		a,
		b,
		gate: new InspectGate(native),
		tabName: undefined,
		decision: "cancel",
		onConfirm: undefined,
		onLate: undefined,
		useDisk: false,
		dialogOverride: undefined,
		faults: new Map(),
		chooser: undefined,
		beforeSave: undefined,
	};
	ctx.host = await startHost(native, a, {
		choose: () => ctx.chooser(),
		saveFault: (args) => ctx.faults.get(args.id)?.(),
		beforeSave: (args) => ctx.beforeSave?.(args),
		inspectGate: (id) => ctx.gate.hold(id),
		dialogChoice: (title) =>
			ctx.dialogOverride?.(title) ??
			(ctx.useDisk && title === "Discard editor changes"
				? "Use Disk Version"
				: undefined),
		onDialog() {
			if (ctx.gate.isHeld) {
				ctx.onLate?.();
				ctx.gate.release();
			}
		},
		async confirm(name) {
			if (name !== ctx.tabName) return "discard";
			await ctx.onConfirm?.();
			return ctx.decision;
		},
	});
	const { host } = ctx;
	if (failure.start === "file") ctx.tab = await host.open(a);
	else ctx.tab = await host.newDocument();
	ctx.tab.type(TEXT.edited);
	const fault = (mode) => {
		let used = false;
		return () => {
			if (used) return undefined;
			used = true;
			return mode;
		};
	};
	const kind = failure.id.replace(/^(save-as|save|untitled)-/, "");
	const change = (doc, source) => {
		doc.file = { source, ino: ++native.ino, mtime: ++native.clock };
	};
	ctx.chooser = () => {
		const chosen = native.snapshot(b);
		if (kind === "conflict") change(b, "external B\n");
		if (kind === "b-unreadable") b.unreadable = true;
		return chosen;
	};
	if (kind === "lost-published")
		ctx.faults.set(failure.hasB ? 2 : 1, fault("after"));
	if (kind === "lost-unpublished")
		ctx.faults.set(failure.hasB ? 2 : 1, fault("before"));
	if (!failure.hasB && kind === "conflict") {
		let used = false;
		ctx.beforeSave = () => {
			if (used) return;
			used = true;
			change(a, "external A\n");
		};
	}
	if (failure.via === "save-as") await host.command("save-as");
	else await host.cmdS();
	ctx.recovery = failure.hasB ? b : a;
	ctx.targets =
		failure.start === "untitled"
			? [b.id]
			: failure.hasB
				? [a.id, b.id]
				: [a.id];

	if (history === "cancel-again") {
		ctx.chooser = () => native.snapshot(b);
		ctx.dialogOverride = (title) =>
			title === "Review the target" ? "Keep Editing" : undefined;
		await host.command("save-as");
		ctx.dialogOverride = undefined;
	} else if (history === "fail-again") {
		ctx.chooser = () => {
			const chosen = native.snapshot(b);
			change(b, "external B again\n");
			return chosen;
		};
		await host.command("save-as");
	} else if (history === "other-fails") {
		let used = false;
		ctx.beforeSave = () => {
			if (used) return;
			used = true;
			change(a, "external A during save\n");
		};
		await host.cmdS();
		ctx.beforeSave = undefined;
		ctx.recovery = a;
		ctx.targets = [a.id];
	}
	// Later choices see the target as it is.
	ctx.chooser = () => native.snapshot(b);
	return ctx;
}

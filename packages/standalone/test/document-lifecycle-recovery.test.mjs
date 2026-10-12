// Recovery states of the document lifecycle: a Save As or Save that did not
// complete leaves a pending target next to (or instead of) the document's own
// disk file. Every cell checks the invariants documented in
// helpers/lifecycle-invariants.mjs against README "Application behavior".
import { cell, guardKnownRed } from "./helpers/known-red.mjs";
import {
	createHarness,
	FakeNative,
	fsOf,
	TEXT,
} from "./helpers/lifecycle-harness.mjs";
import {
	beginAction,
	checkAction,
	checkInspected,
	checkPanel,
} from "./helpers/lifecycle-invariants.mjs";

const { startHost } = await createHarness("lifecycle-recovery");

// How the first save did not complete.
const FAILURES = [
	{ id: "save-as-conflict", start: "file", via: "save-as", hasB: true },
	{ id: "save-as-lost-published", start: "file", via: "save-as", hasB: true },
	{ id: "save-as-lost-unpublished", start: "file", via: "save-as", hasB: true },
	{ id: "save-as-b-unreadable", start: "file", via: "save-as", hasB: true },
	{ id: "save-lost-published", start: "file", via: "save", hasB: false },
	{ id: "save-lost-unpublished", start: "file", via: "save", hasB: false },
	{ id: "save-conflict", start: "file", via: "save", hasB: false },
	{ id: "untitled-conflict", start: "untitled", via: "save", hasB: true },
	{ id: "untitled-lost-published", start: "untitled", via: "save", hasB: true },
	{
		id: "untitled-lost-unpublished",
		start: "untitled",
		via: "save",
		hasB: true,
	},
	{ id: "untitled-b-unreadable", start: "untitled", via: "save", hasB: true },
];
const A_EVENTS = [
	"none",
	"content-changed",
	"metadata-only",
	"deleted",
	"unreadable",
];
const B_EVENTS = [
	"none",
	"content-changed",
	"deleted",
	"unreadable",
	"recovered",
];
const TIMINGS = ["polled", "unpolled", "during-confirm"];
const ACTIONS = [
	"poll",
	"cmd-s",
	"review",
	"close-save",
	"close-discard",
	"close-cancel",
	"quit-discard",
];
const SAVE_ACTIONS = new Set(["cmd-s", "review", "close-save"]);

function apply(native, doc, event) {
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
}

/** What a user could see of a file: its text, "missing" or "unreadable". */
const content = (native, doc) => {
	const snapshot = fsOf(native, doc);
	return snapshot.unreadable ? "unreadable" : (snapshot.source ?? "missing");
};

function applicable(failure, aEvent, bEvent, timing, action) {
	if (failure.start === "untitled" && aEvent !== "none") return false;
	if (!failure.hasB && bEvent !== "none") return false;
	if (bEvent === "recovered" && !failure.id.endsWith("b-unreadable"))
		return false;
	if (bEvent === "unreadable" && failure.id.endsWith("b-unreadable"))
		return false;
	if (timing === "during-confirm")
		return ["close-save", "close-discard", "quit-discard"].includes(action);
	if (action === "poll") return timing === "unpolled";
	return true;
}

/** Brings the tab into the recovery state of `failure`. */
async function establish(failure) {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const ctx = {
		native,
		a,
		b,
		tabName: undefined,
		decision: "cancel",
		onConfirm: undefined,
		faults: new Map(),
		chooser: undefined,
		beforeSave: undefined,
	};
	ctx.host = await startHost(native, a, {
		choose: () => ctx.chooser(),
		saveFault: (args) => ctx.faults.get(args.id)?.(),
		beforeSave: (args) => ctx.beforeSave?.(args),
		async confirm(name) {
			if (name !== ctx.tabName) return "discard";
			await ctx.onConfirm?.();
			return ctx.decision;
		},
	});
	const { host } = ctx;
	if (failure.start === "file") ctx.entry = await host.open(a);
	else {
		await host.click(host.query("#new"));
		ctx.entry = globalThis.reviewActive();
	}
	ctx.entry.tab.type(TEXT.edited);
	const fault = (mode) => {
		let used = false;
		return () => {
			if (used) return undefined;
			used = true;
			return mode;
		};
	};
	const kind = failure.id.replace(/^(save-as|save|untitled)-/, "");
	ctx.chooser = () => {
		const chosen = native.snapshot(b);
		if (kind === "conflict")
			b.file = {
				source: "external B\n",
				ino: ++native.ino,
				mtime: ++native.clock,
			};
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
			a.file = {
				source: "external A\n",
				ino: ++native.ino,
				mtime: ++native.clock,
			};
		};
	}
	if (failure.via === "save-as") await host.click(host.query("#save-as"));
	else await host.cmdS();
	// Later choices see the target as it is.
	ctx.chooser = () => native.snapshot(b);
	return ctx;
}

async function runCell(failure, aEvent, bEvent, timing, action) {
	const violations = [];
	const violate = (name, detail) => violations.push(`${name}: ${detail}`);
	let ctx;
	try {
		ctx = await establish(failure);
		const { native, a, b, host, entry } = ctx;
		const session = entry.session;
		if (!session.pendingTarget)
			violate("harness", "the recovery state was not established");
		ctx.tabName = entry.name;
		const targets = [session.disk?.id, session.pendingTarget?.id].filter(
			(id, index, all) => id !== undefined && all.indexOf(id) === index,
		);
		const docOf = (id) => native.docs.get(id);
		const events = () => {
			if (failure.start === "file") apply(native, a, aEvent);
			if (failure.hasB) apply(native, b, bEvent);
		};
		ctx.decision = action.endsWith("save")
			? "save"
			: action.endsWith("discard")
				? "discard"
				: "cancel";
		let changedInConfirm = false;
		if (timing === "during-confirm") {
			let done = false;
			ctx.onConfirm = () => {
				if (done) return;
				done = true;
				const before = targets.map((id) => content(native, docOf(id)));
				events();
				changedInConfirm = targets.some(
					(id, index) => content(native, docOf(id)) !== before[index],
				);
			};
		} else events();
		if (timing === "polled") {
			host.log.length = 0;
			await host.runPoll();
			checkInspected({ host, ids: targets, violate, when: "by the poll" });
			observed({ native, ctx, targets, violate });
			checkPanel({ host, entry, violate });
		}
		const trace = beginAction({ host, entry });
		const reviewId = session.observed?.id;
		const alive = () => globalThis.reviewEntries.has(entry);
		let attempts = 0;
		if (action === "poll") {
			await host.runPoll();
			checkInspected({ host, ids: targets, violate, when: "by the poll" });
			observed({ native, ctx, targets, violate });
		} else if (action === "cmd-s") {
			while (attempts < 3) {
				attempts++;
				await host.cmdS();
				if (!alive() || (!session.isDirty() && !session.saveFailure)) break;
			}
		} else if (action === "review") {
			const button = () =>
				host
					.queryAll("#conflicts button")
					.find((item) => item.textContent === "Review and Save Here…");
			while (attempts < 3 && alive() && button() && !button().disabled) {
				attempts++;
				await host.click(button());
				if (!session.pendingTarget && !session.saveFailure) break;
			}
		} else {
			const attemptsAllowed = action === "close-save" ? 3 : 1;
			while (attempts < attemptsAllowed && (attempts === 0 || alive())) {
				attempts++;
				if (action.startsWith("close"))
					await host.click(entry.navigation.querySelector(".close-document"));
				else await host.quit(attempts);
			}
			const passes = action.endsWith("discard") && !alive() ? 2 : 1;
			checkInspected({
				host,
				ids: targets,
				times: passes,
				violate,
				when: `by ${action}`,
			});
			if (changedInConfirm && !alive() && action.endsWith("discard"))
				violate(
					"V",
					"a decision was applied although a target changed meanwhile",
				);
		}
		checkAction({ native, host, entry, trace, violate });
		checkPanel({ host, entry, violate });

		// D: no dead end while the target stays readable.
		if (SAVE_ACTIONS.has(action) && attempts > 0) {
			const wanted = docOf(
				action === "review"
					? reviewId
					: failure.start === "untitled"
						? b.id
						: a.id,
			);
			if (content(native, wanted) !== "unreadable") {
				if (content(native, wanted) !== trace.text0)
					violate(
						"D",
						`the save did not reach ${wanted.path} (holds ${JSON.stringify(content(native, wanted))}, status ${JSON.stringify(host.query("#status").textContent)})`,
					);
			}
		}
		const leaks = await host.finish();
		if (leaks.length) violate("harness", `leaked IPC ${leaks.join(",")}`);
	} catch (error) {
		violate("harness", String(error?.stack ?? error));
	} finally {
		ctx?.host.dom.window.close();
	}
	return violations;
}

/** O: after an observation the session knows what is on disk for each target. */
function observed({ native, ctx, targets, violate }) {
	const session = ctx.entry.session;
	if (!globalThis.reviewEntries.has(ctx.entry)) return;
	const elsewhere =
		session.pendingTarget && session.pendingTarget.id !== session.disk?.id;
	for (const id of targets) {
		const current = fsOf(native, native.docs.get(id));
		if (current.unreadable) continue;
		const text = current.source ?? null;
		if (id === session.disk?.id && elsewhere) {
			// The original is reported as a source conflict only when it changed.
			const changed = text !== session.disk.source;
			if (changed !== Boolean(session.sourceConflict))
				violate(
					"O",
					`the original holds ${JSON.stringify(text)} (changed=${changed}) but sourceConflict=${JSON.stringify(session.sourceConflict?.source)}`,
				);
		} else if (
			session.observed?.id !== id ||
			(session.observed.source ?? null) !== text
		)
			violate(
				"O",
				`target ${id} holds ${JSON.stringify(text)} but the session observed ${JSON.stringify(session.observed?.source)} of ${session.observed?.id}`,
			);
	}
}

for (const failure of FAILURES)
	for (const aEvent of A_EVENTS)
		for (const bEvent of B_EVENTS)
			for (const timing of TIMINGS)
				for (const action of ACTIONS) {
					if (!applicable(failure, aEvent, bEvent, timing, action)) continue;
					const label = `${failure.id} | A ${aEvent} | B ${bEvent} | ${timing} | ${action}`;
					cell(label, () => runCell(failure, aEvent, bEvent, timing, action));
				}

guardKnownRed();

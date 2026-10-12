// Recovery states of the document lifecycle: a Save As or Save that did not
// complete leaves a pending target next to (or instead of) the document's own
// disk file. Every cell checks the invariants documented in
// helpers/lifecycle-invariants.mjs against README "Application behavior".
import { cell, guardKnownRed } from "./helpers/known-red.mjs";
import { createHarness } from "./helpers/lifecycle-harness.mjs";
import {
	beginAction,
	checkAction,
	checkInspected,
	checkObservation,
	checkPanel,
	checkReads,
} from "./helpers/lifecycle-invariants.mjs";
import { apply, content, establish } from "./helpers/recovery-state.mjs";

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
	"moved",
	"moved-changed",
];
// Further user steps between the failure and the events.
const HISTORIES = ["none", "cancel-again", "fail-again", "other-fails"];
// in-flight: a poll started after the events is still reading when the action
// opens its dialog and finishes while that dialog is open.
const TIMINGS = ["polled", "unpolled", "during-confirm", "in-flight"];
const ACTIONS = [
	"poll",
	"cmd-s",
	"review",
	"use",
	"close-save",
	"close-discard",
	"close-cancel",
	"quit-discard",
];
const SAVE_ACTIONS = new Set(["cmd-s", "review", "close-save"]);

function applicable(failure, aEvent, bEvent, timing, action, history) {
	if (history !== "none") {
		if (!failure.hasB || failure.id.endsWith("b-unreadable")) return false;
		if (history === "other-fails" && failure.start !== "file") return false;
		// B already holds the editor text, so a second Save As has nothing to review.
		if (history !== "other-fails" && failure.id.endsWith("lost-published"))
			return false;
		if (!["none", "content-changed"].includes(aEvent)) return false;
		if (!["none", "content-changed", "deleted"].includes(bEvent)) return false;
		if (!["polled", "unpolled"].includes(timing)) return false;
		if (
			!["poll", "cmd-s", "review", "close-save", "close-discard"].includes(
				action,
			)
		)
			return false;
	}
	if (failure.start === "untitled" && aEvent !== "none") return false;
	if (!failure.hasB && bEvent !== "none") return false;
	if (bEvent === "recovered" && !failure.id.endsWith("b-unreadable"))
		return false;
	if (bEvent === "unreadable" && failure.id.endsWith("b-unreadable"))
		return false;
	if (timing === "during-confirm")
		return ["close-save", "close-discard", "quit-discard"].includes(action);
	// A poll still reading would block the close sequence, which finishes it first.
	if (timing === "in-flight") return action === "cmd-s" || action === "review";
	if (action === "poll") return timing === "unpolled";
	return true;
}

async function runCell(failure, aEvent, bEvent, timing, action, history) {
	const violations = [];
	const violate = (name, detail) => violations.push(`${name}: ${detail}`);
	let ctx;
	try {
		ctx = await establish(startHost, failure, history);
		const { native, a, b, host, tab } = ctx;
		const { recovery, targets } = ctx;
		const original = failure.start === "file" ? a : undefined;
		if (!host.panel().present)
			violate("harness", "the recovery state was not established");
		ctx.tabName = host.nameOf(tab);
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
		ctx.useDisk = action === "use";
		const gated = failure.start === "untitled" ? b : a;
		ctx.onLate = () => {
			gated.unreadable = false;
			gated.file = {
				source: "late change\n",
				ino: ++native.ino,
				mtime: ++native.clock,
			};
		};
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
			checkObservation({ host, native, original, recovery, violate });
			checkPanel({ host, native, violate, recoveryId: recovery.id });
			const panel = host.panel();
			const readable = content(native, recovery) !== "unreadable";
			if (readable && panel.review?.disabled && panel.use?.disabled !== false)
				violate(
					"D",
					"no Review or Use action is reachable for a readable target",
				);
		}
		if (timing === "in-flight") {
			ctx.gate.arm(gated.id);
			await host.runPoll();
		}
		const trace = beginAction({ host, tab, owned: targets });
		const alive = () => host.isOpen(tab);
		let attempts = 0;
		if (action === "poll") {
			await host.runPoll();
			checkInspected({ host, ids: targets, violate, when: "by the poll" });
			checkObservation({ host, native, original, recovery, violate });
		} else if (action === "cmd-s") {
			while (attempts < 3) {
				attempts++;
				await host.cmdS();
				if (!alive() || (!host.isDirty(tab) && !host.panel().present)) break;
			}
		} else if (action === "review" || action === "use") {
			const pick = () => {
				const panel = host.panel();
				return action === "review" ? panel.review : panel.use;
			};
			while (attempts < 3 && alive() && pick() && !pick().disabled) {
				attempts++;
				const mark = host.log.length;
				await host.click(pick());
				const first = host.log
					.slice(mark)
					.find((item) => item.kind === "inspect" || item.kind === "save");
				if (first && first.id !== recovery.id)
					violate(
						"P",
						`${action} acted on target ${first.id}, not the recovery target ${recovery.id}`,
					);
				if (action === "use" || !host.panel().present) break;
			}
		} else {
			const attemptsAllowed = action === "close-save" ? 3 : 1;
			while (attempts < attemptsAllowed && (attempts === 0 || alive())) {
				attempts++;
				if (action.startsWith("close")) await host.click(host.closeButton(tab));
				else await host.quit(attempts);
			}
			if (changedInConfirm && !alive() && action.endsWith("discard"))
				violate(
					"V",
					"a decision was applied although a target changed meanwhile",
				);
		}
		if (ctx.gate.release()) await host.settle();
		checkAction({ native, host, tab, trace, violate });
		if (action.startsWith("close") || action.startsWith("quit"))
			checkReads({ host, tab, trace, violate });
		checkPanel({ host, native, violate, recoveryId: recovery.id });

		// D: no dead end while the target stays readable.
		if (SAVE_ACTIONS.has(action) && attempts > 0 && timing !== "in-flight") {
			const wanted =
				action === "review" ? recovery : failure.start === "untitled" ? b : a;
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

for (const failure of FAILURES)
	for (const history of HISTORIES)
		for (const aEvent of A_EVENTS)
			for (const bEvent of B_EVENTS)
				for (const timing of TIMINGS)
					for (const action of ACTIONS) {
						if (!applicable(failure, aEvent, bEvent, timing, action, history))
							continue;
						const label = `${failure.id}${history === "none" ? "" : ` (${history})`} | A ${aEvent} | B ${bEvent} | ${timing} | ${action}`;
						cell(label, () =>
							runCell(failure, aEvent, bEvent, timing, action, history),
						);
					}

guardKnownRed();

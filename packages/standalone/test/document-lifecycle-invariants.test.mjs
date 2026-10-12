// Cartesian check of the document lifecycle against README "Application behavior".
// Every cell drives the production main.ts over a fake native filesystem that
// follows documents.rs (revision = inode + mtime + content, save(expected)
// conflicts on any other revision, identical content is a no-op, a missing
// target with expected=null is created exclusively).
import assert from "node:assert/strict";
import test from "node:test";
import {
	createHarness,
	FakeNative,
	fsOf,
	TEXT,
} from "./helpers/lifecycle-harness.mjs";

const { startHost } = await createHarness("lifecycle-invariants");

const TABS = ["clean", "dirty"];
const EVENTS = [
	"none",
	"content-changed",
	"metadata-only",
	"same-content-new-inode",
	"deleted",
	"unreadable",
	"deleted-restored",
	// The first save_document reply is lost, with or without the write.
	"reply-lost-published",
	"reply-lost-unpublished",
];
// polled: the event is seen by the 1 s poll. unpolled: no poll runs before the
// action. drift: polled, then the file changes again unseen. during-confirm:
// the event happens while another tab's close confirmation is open.
const TIMINGS = ["polled", "unpolled", "drift", "during-confirm"];
const ACTIONS = [
	"cmd-s",
	"review",
	"close-save",
	"close-discard",
	"close-cancel",
	"quit-save",
	"quit-discard",
	"quit-cancel",
];
const SAVE_ACTIONS = new Set(["cmd-s", "review", "close-save", "quit-save"]);

function applicable(tab, event, timing, action) {
	if (event.startsWith("reply-lost"))
		return (
			tab === "dirty" &&
			timing === "polled" &&
			["cmd-s", "close-save", "quit-save"].includes(action)
		);
	if (timing === "during-confirm" && !action.startsWith("quit")) return false;
	if (action === "review") return panelExpected(tab, event, timing);
	return true;
}
/** The conflict panel README promises after the event was polled. */
function panelExpected(tab, event, timing) {
	if (timing === "unpolled" || timing === "during-confirm") return false;
	if (event === "deleted") return true;
	return tab === "dirty" && event === "content-changed";
}

const EVENT_STEPS = {
	none: [],
	"reply-lost-published": [],
	"reply-lost-unpublished": [],
	"content-changed": [
		(n, d) => {
			d.file = {
				source: "disk v2 (external)\n",
				ino: ++n.ino,
				mtime: ++n.clock,
			};
		},
	],
	"metadata-only": [
		(n, d) => {
			d.file = { ...d.file, mtime: ++n.clock };
		},
	],
	"same-content-new-inode": [
		(n, d) => {
			d.file = { source: d.file.source, ino: ++n.ino, mtime: ++n.clock };
		},
	],
	deleted: [
		(_, d) => {
			d.file = null;
		},
	],
	unreadable: [
		(_, d) => {
			d.unreadable = true;
		},
	],
	// The poll between the two steps observes the deletion.
	"deleted-restored": [
		(_, d) => {
			d.saved = d.file;
			d.file = null;
		},
		"poll",
		(_, d) => {
			d.file = d.saved;
		},
	],
};

async function runCell(tabState, event, timing, action) {
	const violations = [];
	const violate = (name, detail) => violations.push(`${name}: ${detail}`);
	let host;
	try {
		const native = new FakeNative();
		const doc = native.add(1, "a.pfdsl", TEXT.disk);
		const anchor = native.add(2, "anchor.pfdsl", "anchor disk\n");
		const decisions = {
			"a.pfdsl": action.endsWith("save")
				? "save"
				: action.endsWith("discard")
					? "discard"
					: "cancel",
			"anchor.pfdsl": "discard",
		};
		const asked = [];
		let eventApplied = false;
		let lostReply = false;
		let writesAtEvent = 0;
		const applyEvent = async (pollNow) => {
			eventApplied = true;
			for (const step of EVENT_STEPS[event]) {
				if (step === "poll") {
					if (pollNow) await host.runPoll();
				} else step(native, doc);
			}
			writesAtEvent = doc.writes;
		};
		host = await startHost(native, doc, {
			saveFault(args) {
				if (lostReply || !event.startsWith("reply-lost") || args.id !== doc.id)
					return undefined;
				lostReply = true;
				return event === "reply-lost-published" ? "after" : "before";
			},
			async confirm(name) {
				asked.push(name);
				if (
					name === "anchor.pfdsl" &&
					timing === "during-confirm" &&
					!eventApplied
				)
					await applyEvent(false);
				return decisions[name];
			},
		});
		const { log, settle, click } = host;
		const entry = await host.open(doc);
		if (tabState === "dirty") entry.tab.type(TEXT.edited);
		const guard = await host.open(anchor);
		guard.tab.type("anchor edit\n");
		entry.tab.button.click();
		const alive = () => globalThis.reviewEntries.has(entry);

		// Event and observation.
		if (timing !== "during-confirm") await applyEvent(timing !== "unpolled");
		if (timing === "polled" || timing === "drift") await host.runPoll();
		const panelButton = () =>
			host
				.queryAll("#conflicts button")
				.find((b) => b.textContent === "Review and Save Here…");
		const afterPoll = {
			setSourceCalls: entry.tab.setSourceCalls,
			conflict: entry.session.conflict,
			dirty: entry.session.isDirty(),
			message: entry.session.message,
			panel: host.query("#conflicts").children.length > 0,
		};
		if (panelExpected(tabState, event, timing)) {
			if (!panelButton() || panelButton().disabled)
				violate("panel", "no enabled 'Review and Save Here…' after the poll");
		}
		if (timing === "drift") {
			doc.unreadable = false;
			doc.file = {
				source: "disk v3 (drift)\n",
				ino: ++native.ino,
				mtime: ++native.clock,
			};
		}
		const writesBefore = doc.writes;
		log.length = 0;

		// Action.
		let presses = 0;
		if (action === "cmd-s") {
			while (presses < 3) {
				presses++;
				await host.cmdS();
				if (!alive()) break;
				if (!entry.session.isDirty() && !entry.session.saveFailure) break;
			}
		} else if (action === "review") {
			const button = panelButton();
			if (!button || button.disabled)
				violate("harness", "Review and Save Here… is not available");
			else await click(button);
		} else {
			// A refused Save is retried like a user would, at most three times.
			const attempts = action.endsWith("save") ? 3 : 1;
			while (presses < attempts && (presses === 0 || alive())) {
				presses++;
				if (action.startsWith("close"))
					await click(entry.navigation.querySelector(".close-document"));
				else {
					await host.quit(presses);
				}
			}
		}
		if (timing === "during-confirm" && !eventApplied) await applyEvent(false);
		await settle();

		const text = entry.tab.getSource();
		const fs = fsOf(native, doc);
		const status = host.query("#status").textContent;
		const decision = decisions["a.pfdsl"];

		// I1: a confirmed dialog is an exact description of what gets replaced.
		log.forEach((item, index) => {
			if (item.kind !== "dialog") return;
			if (
				item.title !== "Review the target" &&
				item.title !== "Recreate missing file"
			)
				return;
			if (item.fs.unreadable) {
				violate("I1", `${item.title} was shown for an unreadable file`);
				return;
			}
			const expectedDisk = item.fs.source ?? "File is missing";
			if (item.title === "Review the target" && item.disk !== expectedDisk)
				violate(
					"I1",
					`dialog showed ${JSON.stringify(item.disk)} but the file held ${JSON.stringify(expectedDisk)}`,
				);
			if (item.title === "Recreate missing file" && item.fs.source !== null)
				violate("I1", "Recreate was offered but the file exists");
			const next = log.slice(index + 1).find((entry) => entry.kind === "save");
			if (!next) violate("I1", "a confirmed dialog was not followed by a save");
			else if ((next.expected ?? null) !== (item.fs.revision ?? null))
				violate(
					"I1",
					`save expected ${JSON.stringify(next.expected)} but the file was at ${JSON.stringify(item.fs.revision)} when the dialog was shown`,
				);
		});

		// I2: confirming never ends in a dead end; unreadable files are never written blind.
		if (SAVE_ACTIONS.has(action)) {
			if (fs.unreadable) {
				if (doc.writes !== writesAtEvent)
					violate("I2", "a blind write reached an unreadable file");
				if (!alive()) violate("I2", "the buffer was dropped");
				if (!status && !entry.session.message)
					violate("I2", "no message explains the refused save");
			} else {
				const done =
					action === "cmd-s" || action === "review"
						? alive() && !entry.session.isDirty()
						: !alive();
				if (!done)
					violate(
						"I2",
						`the save did not complete (alive=${alive()} dirty=${entry.session.isDirty()} presses=${presses} status=${JSON.stringify(status)})`,
					);
				else if (fs.source !== text)
					violate(
						"I2",
						`the file holds ${JSON.stringify(fs.source)} but the editor held ${JSON.stringify(text)}`,
					);
			}
		} else if (doc.writes !== writesBefore)
			violate("I2", "an action without Save wrote to disk");

		// I3: a tab disappears only by Discard or when the disk holds its text.
		if (!alive()) {
			const discarded = asked.includes("a.pfdsl") && decision === "discard";
			if (!discarded && fs.source !== text)
				violate(
					"I3",
					`disposed with ${JSON.stringify(text)} while the file is ${fs.unreadable ? "unreadable" : JSON.stringify(fs.source)}`,
				);
			if (asked.includes("a.pfdsl") && decision === "cancel")
				violate("I3", "disposed after Cancel");
		}

		// I4: a change that leaves the content identical is not a document change.
		if (event === "metadata-only" || event === "same-content-new-inode") {
			if (timing === "polled" || timing === "during-confirm") {
				if (afterPoll.setSourceCalls !== 0)
					violate("I4", "the poll replaced the editor text");
				if (afterPoll.conflict) violate("I4", "the poll raised a conflict");
				if (tabState === "clean" && afterPoll.dirty)
					violate("I4", "the poll made a clean tab dirty");
			}
			if (timing !== "drift" && entry.tab.setSourceCalls !== 0)
				violate("I4", "the editor text was replaced");
		}

		// I2': Save and Close never see a same-content change, whenever it happens.
		if (
			(event === "metadata-only" || event === "same-content-new-inode") &&
			timing !== "drift"
		) {
			if (tabState === "dirty" && SAVE_ACTIONS.has(action)) {
				if (log.some((item) => item.kind === "dialog"))
					violate("I2'", "a review dialog was shown");
				if (log.some((item) => item.outcome === "conflict"))
					violate("I2'", "the native save reported a conflict");
			}
			if (SAVE_ACTIONS.has(action) || action.endsWith("discard"))
				if (presses !== 1 || (action !== "cmd-s" && alive()))
					violate(
						"I2'",
						`the first attempt did not finish (attempts=${presses}, alive=${alive()})`,
					);
		}

		// I6: a clean editor follows an external content change instead of saving over it.
		if (tabState === "clean" && event === "content-changed") {
			if (SAVE_ACTIONS.has(action)) {
				if (log.some((item) => item.kind === "dialog"))
					violate("I6", "a review dialog was shown");
				if (log.some((item) => item.kind === "save"))
					violate("I6", "a clean editor wrote to the disk");
			}
			if (alive() && text !== fs.source)
				violate("I6", "the editor does not hold the disk content");
			if (
				timing === "unpolled" &&
				action === "cmd-s" &&
				!/nothing to save/.test(status)
			)
				violate(
					"I6",
					`the reload was not reported (${JSON.stringify(status)})`,
				);
		}

		// I5: a file that returns to its observed state leaves no trace behind.
		if (event === "deleted-restored" && timing === "polled") {
			if (afterPoll.conflict) violate("I5", "the poll kept a conflict");
			if (afterPoll.panel) violate("I5", "the conflict panel is still shown");
			if (afterPoll.message) violate("I5", "a stale message remains");
			if (
				SAVE_ACTIONS.has(action) &&
				log.some((item) => item.kind === "dialog")
			)
				violate("I5", "Save asked for a review");
		}

		// A document the cell finished with must not keep native work running.
		const leaks = await host.finish();
		if (leaks.length) violate("harness", `leaked IPC ${leaks.join(",")}`);
	} catch (error) {
		violate("harness", String(error?.stack ?? error));
	} finally {
		host?.dom.window.close();
	}
	return violations;
}

for (const tab of TABS)
	for (const event of EVENTS)
		for (const timing of TIMINGS)
			for (const action of ACTIONS) {
				if (!applicable(tab, event, timing, action)) continue;
				const label = `${tab} | ${event} | ${timing} | ${action}`;
				test(label, async () => {
					const violations = await runCell(tab, event, timing, action);
					assert.deepEqual(violations, [], label);
				});
			}

/** Fails Save As to B with a conflict, leaving A open with B as the recovery target. */
async function failSaveAs() {
	const native = new FakeNative();
	const a = native.add(1, "a.pfdsl", TEXT.disk);
	const b = native.add(2, "b.pfdsl", "old B\n");
	const host = await startHost(native, a, {
		choose() {
			// B changes right after it was inspected, so the Save As is refused.
			const chosen = native.snapshot(b);
			b.file = {
				source: "external B\n",
				ino: ++native.ino,
				mtime: ++native.clock,
			};
			return chosen;
		},
		confirm: async () => "cancel",
	});
	const entry = await host.open(a);
	entry.tab.type(TEXT.edited);
	await host.click(host.query("#save-as"));
	assert.equal(entry.session.disk.id, 1);
	assert.equal(entry.session.pendingTarget.id, 2);
	assert.equal(entry.session.observed.id, 2);
	host.log.length = 0;
	return { native, a, b, host, entry };
}

test("Save after a failed Save As still reviews and replaces the original document", async () => {
	const { native, a, host, entry } = await failSaveAs();
	try {
		a.file = {
			source: "external A\n",
			ino: ++native.ino,
			mtime: ++native.clock,
		};
		await host.cmdS();
		const dialog = host.log.find((item) => item.kind === "dialog");
		assert.equal(dialog.title, "Review the target");
		assert.equal(dialog.disk, "external A\n");
		const saves = host.log.filter((item) => item.kind === "save");
		assert.deepEqual(
			saves.map((item) => [item.id, item.expected]),
			[[1, dialog.fsById[1].revision]],
		);
		assert.equal(a.file.source, TEXT.edited);
		assert.equal(entry.session.disk.id, 1);
		assert.equal(entry.session.isDirty(), false);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

test("Review and Save Here inspects the recovery target again", async () => {
	const { native, b, host, entry } = await failSaveAs();
	try {
		b.file = { source: "later B\n", ino: ++native.ino, mtime: ++native.clock };
		const button = host
			.queryAll("#conflicts button")
			.find((item) => item.textContent === "Review and Save Here…");
		await host.click(button);
		const dialog = host.log.find((item) => item.kind === "dialog");
		assert.equal(dialog.title, "Review the target");
		assert.equal(dialog.disk, "later B\n");
		const saves = host.log.filter((item) => item.kind === "save");
		assert.deepEqual(
			saves.map((item) => [item.id, item.expected]),
			[[2, dialog.fsById[2].revision]],
		);
		assert.equal(b.file.source, TEXT.edited);
		assert.equal(entry.session.disk.id, 2);
	} finally {
		assert.deepEqual(await host.finish(), []);
	}
});

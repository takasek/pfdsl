// Cartesian check of the document lifecycle against README "Application behavior".
// Every cell drives the production main.ts over a fake native filesystem that
// follows documents.rs (revision = inode + mtime + content, save(expected)
// conflicts on any other revision, identical content is a no-op, a missing
// target with expected=null is created exclusively).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { bundleHost, JSDOM, root } from "./helpers/host-bundle.mjs";

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
const TEXT = { disk: "disk v1\n", edited: "edited by the user\n" };

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

class FakeNative {
	constructor() {
		this.ino = 1000;
		this.clock = 1;
		this.docs = new Map();
	}
	add(id, name, source) {
		const doc = {
			id,
			path: `/A/${name}`,
			binding: `dir:${name}`,
			file: { source, ino: ++this.ino, mtime: ++this.clock },
			unreadable: false,
			writes: 0,
		};
		this.docs.set(id, doc);
		return doc;
	}
	snapshot(doc) {
		if (doc.unreadable) throw new Error("Permission denied (os error 13)");
		const base = { id: doc.id, path: doc.path, binding: doc.binding };
		if (!doc.file)
			return { ...base, source: null, revision: null, identity: null };
		const identity = `1:${doc.file.ino}`;
		return {
			...base,
			source: doc.file.source,
			revision: `${identity}:${doc.file.mtime}:${doc.file.source}`,
			identity,
		};
	}
	save(doc, source, expected) {
		const result = (outcome, current, message) => ({
			outcome,
			current,
			message,
			publication: "not-published",
			targetState: current
				? current.source === null
					? "missing"
					: "readable"
				: "unreadable",
		});
		let current;
		try {
			current = this.snapshot(doc);
		} catch (error) {
			return result("failed-before-publication", null, String(error));
		}
		if (current.revision !== expected)
			return result(
				"conflict",
				current,
				"The disk changed. Review it before replacing this version.",
			);
		if (current.source === source)
			return result("saved", current, "Already saved.");
		doc.file = { source, ino: ++this.ino, mtime: ++this.clock };
		doc.writes++;
		return {
			...result("saved", this.snapshot(doc), "Saved."),
			publication: "published",
		};
	}
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

const keys = [
	"document",
	"window",
	"self",
	"setInterval",
	"nativeInvoke",
	"nativeListen",
	"nativeAcceptance",
	"reviewEntries",
	"reviewActive",
	"reviewBusy",
];
const old = new Map(
	keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);
const temp = mkdtempSync(
	join(root, "packages/standalone/node_modules/.lifecycle-invariants-"),
);
const output = join(temp, "main.mjs");
await bundleHost(output);
let cellSerial = 0;
after(() => {
	for (const key of keys) {
		const descriptor = old.get(key);
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
	rmSync(temp, { recursive: true, force: true });
});

const flush = async () => {
	for (let i = 0; i < 100; i++) await Promise.resolve();
};

const fsOf = (native, doc) => {
	try {
		return native.snapshot(doc);
	} catch {
		return { unreadable: true };
	}
};

/**
 * Runs the production main.ts over `native`. Every dialog is answered with the
 * choice that confirms replacing or creating the target. `handlers` supplies
 * confirm_close_document (confirm), choose_save_target (choose) and may lose a
 * save reply (saveFault: "before" or "after" the write).
 */
async function startHost(native, watched, handlers = {}) {
	const dom = new JSDOM(
		readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
	);
	const log = [];
	let poll;
	let quitListener;
	let selected;
	globalThis.document = dom.window.document;
	globalThis.window = dom.window;
	globalThis.self = dom.window;
	dom.window.__TAURI_INTERNALS__ = {};
	globalThis.setInterval = (fn) => {
		poll = fn;
		return 0;
	};
	dom.window.HTMLDialogElement.prototype.close = () => {};
	dom.window.HTMLDialogElement.prototype.showModal = function () {
		const fields = [...this.querySelectorAll("textarea")].map((f) => f.value);
		log.push({
			kind: "dialog",
			title: this.querySelector("h2").textContent,
			editor: fields[0],
			disk: fields[1],
			fs: fsOf(native, watched),
			fsById: Object.fromEntries(
				[...native.docs].map(([id, doc]) => [id, fsOf(native, doc)]),
			),
		});
	};
	globalThis.nativeAcceptance = () => new Promise(() => {});
	globalThis.nativeListen = async (_, listener) => {
		quitListener = listener;
		return () => {};
	};
	globalThis.nativeInvoke = async (command, args) => {
		if (command === "list_recent") return [];
		if (command === "remember_document" || command === "release_document")
			return;
		if (command === "exit_listener_ready" || command === "finish_app_exit")
			return;
		if (command === "select_document" || command === "open_document")
			return native.snapshot(selected);
		if (command === "choose_save_target") return handlers.choose();
		if (command === "inspect_document") {
			log.push({ kind: "inspect", id: args.id });
			return native.snapshot(native.docs.get(args.id));
		}
		if (command === "save_document") {
			const target = native.docs.get(args.id);
			const fault = handlers.saveFault?.(args);
			const entry = {
				kind: "save",
				id: args.id,
				expected: args.expected,
				fs: fsOf(native, target),
				outcome: "lost",
			};
			log.push(entry);
			if (fault === "before") throw new Error("native reply lost");
			const reply = native.save(target, args.source, args.expected);
			if (fault === "after") throw new Error("native reply lost");
			entry.outcome = reply.outcome;
			return reply;
		}
		if (command === "confirm_close_document")
			return handlers.confirm(args.name);
		throw new Error(`unexpected command ${command}`);
	};
	await import(`${pathToFileURL(output).href}?cell=${++cellSerial}`);
	await flush();
	const settle = async () => {
		for (let i = 0; i < 60; i++) {
			await flush();
			const dialog = dom.window.document.querySelector("dialog");
			if (dialog) {
				const title = dialog.querySelector("h2").textContent;
				const confirm =
					title === "Review the target"
						? "Replace Observed Version"
						: title === "Recreate missing file"
							? "Create File"
							: "Keep Editing";
				[...dialog.querySelectorAll("button")]
					.find((b) => b.textContent === confirm)
					.click();
				continue;
			}
			if (!globalThis.reviewBusy()) return;
		}
		throw new Error("the host did not settle");
	};
	const click = async (element) => {
		element.click();
		await settle();
	};
	return {
		dom,
		log,
		settle,
		click,
		query: (selector) => dom.window.document.querySelector(selector),
		queryAll: (selector) => [...dom.window.document.querySelectorAll(selector)],
		async open(target) {
			selected = target;
			await click(dom.window.document.querySelector("#open-file"));
			return globalThis.reviewActive();
		},
		async runPoll() {
			poll();
			await flush();
		},
		async quit(payload) {
			quitListener({ payload: String(payload) });
			await settle();
		},
		async cmdS() {
			dom.window.document.dispatchEvent(
				new dom.window.KeyboardEvent("keydown", {
					key: "s",
					metaKey: true,
					bubbles: true,
				}),
			);
			await settle();
		},
		/** Returns the IPC commands that arrived after the host went idle. */
		async finish() {
			await settle();
			const leaks = [];
			globalThis.nativeInvoke = async (command) => {
				leaks.push(command);
			};
			await flush();
			dom.window.close();
			return leaks;
		},
	};
}

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

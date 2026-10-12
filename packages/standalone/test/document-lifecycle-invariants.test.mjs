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

/**
 * Cells whose invariants fail until their fix lands. A fix commit must delete
 * exactly the cells it repairs: a listed cell that passes fails the last test.
 */
const KNOWN_RED = new Set([
	"clean | none | drift | cmd-s",
	"clean | content-changed | unpolled | cmd-s",
	"clean | content-changed | drift | cmd-s",
	"clean | metadata-only | polled | cmd-s",
	"clean | metadata-only | polled | close-save",
	"clean | metadata-only | polled | close-discard",
	"clean | metadata-only | polled | close-cancel",
	"clean | metadata-only | polled | quit-save",
	"clean | metadata-only | polled | quit-discard",
	"clean | metadata-only | polled | quit-cancel",
	"clean | metadata-only | unpolled | cmd-s",
	"clean | metadata-only | unpolled | close-save",
	"clean | metadata-only | unpolled | close-discard",
	"clean | metadata-only | unpolled | close-cancel",
	"clean | metadata-only | unpolled | quit-save",
	"clean | metadata-only | unpolled | quit-discard",
	"clean | metadata-only | unpolled | quit-cancel",
	"clean | metadata-only | drift | cmd-s",
	"clean | metadata-only | during-confirm | quit-save",
	"clean | metadata-only | during-confirm | quit-discard",
	"clean | metadata-only | during-confirm | quit-cancel",
	"clean | same-content-new-inode | polled | cmd-s",
	"clean | same-content-new-inode | polled | close-save",
	"clean | same-content-new-inode | polled | close-discard",
	"clean | same-content-new-inode | polled | close-cancel",
	"clean | same-content-new-inode | polled | quit-save",
	"clean | same-content-new-inode | polled | quit-discard",
	"clean | same-content-new-inode | polled | quit-cancel",
	"clean | same-content-new-inode | unpolled | cmd-s",
	"clean | same-content-new-inode | unpolled | close-save",
	"clean | same-content-new-inode | unpolled | close-discard",
	"clean | same-content-new-inode | unpolled | close-cancel",
	"clean | same-content-new-inode | unpolled | quit-save",
	"clean | same-content-new-inode | unpolled | quit-discard",
	"clean | same-content-new-inode | unpolled | quit-cancel",
	"clean | same-content-new-inode | drift | cmd-s",
	"clean | same-content-new-inode | during-confirm | quit-save",
	"clean | same-content-new-inode | during-confirm | quit-discard",
	"clean | same-content-new-inode | during-confirm | quit-cancel",
	"clean | deleted | polled | cmd-s",
	"clean | deleted | polled | close-save",
	"clean | deleted | polled | quit-save",
	"clean | deleted | unpolled | cmd-s",
	"clean | deleted | unpolled | close-save",
	"clean | deleted | unpolled | quit-save",
	"clean | deleted | drift | cmd-s",
	"clean | deleted | drift | review",
	"clean | deleted | drift | close-save",
	"clean | deleted | drift | quit-save",
	"clean | deleted | during-confirm | quit-save",
	"clean | unreadable | drift | cmd-s",
	"clean | unreadable | drift | close-save",
	"clean | unreadable | drift | quit-save",
	"clean | deleted-restored | drift | cmd-s",
	"dirty | none | drift | cmd-s",
	"dirty | none | drift | close-save",
	"dirty | none | drift | quit-save",
	"dirty | content-changed | polled | cmd-s",
	"dirty | content-changed | polled | close-save",
	"dirty | content-changed | polled | quit-save",
	"dirty | content-changed | unpolled | cmd-s",
	"dirty | content-changed | unpolled | close-save",
	"dirty | content-changed | unpolled | quit-save",
	"dirty | content-changed | drift | cmd-s",
	"dirty | content-changed | drift | review",
	"dirty | content-changed | drift | close-save",
	"dirty | content-changed | drift | quit-save",
	"dirty | metadata-only | polled | cmd-s",
	"dirty | metadata-only | polled | close-save",
	"dirty | metadata-only | polled | close-discard",
	"dirty | metadata-only | polled | close-cancel",
	"dirty | metadata-only | polled | quit-save",
	"dirty | metadata-only | polled | quit-discard",
	"dirty | metadata-only | polled | quit-cancel",
	"dirty | metadata-only | unpolled | cmd-s",
	"dirty | metadata-only | unpolled | close-save",
	"dirty | metadata-only | unpolled | quit-save",
	"dirty | metadata-only | drift | cmd-s",
	"dirty | metadata-only | drift | close-save",
	"dirty | metadata-only | drift | quit-save",
	"dirty | metadata-only | during-confirm | quit-save",
	"dirty | same-content-new-inode | polled | cmd-s",
	"dirty | same-content-new-inode | polled | close-save",
	"dirty | same-content-new-inode | polled | close-discard",
	"dirty | same-content-new-inode | polled | close-cancel",
	"dirty | same-content-new-inode | polled | quit-save",
	"dirty | same-content-new-inode | polled | quit-discard",
	"dirty | same-content-new-inode | polled | quit-cancel",
	"dirty | same-content-new-inode | unpolled | cmd-s",
	"dirty | same-content-new-inode | unpolled | close-save",
	"dirty | same-content-new-inode | unpolled | quit-save",
	"dirty | same-content-new-inode | drift | cmd-s",
	"dirty | same-content-new-inode | drift | close-save",
	"dirty | same-content-new-inode | drift | quit-save",
	"dirty | same-content-new-inode | during-confirm | quit-save",
	"dirty | deleted | polled | cmd-s",
	"dirty | deleted | polled | close-save",
	"dirty | deleted | polled | quit-save",
	"dirty | deleted | unpolled | cmd-s",
	"dirty | deleted | unpolled | close-save",
	"dirty | deleted | unpolled | quit-save",
	"dirty | deleted | drift | cmd-s",
	"dirty | deleted | drift | review",
	"dirty | deleted | drift | close-save",
	"dirty | deleted | drift | quit-save",
	"dirty | deleted | during-confirm | quit-save",
	"dirty | unreadable | drift | cmd-s",
	"dirty | unreadable | drift | close-save",
	"dirty | unreadable | drift | quit-save",
	"dirty | deleted-restored | drift | cmd-s",
	"dirty | deleted-restored | drift | review",
	"dirty | deleted-restored | drift | close-save",
	"dirty | deleted-restored | drift | quit-save",
	"dirty | reply-lost-published | polled | cmd-s",
	"dirty | reply-lost-published | polled | close-save",
	"dirty | reply-lost-published | polled | quit-save",
]);

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
	return (
		tab === "dirty" &&
		(event === "content-changed" || event === "deleted-restored")
	);
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

const results = new Map();
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

async function runCell(label, tabState, event, timing, action) {
	const violations = [];
	const violate = (name, detail) => violations.push(`${name}: ${detail}`);
	const dom = new JSDOM(
		readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
	);
	const log = [];
	const leaks = [];
	let poll;
	let quitListener;
	try {
		globalThis.document = dom.window.document;
		globalThis.window = dom.window;
		globalThis.self = dom.window;
		dom.window.__TAURI_INTERNALS__ = {};
		globalThis.setInterval = (fn) => {
			poll = fn;
			return 0;
		};
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
		const dialogs = [];
		let selected = doc;
		let eventApplied = false;
		let lostReply = false;
		let writesAtEvent = 0;
		const runPoll = async () => {
			poll();
			await flush();
		};
		const applyEvent = async (pollNow) => {
			eventApplied = true;
			for (const step of EVENT_STEPS[event]) {
				if (step === "poll") {
					if (pollNow) await runPoll();
				} else step(native, doc);
			}
			writesAtEvent = doc.writes;
		};
		dom.window.HTMLDialogElement.prototype.close = () => {};
		dom.window.HTMLDialogElement.prototype.showModal = function () {
			const fields = [...this.querySelectorAll("textarea")].map((f) => f.value);
			let fs;
			try {
				fs = native.snapshot(doc);
			} catch {
				fs = { unreadable: true };
			}
			const entry = {
				kind: "dialog",
				title: this.querySelector("h2").textContent,
				editor: fields[0],
				disk: fields[1],
				fs,
			};
			dialogs.push(entry);
			log.push(entry);
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
			if (command === "inspect_document") {
				log.push({ kind: "inspect", id: args.id });
				return native.snapshot(native.docs.get(args.id));
			}
			if (command === "save_document") {
				const target = native.docs.get(args.id);
				const lose = !lostReply && event.startsWith("reply-lost");
				if (lose) lostReply = true;
				log.push({
					kind: "save",
					id: args.id,
					expected: args.expected,
					fs: (() => {
						try {
							return native.snapshot(target);
						} catch {
							return { unreadable: true };
						}
					})(),
				});
				if (lose && event === "reply-lost-unpublished")
					throw new Error("native reply lost");
				const reply = native.save(target, args.source, args.expected);
				if (lose) throw new Error("native reply lost");
				return reply;
			}
			if (command === "confirm_close_document") {
				asked.push(args.name);
				if (
					args.name === "anchor.pfdsl" &&
					timing === "during-confirm" &&
					!eventApplied
				)
					await applyEvent(false);
				return decisions[args.name];
			}
			throw new Error(`unexpected command ${command}`);
		};
		await import(`${pathToFileURL(output).href}?cell=${++cellSerial}`);
		await flush();
		const click = async (element) => {
			element.click();
			await settle();
		};
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
			violate("harness", "the cell did not settle");
		};
		const open = async (target) => {
			selected = target;
			await click(dom.window.document.querySelector("#open-file"));
			return globalThis.reviewActive();
		};
		const entry = await open(doc);
		if (tabState === "dirty") entry.tab.type(TEXT.edited);
		const guard = await open(anchor);
		guard.tab.type("anchor edit\n");
		entry.tab.button.click();
		const alive = () => globalThis.reviewEntries.has(entry);
		const fsNow = () => {
			try {
				return native.snapshot(doc);
			} catch {
				return { unreadable: true };
			}
		};

		// Event and observation.
		if (timing !== "during-confirm") await applyEvent(timing !== "unpolled");
		if (timing === "polled" || timing === "drift") await runPoll();
		const afterPoll = {
			setSourceCalls: entry.tab.setSourceCalls,
			conflict: entry.session.conflict,
			dirty: entry.session.isDirty(),
		};
		const panelButton = () =>
			[...dom.window.document.querySelectorAll("#conflicts button")].find(
				(b) => b.textContent === "Review and Save Here…",
			);
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
				dom.window.document.dispatchEvent(
					new dom.window.KeyboardEvent("keydown", {
						key: "s",
						metaKey: true,
						bubbles: true,
					}),
				);
				await settle();
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
					quitListener({ payload: String(presses) });
					await settle();
				}
			}
		}
		if (timing === "during-confirm" && !eventApplied) await applyEvent(false);
		await settle();

		const text = entry.tab.getSource();
		const fs = fsNow();
		const status = dom.window.document.querySelector("#status").textContent;
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
			if (
				timing === "polled" &&
				tabState === "dirty" &&
				SAVE_ACTIONS.has(action) &&
				log.some((item) => item.kind === "dialog")
			)
				violate("I4", "a dirty tab needed a review dialog to save");
		}

		// A document the cell finished with must not keep native work running.
		await settle();
		globalThis.nativeInvoke = async (command) => {
			leaks.push(command);
		};
		await flush();
		if (leaks.length) violate("harness", `leaked IPC ${leaks.join(",")}`);
	} catch (error) {
		violate("harness", String(error?.stack ?? error));
	} finally {
		dom.window.close();
	}
	results.set(label, violations);
	return violations;
}

for (const tab of TABS)
	for (const event of EVENTS)
		for (const timing of TIMINGS)
			for (const action of ACTIONS) {
				if (!applicable(tab, event, timing, action)) continue;
				const label = `${tab} | ${event} | ${timing} | ${action}`;
				test(
					label,
					KNOWN_RED.has(label) ? { todo: "known red" } : {},
					async () => {
						const violations = await runCell(label, tab, event, timing, action);
						assert.deepEqual(violations, [], label);
					},
				);
			}

test("KNOWN_RED lists only cells that still fail", () => {
	const stale = [...KNOWN_RED].filter(
		(label) => !results.has(label) || results.get(label).length === 0,
	);
	assert.deepEqual(stale, [], "remove these cells from KNOWN_RED");
});

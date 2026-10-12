import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import { pathToFileURL } from "node:url";
import { bundleHost, JSDOM, root } from "./host-bundle.mjs";

export const TEXT = { disk: "disk v1\n", edited: "edited by the user\n" };

export class FakeNative {
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
			history: [],
		};
		this.docs.set(id, doc);
		return doc;
	}
	/** The selected directory moved: the same file now has another path. */
	move(doc, path) {
		doc.history.push(doc.path);
		doc.path = path;
	}
	/**
	 * A second capability for the same leaf (the folder was selected again): same
	 * binding and file, new id.
	 */
	reselect(doc, id) {
		const alias = {
			id,
			path: doc.path,
			binding: doc.binding,
			history: [],
			get file() {
				return doc.file;
			},
			set file(value) {
				doc.file = value;
			},
			get unreadable() {
				return doc.unreadable;
			},
			set unreadable(value) {
				doc.unreadable = value;
			},
			get writes() {
				return doc.writes;
			},
			set writes(value) {
				doc.writes = value;
			},
		};
		this.docs.set(id, alias);
		return alias;
	}
	/** Another leaf name for the same file (a hard link): same content and inode. */
	link(doc, id, name) {
		const alias = {
			id,
			path: `/A/${name}`,
			binding: `dir:${name}`,
			file: doc.file,
			unreadable: false,
			writes: 0,
			history: [],
		};
		this.docs.set(id, alias);
		return alias;
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
		// expected null means "create": it succeeds only while the target is still absent.
		if (current.revision !== (expected ?? null))
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
	"reviewTabs",
	"reviewTabHook",
	"reviewNormalize",
];

export const flush = async () => {
	for (let i = 0; i < 100; i++) await Promise.resolve();
};

export const fsOf = (native, doc) => {
	try {
		return native.snapshot(doc);
	} catch {
		return { unreadable: true };
	}
};

/** Buttons whose click approves replacing, creating or adopting a disk version. */
const APPROVALS = new Set([
	"Replace Observed Version",
	"Create File",
	"Use Disk Version",
]);

/**
 * Holds one inspection of an armed target until `release`, which answers with
 * the file as it is at that moment, like a read that finishes late.
 */
export class InspectGate {
	constructor(native) {
		this.native = native;
		this.ids = new Set();
		this.held = null;
	}
	arm(...ids) {
		this.ids = new Set(ids);
	}
	hold(id) {
		if (!this.ids.has(id) || this.held) return undefined;
		return new Promise((resolve, reject) => {
			this.held = { id, resolve, reject };
		});
	}
	get isHeld() {
		return Boolean(this.held);
	}
	release() {
		const held = this.held;
		if (!held) return false;
		this.held = null;
		this.ids = new Set();
		try {
			held.resolve(this.native.snapshot(this.native.docs.get(held.id)));
		} catch (error) {
			held.reject(error);
		}
		return true;
	}
}

/** Bundles the production host once; every started host re-evaluates it. */
export async function createHarness(label) {
	const old = new Map(
		keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
	);
	const temp = mkdtempSync(
		join(root, `packages/standalone/node_modules/.${label}-`),
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
	/**
	 * Runs the production main.ts over `native`. Every dialog is answered with the
	 * choice that confirms replacing or creating the target. `handlers` supplies
	 * confirm_close_document (confirm), choose_save_target (choose) and may
	 * - lose a save reply (saveFault: "before" or "after" the write);
	 * - answer a save with a reply of its own, without touching the file (saveReply);
	 * - change the disk just before a save reaches the native side (beforeSave);
	 * - hold an inspection until the test releases it (inspectGate);
	 * - change the disk after an inspection was answered (afterInspect);
	 * - react when a dialog opens (onDialog) or pick another button (dialogChoice).
	 *
	 * The host records everything an invariant may need and nothing of the
	 * application's own state: `log` (cleared by each action) holds dialogs with
	 * their displayed texts and the button clicked, requests and their
	 * resolution order, and tab events; `ledger` (never cleared) holds what the
	 * application was told about each file and which versions the user approved.
	 */
	async function startHost(native, watched, handlers = {}) {
		const dom = new JSDOM(
			readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
		);
		const log = [];
		const ledger = {
			acks: [],
			received: [],
			failures: [],
			saves: [],
			offered: [],
		};
		let seq = 0;
		const tick = () => ++seq;
		let poll;
		let quitListener;
		let selected;
		let selection;
		let closeSaveOwner;
		let closeStart = 0;
		globalThis.document = dom.window.document;
		globalThis.window = dom.window;
		globalThis.self = dom.window;
		globalThis.reviewTabs = [];
		dom.window.__TAURI_INTERNALS__ = {};
		globalThis.setInterval = (fn) => {
			poll = fn;
			return 0;
		};
		const tabs = () => globalThis.reviewTabs;
		const activeTab = () =>
			tabs().find(
				(tab) =>
					tab.button.isConnected &&
					tab.button.getAttribute("aria-selected") === "true",
			);
		const know = (id, state) =>
			ledger.received.push({ seq: tick(), id, ...state });
		const approve = (id, content, why, tab = closeSaveOwner ?? activeTab()) =>
			ledger.acks.push({
				seq: tick(),
				id,
				binding: native.docs.get(id)?.binding,
				content,
				why,
				tab,
			});
		const learn = (snapshot) =>
			know(snapshot.id, {
				source: snapshot.source,
				revision: snapshot.revision,
				path: snapshot.path,
				binding: snapshot.binding,
			});
		globalThis.reviewTabHook = (kind, tab, text) => {
			if (kind === "dispose") log.push({ kind: "dispose", tab, seq: tick() });
			if (kind === "type") log.push({ kind: "type", tab, text, seq: tick() });
			if (kind === "setSource") {
				const seen = ledger.received.findLast((item) => item.source === text);
				log.push({ kind: "reload", tab, text, seq: tick(), id: seen?.id });
				if (seen) approve(seen.id, tab.getSource(), "reload", tab);
			}
		};
		dom.window.HTMLDialogElement.prototype.close = () => {};
		dom.window.HTMLDialogElement.prototype.showModal = function () {
			const fields = [...this.querySelectorAll("textarea")].map((f) => f.value);
			const text = this.querySelector("p").textContent;
			const target = [...ledger.received, ...ledger.offered]
				.sort((first, second) => first.seq - second.seq)
				.findLast((item) => item.path && text.includes(item.path))?.id;
			const entry = {
				kind: "dialog",
				seq: tick(),
				tab: closeSaveOwner ?? activeTab(),
				title: this.querySelector("h2").textContent,
				text,
				target,
				editor: fields[0],
				disk: fields[1],
				shownEditor: fields[0] ?? activeTab()?.getSource(),
				builtFrom: [...ledger.received, ...ledger.offered]
					.filter((item) => item.id === target)
					.sort((first, second) => first.seq - second.seq)
					.at(-1),
				fs: fsOf(native, watched),
				fsById: Object.fromEntries(
					[...native.docs].map(([id, doc]) => [id, fsOf(native, doc)]),
				),
				choice: undefined,
				editorAtClick: undefined,
			};
			this.entry = entry;
			log.push(entry);
			handlers.onDialog?.(entry);
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
			if (command === "exit_listener_ready") return;
			if (command === "read_dependency") {
				log.push({
					kind: "dependency",
					id: args.id,
					path: args.path,
					seq: tick(),
				});
				return "dependency text";
			}
			if (command === "finish_app_exit") {
				log.push({ kind: "exit", approved: args.approved, seq: tick() });
				return;
			}
			if (command === "select_document" || command === "open_document") {
				const snapshot = native.snapshot(selected);
				selection = snapshot;
				learn(snapshot);
				return snapshot;
			}
			if (command === "choose_save_target") {
				const chosen = await handlers.choose();
				if (chosen) {
					// A candidate target is shown to the user; it is not recorded as seen.
					ledger.offered.push({
						seq: tick(),
						id: chosen.id,
						source: chosen.source,
						revision: chosen.revision,
						path: chosen.path,
						binding: chosen.binding,
					});
					// Choosing a file starts from no acknowledged content.
					approve(chosen.id, undefined, "chosen");
				}
				log.push({ kind: "choose", id: chosen?.id, seq: tick() });
				return chosen;
			}
			if (command === "inspect_document") {
				const entry = {
					kind: "inspect",
					id: args.id,
					binding: native.docs.get(args.id)?.binding,
					seq: tick(),
					doneSeq: undefined,
					outcome: undefined,
				};
				log.push(entry);
				const finish = (snapshot) => {
					entry.doneSeq = tick();
					entry.outcome = "ok";
					entry.source = snapshot.source;
					learn(snapshot);
					handlers.afterInspect?.(args.id, snapshot);
					return snapshot;
				};
				const fail = (error) => {
					entry.doneSeq = tick();
					entry.outcome = "error";
					ledger.failures.push({ id: args.id, seq: entry.doneSeq });
					throw error;
				};
				const held = handlers.inspectGate?.(args.id);
				if (held) return held.then(finish, fail);
				let snapshot;
				try {
					snapshot = native.snapshot(native.docs.get(args.id));
				} catch (error) {
					return fail(error);
				}
				return finish(snapshot);
			}
			if (command === "save_document") {
				// Record submission before simulating work on the native side.
				const submittedSeq = tick();
				const target = native.docs.get(args.id);
				const fault = handlers.saveFault?.(args);
				handlers.beforeSave?.(args);
				const forced = handlers.saveReply?.(args);
				const entry = {
					kind: "save",
					tab: closeSaveOwner ?? activeTab(),
					seq: submittedSeq,
					id: args.id,
					binding: target.binding,
					source: args.source,
					expected: args.expected,
					fs: fsOf(native, target),
					outcome: "lost",
					wrote: false,
				};
				log.push(entry);
				ledger.saves.push(entry);
				if (forced) {
					entry.outcome = forced.outcome;
					if (forced.current) learn(forced.current);
					else know(args.id, { unknown: true });
					return forced;
				}
				if (fault === "before") {
					know(args.id, { unknown: true });
					throw new Error("native reply lost");
				}
				const reply = native.save(target, args.source, args.expected);
				if (fault === "after") {
					know(args.id, { unknown: true });
					throw new Error("native reply lost");
				}
				entry.outcome = reply.outcome;
				entry.wrote = reply.publication === "published";
				if (reply.current) learn(reply.current);
				else know(args.id, { unknown: true });
				if (reply.outcome === "saved" && reply.current)
					approve(args.id, reply.current.source, "save");
				return reply;
			}
			if (command === "confirm_close_document") {
				const owner = tabs().find(
					(tab) =>
						tab.button.isConnected &&
						tab.button.textContent.replace(/ •$/, "") === args.name &&
						!log.some(
							(item) =>
								item.kind === "confirm" &&
								item.tab === tab &&
								item.seq > closeStart,
						),
				);
				const entry = {
					kind: "confirm",
					tab: owner,
					seq: tick(),
					name: args.name,
					textAtRequest: owner?.getSource(),
					decision: undefined,
					decidedSeq: undefined,
					fsById: Object.fromEntries(
						[...native.docs].map(([id, doc]) => [id, fsOf(native, doc)]),
					),
				};
				log.push(entry);
				entry.decision = await handlers.confirm(args.name);
				closeSaveOwner = entry.decision === "save" ? owner : undefined;
				entry.decidedSeq = tick();
				return entry.decision;
			}
			throw new Error(`unexpected command ${command}`);
		};
		await import(`${pathToFileURL(output).href}?cell=${++cellSerial}`);
		await flush();
		const query = (selector) => dom.window.document.querySelector(selector);
		const busy = () => query("#save").disabled;
		const settle = async () => {
			for (let i = 0; i < 60; i++) {
				await flush();
				const dialog = query("dialog");
				if (dialog) {
					const title = dialog.querySelector("h2").textContent;
					const confirm =
						handlers.dialogChoice?.(title, dialog.entry) ??
						(title === "Review the target"
							? "Replace Observed Version"
							: title === "Recreate missing file"
								? "Create File"
								: "Keep Editing");
					dialog.entry.choice = confirm;
					dialog.entry.editorAtClick = activeTab()?.getSource();
					dialog.entry.clickSeq = tick();
					if (APPROVALS.has(confirm) && dialog.entry.target !== undefined)
						approve(
							dialog.entry.target,
							dialog.entry.title === "Recreate missing file"
								? null
								: dialog.entry.disk,
							"approval",
						);
					[...dialog.querySelectorAll("button")]
						.find((b) => b.textContent === confirm)
						.click();
					continue;
				}
				if (!busy()) {
					closeSaveOwner = undefined;
					return;
				}
			}
			throw new Error("the host did not settle");
		};
		const click = async (element) => {
			if (element.classList.contains("close-document")) closeStart = tick();
			element.click();
			await settle();
		};
		const all = (selector) => [
			...dom.window.document.querySelectorAll(selector),
		];
		return {
			dom,
			log,
			ledger,
			settle,
			click,
			query,
			queryAll: all,
			tick,
			tabs,
			activeTab,
			isOpen: (tab) => tab.button.isConnected,
			isDirty: (tab) => tab.button.textContent.endsWith(" •"),
			nameOf: (tab) => tab.button.textContent.replace(/ •$/, ""),
			closeButton: (tab) =>
				tab.button.parentElement.querySelector(".close-document"),
			/** What the conflict panel shows, read from the DOM. */
			panel() {
				const root = query("#conflicts");
				const paragraphs = [...root.querySelectorAll("p")].map(
					(item) => item.textContent,
				);
				const target = /Recovery target: (.*)\.$/.exec(paragraphs[0] ?? "");
				const button = (text) =>
					all("#conflicts button").find((item) => item.textContent === text);
				return {
					present: root.children.length > 0,
					recoveryPath: target?.[1],
					preview: root.querySelector("pre")?.textContent,
					originalAlsoChanged: paragraphs.some((text) =>
						/also changed/.test(text),
					),
					review: button("Review and Save Here…"),
					use: button("Use Current Disk Version…"),
					saveAs: button("Save As…"),
				};
			},
			async open(target) {
				const before = new Set(tabs());
				selected = target;
				selection = undefined;
				await click(query("#open-file"));
				const tab = activeTab();
				if (!before.has(tab)) approve(target.id, tab.getSource(), "open", tab);
				else if (
					selection?.source !== null &&
					selection &&
					tab.location === selection.path
				) {
					// A capability changes ownership, not which disk text the editor accepted.
					const accepted = ledger.acks.findLast(
						(ack) => ack.tab === tab && ack.content !== undefined,
					);
					if (accepted && accepted.id !== target.id)
						approve(target.id, accepted.content, "rebind", tab);
				}
				return tab;
			},
			async newDocument() {
				await click(query("#new"));
				return activeTab();
			},
			async runPoll() {
				poll();
				await flush();
			},
			/** Starts a quit request without waiting for the host to go idle. */
			beginQuit(payload) {
				closeStart = tick();
				quitListener({ payload: String(payload) });
			},
			async quit(payload) {
				closeStart = tick();
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

	return { startHost };
}

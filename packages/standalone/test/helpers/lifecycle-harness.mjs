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
	 * - change the disk just before a save reaches the native side (beforeSave);
	 * - hold an inspection until the test releases it (inspectGate);
	 * - react when a dialog opens (onDialog) or pick another button (dialogChoice).
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
			const text = this.querySelector("p").textContent;
			const entry = {
				kind: "dialog",
				title: this.querySelector("h2").textContent,
				text,
				target: [...native.docs.values()].find((doc) => text.includes(doc.path))
					?.id,
				editor: fields[0],
				disk: fields[1],
				shownEditor: globalThis.reviewActive?.()?.tab.getSource(),
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
			if (command === "exit_listener_ready" || command === "finish_app_exit")
				return;
			if (command === "select_document" || command === "open_document")
				return native.snapshot(selected);
			if (command === "choose_save_target") {
				const chosen = await handlers.choose();
				log.push({ kind: "choose", id: chosen?.id });
				return chosen;
			}
			if (command === "inspect_document") {
				log.push({ kind: "inspect", id: args.id });
				const held = handlers.inspectGate?.(args.id);
				if (held) return held;
				return native.snapshot(native.docs.get(args.id));
			}
			if (command === "save_document") {
				const target = native.docs.get(args.id);
				const fault = handlers.saveFault?.(args);
				handlers.beforeSave?.(args);
				const entry = {
					kind: "save",
					id: args.id,
					source: args.source,
					expected: args.expected,
					fs: fsOf(native, target),
					outcome: "lost",
					wrote: false,
				};
				log.push(entry);
				if (fault === "before") throw new Error("native reply lost");
				const reply = native.save(target, args.source, args.expected);
				if (fault === "after") throw new Error("native reply lost");
				entry.outcome = reply.outcome;
				entry.wrote = reply.publication === "published";
				return reply;
			}
			if (command === "confirm_close_document") {
				const entry = {
					kind: "confirm",
					name: args.name,
					decision: undefined,
					fsById: Object.fromEntries(
						[...native.docs].map(([id, doc]) => [id, fsOf(native, doc)]),
					),
				};
				log.push(entry);
				entry.decision = await handlers.confirm(args.name);
				return entry.decision;
			}
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
						handlers.dialogChoice?.(title, dialog.entry) ??
						(title === "Review the target"
							? "Replace Observed Version"
							: title === "Recreate missing file"
								? "Create File"
								: "Keep Editing");
					dialog.entry.choice = confirm;
					dialog.entry.editorAtClick = globalThis
						.reviewActive?.()
						?.tab.getSource();
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
			queryAll: (selector) => [
				...dom.window.document.querySelectorAll(selector),
			],
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

	return { startHost };
}

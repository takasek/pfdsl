import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import { pathToFileURL } from "node:url";
import { bundleHost, JSDOM, root } from "./host-bundle.mjs";
import {
	createLifecycleEvidence,
	createNativeRecorder,
} from "./lifecycle-evidence.mjs";
import { fsOf } from "./lifecycle-native.mjs";

export { FakeNative, fsOf, InspectGate, TEXT } from "./lifecycle-native.mjs";

export const flush = async () => {
	for (let i = 0; i < 100; i++) await Promise.resolve();
};

/** Buttons whose click approves replacing, creating or adopting a disk version. */
const APPROVALS = new Set([
	"Replace Observed Version",
	"Create File",
	"Use Disk Version",
]);

/** Import one application factory; each host receives separate DOM and native boundaries. */
export async function createHarness(label, options) {
	const temp = mkdtempSync(
		join(root, `packages/standalone/node_modules/.${label}-`),
	);
	const output = join(temp, "main.mjs");
	await bundleHost(output, options);
	const {
		mountApplication,
		createDocumentTab,
		createTextComparison,
		createTestMenu,
	} = await import(pathToFileURL(output).href);
	after(() => {
		rmSync(temp, { recursive: true, force: true });
	});
	/**
	 * Mounts the production application over `native`. Every dialog is answered with the
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
		let menu;
		const recordedTabs = [];
		const dom = new JSDOM(
			readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
		);
		const evidence = createLifecycleEvidence(native);
		const { log, ledger, tick, learn } = evidence;
		let poll;
		let quitListener;
		let selected;
		let selection;
		let closeSaveOwner;
		let closeStart = 0;
		// Monaco/preview integration still requires its browser realm; fake host tests do not.
		const previousDocument = options?.realDocumentTabs
			? Object.getOwnPropertyDescriptor(globalThis, "document")
			: undefined;
		if (options?.realDocumentTabs) globalThis.document = dom.window.document;
		const tabs = () => recordedTabs;
		const activeTab = () =>
			tabs().find(
				(tab) =>
					tab.button.isConnected &&
					tab.button.getAttribute("aria-selected") === "true",
			);
		const approve = (id, content, why, tab = closeSaveOwner ?? activeTab()) =>
			evidence.approve(id, content, why, tab);
		const recorder = createNativeRecorder(
			native,
			evidence,
			handlers,
			() => closeSaveOwner ?? activeTab(),
		);
		const hook = (kind, tab, text) => {
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
			handlers.onDecision?.(entry);
		};
		const verifyCorpus = () => new Promise(() => {});
		const listen = async (_, listener) => {
			quitListener = listener;
			return () => {};
		};
		let invoke = async (command, args) => {
			if (command === "select_folder") return handlers.selectFolder?.() ?? null;
			if (command === "list_documents") return handlers.listDocuments?.() ?? [];
			if (command === "remember_folder") return;
			if (command === "document_capabilities")
				return handlers.capabilities
					? handlers.capabilities()
					: { save: true, reason: null };
			if (command === "list_recent") return [];
			if (command === "remember_document") return handlers.remember?.();
			if (command === "release_document") return;
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
			if (command === "choose_save_target") return recorder.choose(args.name);
			if (command === "inspect_document") return recorder.inspect(args.id);
			if (command === "save_document") return recorder.save(args);
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
					allowSave: args.allowSave,
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
		const app = mountApplication({
			document: dom.window.document,
			createTextComparison,
			createDocumentTab(options) {
				const tab = createDocumentTab(options, {
					normalize: handlers.normalize,
					hook,
				});
				recordedTabs.push(tab);
				return tab;
			},
			scheduler: {
				setInterval(fn) {
					poll = fn;
					return 0;
				},
				clearInterval() {
					poll = () => {};
				},
			},
			native: {
				invoke: (...args) => invoke(...args),
				listen,
				verifyCorpus,
				installMenu: async (command, recent) => {
					menu = createTestMenu(command, recent);
					return menu;
				},
				setTitle: async (title) => handlers.setTitle?.(title),
				closeWindow: async () => {},
			},
		});
		await flush();
		const query = (selector) => dom.window.document.querySelector(selector);
		const isIdle = async () => {
			let completed = false;
			void app.idle().then(() => {
				completed = true;
			});
			await flush();
			return completed;
		};
		const settle = async () => {
			for (let i = 0; i < 60; i++) {
				await flush();
				const dialog = query("dialog");
				if (dialog) {
					const title = dialog.querySelector("h2").textContent;
					const kind = {
						"Review the target": "replace",
						"Recreate missing file": "recreate",
						"Discard editor changes": "adopt",
					}[title];
					const decision = await handlers.decide?.({ kind }, dialog.entry);
					const confirm =
						{
							replace: "Replace Observed Version",
							create: "Create File",
							disk: "Use Disk Version",
							cancel: "Keep Editing",
							another: "Choose Another File",
						}[decision] ??
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
				if (await isIdle()) {
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
		const menuItem = (id) => menu.items.find((item) => item.id === id);
		const command = async (id) => {
			await flush();
			const item = menuItem(id);
			assert.ok(item, `Missing menu command ${id}`);
			if (item.enabled) item.action();
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
			command,
			save: () => command("save"),
			saveAs: () => command("save-as"),
			menuItem,
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
			/** Semantic observations shared with the controller contract tests. */
			conflict() {
				const panel = this.panel();
				return {
					present: panel.present,
					targetId: [...native.docs.values()].find(
						(doc) => doc.path === panel.recoveryPath,
					)?.id,
					recoveryPath: panel.recoveryPath,
					preview: panel.preview,
					originalAlsoChanged: panel.originalAlsoChanged,
					actions: {
						review: Boolean(panel.review && !panel.review.disabled),
						useDisk: Boolean(panel.use && !panel.use.disabled),
						saveAs: Boolean(panel.saveAs && !panel.saveAs.disabled),
					},
				};
			},
			async open(target) {
				const before = new Set(tabs());
				selected = target;
				selection = undefined;
				await command("open-file");
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
				await command("new");
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
				app.dispose();
				await flush();
				const leaks = [];
				invoke = async (command) => {
					leaks.push(command);
				};
				await flush();
				dom.window.close();
				if (options?.realDocumentTabs) {
					if (previousDocument)
						Object.defineProperty(globalThis, "document", previousDocument);
					else delete globalThis.document;
				}
				return leaks;
			},
		};
	}

	return { startHost };
}

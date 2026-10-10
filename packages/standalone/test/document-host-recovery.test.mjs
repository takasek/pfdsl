import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(`${root}/packages/standalone/package.json`);
const { build } = require("esbuild");
const { JSDOM } = require("jsdom");
test("Save As recovery retains target ownership and refuses intervening edits in the real host", async () => {
	const temp = mkdtempSync(
		join(root, "packages/standalone/node_modules/.host-recovery-"),
	);
	const output = join(temp, "main.mjs");
	const keys = [
		"document",
		"window",
		"self",
		"setInterval",
		"calls",
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
	let dom;
	try {
		dom = new JSDOM(
			readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
		);
		globalThis.document = dom.window.document;
		globalThis.window = dom.window;
		globalThis.self = dom.window;
		dom.window.__TAURI_INTERNALS__ = {};
		dom.window.HTMLDialogElement.prototype.showModal = () => {};
		dom.window.HTMLDialogElement.prototype.close = () => {};
		let poll;
		globalThis.setInterval = (fn) => {
			poll = fn;
			return 0;
		};
		const A = {
			id: 1,
			path: "/A/a.pfdsl",
			source: "original A",
			revision: "a0",
			identity: "inodeA",
		};
		const B = {
			id: 2,
			path: "/B/b.pfdsl",
			source: "old B",
			revision: "b0",
			identity: "inodeB",
		};
		const published = { ...B, source: "local", revision: "b1" };
		let pendingInspect = null;
		let selectedDocument = A;
		let quitListener;
		let decisions = [];
		let saveTarget = B;
		let saveReply = null;
		let releaseAcceptance;
		let pendingClose = null;
		let pendingExitAck = null;
		globalThis.nativeAcceptance = () =>
			new Promise((resolve) => {
				releaseAcceptance = resolve;
			});
		globalThis.nativeListen = async (_, listener) => {
			quitListener = listener;
			return () => {};
		};
		globalThis.calls = [];
		globalThis.nativeInvoke = async (command, args) => {
			calls.push({ command, args });
			if (command === "list_recent") return [];
			if (command === "remember_document" || command === "release_document")
				return;
			if (command === "select_document" || command === "open_document")
				return selectedDocument;
			if (command === "choose_save_target") return saveTarget;
			if (command === "exit_listener_ready") return;
			if (command === "finish_app_exit")
				return args.approved ? undefined : pendingExitAck;
			if (command === "confirm_close_document")
				return pendingClose ?? decisions.shift() ?? "cancel";
			if (command === "save_document" && saveReply instanceof Error)
				throw saveReply;
			if (command === "save_document" && saveReply) return saveReply;
			if (command === "save_document")
				return {
					outcome: "conflict",
					current: published,
					message: "publication race",
				};
			if (command === "inspect_document") {
				if (pendingInspect) return pendingInspect;
				return args.id === 1 ? A : published;
			}
			if (command === "read_dependency") return "dependency";
			throw new Error(`unexpected command ${command}`);
		};
		await build({
			stdin: {
				contents:
					readFileSync(`${root}/packages/standalone/src/main.ts`, "utf8") +
					"\nglobalThis.reviewEntries=opened;globalThis.reviewActive=()=>active;globalThis.reviewBusy=()=>busy;",
				resolveDir: `${root}/packages/standalone/src`,
				sourcefile: "main.ts",
				loader: "ts",
			},
			outfile: output,
			bundle: true,
			platform: "node",
			format: "esm",
			plugins: [
				{
					name: "review-seams",
					setup(b) {
						b.onResolve(
							{
								filter:
									/^(?:@tauri-apps\/api\/|@pfdsl\/editor$|monaco-editor\/|\.\/document-tab\.js$|\.\/acceptance\.js$|\.\/style\.css$)/,
							},
							(args) => ({ path: args.path, namespace: "review-seams" }),
						);
						b.onLoad({ filter: /.*/, namespace: "review-seams" }, (args) => ({
							contents:
								args.path === "@tauri-apps/api/core"
									? "export const invoke=(...args)=>globalThis.nativeInvoke(...args);"
									: args.path === "@tauri-apps/api/event"
										? "export const listen=(...args)=>globalThis.nativeListen(...args);"
										: args.path === "@tauri-apps/api/window"
											? "export const getCurrentWindow=()=>({onCloseRequested(){},destroy(){}});"
											: args.path === "@pfdsl/editor"
												? 'export const previewStyles="";'
												: args.path === "./acceptance.js"
													? "export const verifyNativeCorpus=()=>globalThis.nativeAcceptance();"
													: args.path === "./style.css"
														? ""
														: args.path === "./document-tab.js"
															? `
export function createDocumentTab(options){
 let source=options.source,revision=0;
 const container=document.createElement('div'),button=document.createElement('button');
 options.parent.append(container);button.textContent=options.name;
 return {container,button,location:options.path,activate(){},dispose(){container.remove();button.remove();},getSource:()=>source,getRevision:()=>revision,setSource(s){source=s;revision++;options.onChange?.();},setLocation(path,name,read){this.location=path;this.read=read;button.textContent=name;},markSaved(){},format(){}};
}`
															: "export default class Worker {}",
							loader: "js",
						}));
					},
				},
			],
		});
		await import(pathToFileURL(output).href);
		const flush = async () => {
			for (let i = 0; i < 20; i++) await Promise.resolve();
		};
		const click = async (selector) => {
			document.querySelector(selector).click();
			await flush();
		};
		const dialogClick = async (text) => {
			[...document.querySelectorAll("dialog button")]
				.find((b) => b.textContent === text)
				.click();
			await flush();
		};
		// Equal display paths can belong to different selected directories.
		const baselineSelection = selectedDocument;
		const baselineTabCount = reviewEntries.size;
		selectedDocument = { ...A, id: 100, binding: "old-parent:a.pfdsl" };
		await click("#open-file");
		const oldBinding = reviewActive();
		oldBinding.tab.setSource("keep old edits");
		selectedDocument = {
			...A,
			id: 101,
			binding: "new-parent:a.pfdsl",
			identity: "new-inode",
			source: "new folder content",
		};
		await click("#open-file");
		const newBinding = reviewActive();
		assert.notEqual(newBinding, oldBinding);
		assert.equal(newBinding.tab.getSource(), "new folder content");
		assert.equal(oldBinding.tab.getSource(), "keep old edits");
		for (let id = 102; id < 112; id++) {
			selectedDocument = { ...selectedDocument, id };
			await click("#open-file");
			assert.equal(reviewActive(), newBinding);
			assert.equal(reviewEntries.size, baselineTabCount + 2);
			assert.ok(
				calls.some(
					(call) =>
						call.command === "release_document" && call.args.id === id - 1,
				),
			);
		}
		// A canceled Save As releases the newly selected target immediately.
		saveTarget = { ...B, id: 112, source: "existing target" };
		await click("#save-as");
		await dialogClick("Keep Editing");
		assert.ok(
			calls.some(
				(call) => call.command === "release_document" && call.args.id === 112,
			),
		);
		// A target already open in another tab is also released after rejection.
		saveTarget = { ...A, id: 113, binding: "old-parent:a.pfdsl" };
		await click("#save-as");
		assert.ok(
			calls.some(
				(call) => call.command === "release_document" && call.args.id === 113,
			),
		);
		for (const document of [oldBinding, newBinding]) {
			decisions = ["discard"];
			document.navigation.querySelector(".close-document").click();
			await flush();
		}
		for (const id of [100, 111])
			assert.ok(
				calls.some(
					(call) => call.command === "release_document" && call.args.id === id,
				),
			);
		assert.equal(reviewEntries.size, baselineTabCount);
		selectedDocument = baselineSelection;
		saveTarget = B;
		await click("#open-file");
		const entry = reviewActive();
		entry.tab.setSource("local");
		await click("#save-as");
		await dialogClick("Replace Observed Version");
		const results = {
			beforePoll: {
				disk: entry.session.disk.path,
				observed: entry.session.observed.path,
				conflict: entry.session.conflict.path,
			},
		};
		poll();
		await flush();
		results.afterPoll = {
			disk: entry.session.disk.path,
			observed: entry.session.observed.path,
			conflict: entry.session.conflict.path,
		};
		// Exercise the real host recovery DOM for a reply lost after a clean Save As.
		selectedDocument = {
			...A,
			id: 23,
			path: "/uncertain/a.pfdsl",
			identity: "uncertainA",
		};
		saveTarget = {
			...B,
			id: 24,
			path: "/uncertain/b.pfdsl",
			identity: "uncertainB",
		};
		saveReply = new Error("native reply lost");
		await click("#open-file");
		const uncertain = reviewActive();
		await click("#save-as");
		await dialogClick("Replace Observed Version");
		assert.equal(uncertain.session.isDirty(), true);
		assert.equal(uncertain.session.disk.path, selectedDocument.path);
		assert.equal(uncertain.session.observed, null);
		assert.equal(uncertain.session.pendingTarget.path, saveTarget.path);
		assert.equal(uncertain.tab.getSource(), A.source);
		assert.match(
			document.querySelector("#conflicts").textContent,
			/could not be confirmed/,
		);
		assert.match(
			document.querySelector("#conflicts").textContent,
			/Recovery target: \/uncertain\/b.pfdsl/,
		);
		const recoveryButtons = [...document.querySelectorAll("#conflicts button")];
		assert.equal(
			recoveryButtons.find((b) => b.textContent === "Review and Save Here…")
				.disabled,
			true,
		);
		assert.equal(
			recoveryButtons.find((b) => b.textContent === "Use Current Disk Version…")
				.disabled,
			true,
		);
		assert.equal(
			recoveryButtons.find((b) => b.textContent === "Save As…").disabled,
			false,
		);
		decisions = ["discard"];
		uncertain.navigation.querySelector(".close-document").click();
		await flush();
		// A manually supplied packet is emitted by the actual native post-publication fault test.
		if (process.env.PFDSL_NATIVE_SAVE_RECEIPT) {
			const packet = JSON.parse(
				readFileSync(process.env.PFDSL_NATIVE_SAVE_RECEIPT, "utf8"),
			);
			assert.equal(packet.targetWasDirectory, true);
			assert.equal(packet.observedPublishedContent, packet.buffer);

			selectedDocument = packet.baseline;
			saveTarget = packet.baseline;
			saveReply = packet.result;
			await click("#open-file");
			const nativeFailure = reviewActive();
			nativeFailure.tab.setSource(packet.buffer);
			await click("#save-as");
			await dialogClick("Replace Observed Version");
			assert.equal(nativeFailure.session.saveFailure.publication, "published");
			assert.equal(nativeFailure.session.saveFailure.targetState, "unreadable");
			assert.equal(nativeFailure.session.observed, null);
			assert.equal(
				nativeFailure.session.disk.revision,
				packet.baseline.revision,
			);
			assert.equal(nativeFailure.session.pendingTarget.id, packet.baseline.id);
			assert.equal(nativeFailure.tab.getSource(), packet.buffer);
			assert.equal(nativeFailure.session.isDirty(), true);

			assert.match(
				document.querySelector("#conflicts").textContent,
				/save was published/,
			);
			assert.equal(
				[...document.querySelectorAll("#conflicts button")].find(
					(b) => b.textContent === "Use Current Disk Version…",
				).disabled,
				true,
			);
			decisions = ["discard"];
			nativeFailure.navigation.querySelector(".close-document").click();
			await flush();
		}
		saveReply = null;
		saveTarget = B;
		decisions = [];

		// Open B independently while A still owns a failed Save As recovery.
		selectedDocument = published;
		await click("#open-file");
		const other = reviewActive();
		assert.notEqual(other, entry);
		other.tab.setSource("unsaved B buffer");
		entry.tab.button.click();
		await click("#conflicts button:nth-of-type(3)");
		if (document.querySelector("dialog")) await dialogClick("Use Disk Version");
		assert.equal(
			entry.session.disk.path,
			A.path,
			"a target already open elsewhere must not be adopted",
		);
		assert.equal(entry.tab.getSource(), "local");
		assert.equal(other.tab.getSource(), "unsaved B buffer");
		// Finish this separate tab explicitly so later recovery can adopt B.
		other.tab.setSource(published.source);
		other.navigation.querySelector(".close-document").click();
		await flush();
		entry.tab.button.click();
		// Recreate B's pending recovery; choose its disk version before an A poll.
		await click("#save-as");
		await dialogClick("Replace Observed Version");
		let release;
		pendingInspect = new Promise((resolve) => (release = resolve));
		await click("#conflicts button:nth-of-type(3)");
		await dialogClick("Use Disk Version");
		entry.tab.setSource("typed after confirmation");
		release(published);
		await flush();
		pendingInspect = null;
		results.afterUseDisk = {
			source: entry.tab.getSource(),
			disk: entry.session.disk.path,
			tabLocation: entry.tab.location,
			name: entry.name,
			entryPath: entry.path,
		};
		await click("#conflicts button:nth-of-type(3)");
		await dialogClick("Use Disk Version");
		results.afterStableUseDisk = {
			source: entry.tab.getSource(),
			disk: entry.session.disk.path,
			tabLocation: entry.tab.location,
			name: entry.name,
			entryPath: entry.path,
		};
		if (entry.tab.read) {
			await entry.tab.read("/B/preset.yaml");
			results.dependencyCall = calls.at(-1);
		}
		assert.equal(results.afterPoll.observed, B.path);
		assert.equal(results.afterPoll.conflict, B.path);
		assert.ok(
			!calls.some(
				(call) => call.command === "release_document" && call.args.id === B.id,
			),
			"Unresolved Save As target must stay usable",
		);
		assert.equal(results.afterUseDisk.source, "typed after confirmation");
		assert.equal(results.afterUseDisk.disk, A.path);
		assert.equal(results.afterStableUseDisk.source, published.source);
		assert.equal(results.afterStableUseDisk.disk, B.path);
		assert.equal(results.afterStableUseDisk.tabLocation, B.path);
		assert.equal(results.afterStableUseDisk.name, "b.pfdsl");
		assert.equal(results.afterStableUseDisk.entryPath, B.path);
		assert.equal(results.dependencyCall.args.id, 2);
		const beforeRenameCount = reviewEntries.size;
		entry.tab.setSource("unsaved after rename");
		selectedDocument = { ...published, id: 3, path: "/C/renamed.pfdsl" };
		await click("#open-file");
		assert.equal(reviewActive(), entry);
		assert.equal(reviewEntries.size, beforeRenameCount);
		assert.equal(entry.session.disk.path, selectedDocument.path);
		assert.equal(entry.session.disk.id, 3);
		assert.ok(
			calls.some(
				(call) => call.command === "release_document" && call.args.id === B.id,
			),
		);
		assert.equal(entry.path, selectedDocument.path);
		assert.equal(entry.tab.location, selectedDocument.path);
		assert.equal(entry.name, "renamed.pfdsl");
		assert.equal(entry.tab.getSource(), "unsaved after rename");
		assert.equal(entry.session.isDirty(), true);
		await entry.tab.read("/C/preset.yaml");
		assert.equal(calls.at(-1).args.id, 3);
		assert.equal(reviewBusy(), false);
		assert.equal(
			typeof quitListener,
			"function",
			"normal native Quit must enter the document transaction",
		);
		await click("#new");
		const unsaved = reviewActive();
		unsaved.tab.setSource("unique untitled buffer");
		const all = [...reviewEntries];
		decisions = ["discard", "cancel"];
		quitListener({ payload: "1" });
		quitListener({ payload: "1" });
		await flush();
		assert.deepEqual([...reviewEntries], all);
		assert.equal(entry.tab.getSource(), "unsaved after rename");
		assert.equal(unsaved.tab.getSource(), "unique untitled buffer");
		assert.equal(
			calls.filter(
				(c) => c.command === "finish_app_exit" && c.args.request === "1",
			).length,
			1,
		);
		assert.deepEqual(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "1",
			).args,
			{ request: "1", approved: false },
		);
		const promptsAfterCancel = calls.filter(
			(c) => c.command === "confirm_close_document",
		).length;
		decisions = ["discard", "discard"];
		quitListener({ payload: "1" });
		await flush();
		assert.deepEqual(
			[...reviewEntries],
			all,
			"a delayed duplicate of a cancelled native request must not close documents",
		);
		assert.equal(
			calls.filter((c) => c.command === "confirm_close_document").length,
			promptsAfterCancel,
		);
		saveTarget = {
			...B,
			id: 10,
			path: "/separate/target.pfdsl",
			identity: "inodeC",
		};
		await click("#save-as");
		assert.equal(reviewBusy(), true);
		let releaseExitAck;
		pendingExitAck = new Promise((resolve) => {
			releaseExitAck = resolve;
		});
		quitListener({ payload: "2" });
		await flush();
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "2",
			).args.approved,
			false,
		);
		await dialogClick("Keep Editing");
		assert.equal(reviewBusy(), false);
		const promptsAfterBusy = calls.filter(
			(c) => c.command === "confirm_close_document",
		).length;
		decisions = ["discard", "discard"];
		quitListener({ payload: "2" });
		await flush();
		assert.deepEqual(
			[...reviewEntries],
			all,
			"a delayed duplicate of a busy-rejected Quit must retain all buffers",
		);
		assert.equal(
			calls.filter((c) => c.command === "confirm_close_document").length,
			promptsAfterBusy,
		);
		releaseExitAck();
		pendingExitAck = null;
		await flush();
		quitListener({ payload: "2" });
		await flush();
		assert.deepEqual([...reviewEntries], all);
		assert.equal(
			calls.filter((c) => c.command === "confirm_close_document").length,
			promptsAfterBusy,
		);
		decisions = ["discard", "save"];
		saveTarget = null;
		quitListener({ payload: "3" });
		await flush();
		assert.deepEqual(
			[...reviewEntries],
			all,
			"Save As cancellation must cancel Quit and retain earlier Discard decisions",
		);
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "3",
			).args.approved,
			false,
		);
		let releaseClose;
		pendingClose = new Promise((resolve) => {
			releaseClose = resolve;
		});
		quitListener({ payload: "4" });
		await flush();
		selectedDocument = {
			...B,
			id: 11,
			path: "/late/d.pfdsl",
			identity: "inodeD",
			source: "late disk",
			revision: "d0",
		};
		releaseAcceptance({ path: selectedDocument.path });
		await flush();
		const late = reviewActive();
		assert.notEqual(late, unsaved);
		late.tab.setSource("unique late editor");
		pendingClose = null;
		decisions = ["discard"];
		releaseClose("discard");
		await flush();
		assert.equal(
			reviewEntries.size,
			all.length + 1,
			"a document added during Quit must abort before disposing earlier documents",
		);
		for (const original of all) assert.equal(reviewEntries.has(original), true);
		assert.equal(late.tab.getSource(), "unique late editor");
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "4",
			).args.approved,
			false,
		);
		decisions = ["discard", "discard", "discard"];
		quitListener({ payload: "5" });
		await flush();
		assert.equal(reviewEntries.size, 0);
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "5",
			).args.approved,
			true,
		);
	} finally {
		for (let i = 0; i < 100; i++) await Promise.resolve();
		dom?.window.close();
		for (const key of keys) {
			const descriptor = old.get(key);
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		rmSync(temp, { recursive: true, force: true });
	}
});

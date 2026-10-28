import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { bundleHost, JSDOM, root } from "./helpers/host-bundle.mjs";

test("Save As recovery retains target ownership and refuses intervening edits in the real host", async () => {
	const temp = mkdtempSync(
		join(root, "packages/standalone/node_modules/.host-recovery-"),
	);
	const output = join(temp, "main.mjs");
	let application;
	let dom;
	try {
		dom = new JSDOM(
			readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
		);
		const document = dom.window.document;
		const tabs = [];
		const openTabs = () => tabs.filter((tab) => tab.button.isConnected);
		const activeTab = () =>
			openTabs().find(
				(tab) => tab.button.getAttribute("aria-selected") === "true",
			);
		const isDirty = (tab) => tab.button.textContent.endsWith(" •");
		const tabName = (tab) => tab.button.textContent.replace(/ •$/, "");
		dom.window.HTMLDialogElement.prototype.showModal = () => {};
		dom.window.HTMLDialogElement.prototype.close = () => {};
		let poll;
		const A = {
			id: 1,
			path: "/A/a.pfdsl",
			source: "original A",
			revision: "a0",
			identity: "inodeA",
			binding: "directoryA:a.pfdsl",
		};
		const B = {
			id: 2,
			path: "/B/b.pfdsl",
			source: "old B",
			revision: "b0",
			identity: "inodeB",
			binding: "directoryB:b.pfdsl",
		};
		const published = { ...B, source: "local", revision: "b1" };
		let pendingInspect = null;
		let inspectFailure = null;
		const inspectSnapshots = new Map();
		let selectedDocument = A;
		let quitListener;
		let decisions = [];
		let saveTarget = B;
		let saveReply = null;
		let releaseAcceptance;
		let pendingClose = null;
		let pendingExitAck = null;
		const verifyCorpus = () =>
			new Promise((resolve) => {
				releaseAcceptance = resolve;
			});
		const listen = async (_, listener) => {
			quitListener = listener;
			return () => {};
		};
		const calls = [];
		const invoke = async (command, args) => {
			calls.push({ command, args });
			if (command === "document_capabilities")
				return { save: true, reason: null };
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
				if (inspectSnapshots.has(args.id)) return inspectSnapshots.get(args.id);
				if (inspectFailure) throw inspectFailure;
				if (pendingInspect) return pendingInspect;
				return args.id === 1 ? A : published;
			}
			if (command === "read_dependency") return "dependency";
			throw new Error(`unexpected command ${command}`);
		};
		await bundleHost(output);
		const {
			mountApplication,
			createDocumentTab,
			createTextComparison,
			createTestMenu,
		} = await import(pathToFileURL(output).href);
		let menu;
		application = mountApplication({
			document,
			createDocumentTab(options) {
				const tab = createDocumentTab(options);
				tabs.push(tab);
				return tab;
			},
			createTextComparison,
			scheduler: {
				setInterval(callback) {
					poll = callback;
					return 0;
				},
				clearInterval() {},
			},
			native: {
				invoke,
				listen,
				verifyCorpus,
				installMenu: async (command, recent) => {
					menu = createTestMenu(command, recent);
					return menu;
				},
				setTitle: async () => {},
				closeWindow: async () => {},
			},
		});
		// A turn boundary allows deliberately pending dialogs and native reads to
		// reach their observable checkpoints without awaiting those held operations.
		const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
		const click = async (selector) => {
			document.querySelector(selector).click();
			await nextTurn();
		};
		const command = async (id) => {
			await nextTurn();
			const item = menu.items.find((item) => item.id === id);
			assert.ok(item, `Missing menu command ${id}`);
			if (item.enabled) item.action();
			await Promise.race([application.idle(), nextTurn()]);
		};
		const dialogClick = async (text) => {
			[...document.querySelectorAll("dialog button")]
				.find((b) => b.textContent === text)
				.click();
			await nextTurn();
		};
		// Equal display paths can belong to different selected directories.
		const baselineSelection = selectedDocument;
		const baselineTabCount = openTabs().length;
		selectedDocument = { ...A, id: 100, binding: "old-parent:a.pfdsl" };
		await command("open-file");
		const oldBinding = activeTab();
		oldBinding.setSource("keep old edits");
		selectedDocument = {
			...A,
			id: 101,
			binding: "new-parent:a.pfdsl",
			identity: "new-inode",
			source: "new folder content",
		};
		await command("open-file");
		const newBinding = activeTab();
		assert.notEqual(newBinding, oldBinding);
		assert.equal(newBinding.getSource(), "new folder content");
		assert.equal(oldBinding.getSource(), "keep old edits");
		for (let id = 102; id < 112; id++) {
			selectedDocument = { ...selectedDocument, id };
			await command("open-file");
			assert.equal(activeTab(), newBinding);
			assert.equal(openTabs().length, baselineTabCount + 2);
			assert.ok(
				calls.some(
					(call) =>
						call.command === "release_document" && call.args.id === id - 1,
				),
			);
		}
		// A canceled Save As releases the newly selected target immediately.
		saveTarget = { ...B, id: 112, source: "existing target" };
		await command("save-as");
		await dialogClick("Keep Editing");
		assert.ok(
			calls.some(
				(call) => call.command === "release_document" && call.args.id === 112,
			),
		);
		// A target already open in another tab is also released after rejection.
		saveTarget = { ...A, id: 113, binding: "old-parent:a.pfdsl" };
		await command("save-as");
		assert.ok(
			calls.some(
				(call) => call.command === "release_document" && call.args.id === 113,
			),
		);
		for (const document of [oldBinding, newBinding]) {
			decisions = ["discard"];
			document.button.parentElement.querySelector(".close-document").click();
			await nextTurn();
		}
		for (const id of [100, 111])
			assert.ok(
				calls.some(
					(call) => call.command === "release_document" && call.args.id === id,
				),
			);
		assert.equal(openTabs().length, baselineTabCount);
		selectedDocument = baselineSelection;
		saveTarget = B;
		await command("open-file");
		const entry = activeTab();
		entry.setSource("local");
		await command("save-as");
		await dialogClick("Replace Observed Version");
		// The panel names the target its buttons act on.
		const recoveryPath = () =>
			/Recovery target: (.*)\.$/.exec(
				document.querySelector("#conflicts p")?.textContent ?? "",
			)?.[1];
		const results = {
			beforePoll: {
				disk: entry.location,
				recovery: recoveryPath(),
			},
		};
		poll();
		await nextTurn();
		results.afterPoll = {
			disk: entry.location,
			recovery: recoveryPath(),
		};
		// Exercise the real host recovery DOM for a reply lost after a clean Save As.
		selectedDocument = {
			...A,
			id: 23,
			path: "/uncertain/a.pfdsl",
			identity: "uncertainA",
			binding: "uncertain:a.pfdsl",
		};
		saveTarget = {
			...B,
			id: 24,
			path: "/uncertain/b.pfdsl",
			identity: "uncertainB",
			binding: "uncertain:b.pfdsl",
		};
		saveReply = new Error("native reply lost");
		await command("open-file");
		const uncertain = activeTab();
		await command("save-as");
		await dialogClick("Replace Observed Version");
		assert.equal(isDirty(uncertain), true);
		assert.equal(uncertain.location, selectedDocument.path);

		assert.equal(uncertain.getSource(), A.source);
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
		uncertain.button.parentElement.querySelector(".close-document").click();
		await nextTurn();
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
			await command("open-file");
			const nativeFailure = activeTab();
			nativeFailure.setSource(packet.buffer);
			await command("save-as");
			await dialogClick("Replace Observed Version");
			assert.match(
				document.querySelector("#conflicts").textContent,
				/Content was published/,
			);
			// Revision bookkeeping belongs to the DocumentSession unit contract.
			// The host must retain the original location and dependency-read capability.
			assert.equal(nativeFailure.location, packet.baseline.path);
			await nativeFailure.read(packet.baseline.path);
			assert.equal(calls.at(-1).command, "read_dependency");
			assert.equal(calls.at(-1).args.id, packet.baseline.id);
			assert.equal(nativeFailure.getSource(), packet.buffer);
			assert.equal(isDirty(nativeFailure), true);

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
			nativeFailure.button.parentElement
				.querySelector(".close-document")
				.click();
			await nextTurn();
		}
		saveReply = null;
		saveTarget = B;
		decisions = [];

		// Open B independently while A still owns a failed Save As recovery.
		selectedDocument = published;
		await command("open-file");
		const other = activeTab();
		assert.notEqual(other, entry);
		other.setSource("unsaved B buffer");
		entry.button.click();
		await click("#conflicts button:nth-of-type(3)");
		if (document.querySelector("dialog")) await dialogClick("Use Disk Version");
		assert.equal(
			entry.location,
			A.path,
			"a target already open elsewhere must not be adopted",
		);
		assert.equal(entry.getSource(), "local");
		assert.equal(other.getSource(), "unsaved B buffer");
		// Finish this separate tab explicitly so later recovery can adopt B.
		other.setSource(published.source);
		other.button.parentElement.querySelector(".close-document").click();
		await nextTurn();
		entry.button.click();
		// Recreate B's pending recovery; choose its disk version before an A poll.
		await command("save-as");
		await dialogClick("Replace Observed Version");
		let release;
		pendingInspect = new Promise((resolve) => (release = resolve));
		await click("#conflicts button:nth-of-type(3)");
		await dialogClick("Use Disk Version");
		entry.setSource("typed after confirmation");
		release(published);
		await nextTurn();
		pendingInspect = null;
		results.afterUseDisk = {
			source: entry.getSource(),
			disk: entry.location,
			name: tabName(entry),
			entryPath: entry.button.title,
		};
		await click("#conflicts button:nth-of-type(3)");
		await dialogClick("Use Disk Version");
		results.afterStableUseDisk = {
			source: entry.getSource(),
			disk: entry.location,
			name: tabName(entry),
			entryPath: entry.button.title,
		};
		if (entry.read) {
			await entry.read("/B/preset.yaml");
			results.dependencyCall = calls.at(-1);
		}
		assert.equal(results.beforePoll.disk, A.path);
		assert.equal(results.beforePoll.recovery, B.path);
		assert.equal(results.afterPoll.recovery, B.path);
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
		assert.equal(results.afterStableUseDisk.name, "b.pfdsl");
		assert.equal(results.afterStableUseDisk.entryPath, B.path);
		assert.equal(results.dependencyCall.args.id, 2);
		const beforeRenameCount = openTabs().length;
		entry.setSource("unsaved after rename");
		selectedDocument = {
			...published,
			id: 3,
			path: "/C/renamed.pfdsl",
			binding: "directoryC:renamed.pfdsl",
		};
		pendingInspect = Promise.resolve({
			...published,
			source: null,
			revision: null,
			identity: null,
		});
		await command("open-file");
		pendingInspect = null;
		assert.equal(activeTab(), entry);
		assert.equal(openTabs().length, beforeRenameCount);
		assert.equal(entry.location, selectedDocument.path);
		assert.ok(
			calls.some(
				(call) => call.command === "release_document" && call.args.id === B.id,
			),
		);
		assert.equal(entry.button.title, selectedDocument.path);
		assert.equal(tabName(entry), "renamed.pfdsl");
		assert.equal(entry.getSource(), "unsaved after rename");
		assert.equal(isDirty(entry), true);
		await entry.read("/C/preset.yaml");
		assert.equal(calls.at(-1).args.id, 3);
		await application.idle();
		assert.equal(
			typeof quitListener,
			"function",
			"normal native Quit must enter the document transaction",
		);
		await command("new");
		const unsaved = activeTab();
		unsaved.setSource("unique untitled buffer");
		const all = openTabs();
		decisions = ["discard", "cancel"];
		quitListener({ payload: "1" });
		quitListener({ payload: "1" });
		await nextTurn();
		assert.deepEqual(openTabs(), all);
		assert.equal(entry.getSource(), "unsaved after rename");
		assert.equal(unsaved.getSource(), "unique untitled buffer");
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
		await nextTurn();
		assert.deepEqual(
			openTabs(),
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
			binding: "separate:target.pfdsl",
		};
		await command("save-as");
		assert.equal(
			await application.command("new"),
			false,
			"a foreground operation rejects a second command",
		);
		let releaseExitAck;
		pendingExitAck = new Promise((resolve) => {
			releaseExitAck = resolve;
		});
		quitListener({ payload: "2" });
		await nextTurn();
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "2",
			).args.approved,
			false,
		);
		await dialogClick("Keep Editing");
		await application.idle();
		const promptsAfterBusy = calls.filter(
			(c) => c.command === "confirm_close_document",
		).length;
		decisions = ["discard", "discard"];
		quitListener({ payload: "2" });
		await nextTurn();
		assert.deepEqual(
			openTabs(),
			all,
			"a delayed duplicate of a busy-rejected Quit must retain all buffers",
		);
		assert.equal(
			calls.filter((c) => c.command === "confirm_close_document").length,
			promptsAfterBusy,
		);
		releaseExitAck();
		pendingExitAck = null;
		await nextTurn();
		quitListener({ payload: "2" });
		await nextTurn();
		assert.deepEqual(openTabs(), all);
		assert.equal(
			calls.filter((c) => c.command === "confirm_close_document").length,
			promptsAfterBusy,
		);
		decisions = ["discard", "save"];
		saveTarget = null;
		quitListener({ payload: "3" });
		await nextTurn();
		assert.deepEqual(
			openTabs(),
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
		await nextTurn();
		selectedDocument = {
			...B,
			id: 11,
			path: "/late/d.pfdsl",
			identity: "inodeD",
			binding: "late:d.pfdsl",
			source: "late disk",
			revision: "d0",
		};
		releaseAcceptance({ path: selectedDocument.path });
		await nextTurn();
		const late = activeTab();
		assert.notEqual(late, unsaved);
		late.setSource("unique late editor");
		pendingClose = null;
		decisions = ["discard"];
		releaseClose("discard");
		await nextTurn();
		assert.equal(
			openTabs().length,
			all.length + 1,
			"a document added during Quit must abort before disposing earlier documents",
		);
		for (const original of all)
			assert.equal(openTabs().includes(original), true);
		assert.equal(late.getSource(), "unique late editor");
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "4",
			).args.approved,
			false,
		);
		decisions = ["discard", "discard", "discard"];
		quitListener({ payload: "5" });
		await nextTurn();
		assert.equal(openTabs().length, 0);
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "5",
			).args.approved,
			true,
		);
		// Two live hard-link names must keep separate tabs and normal-save targets.
		selectedDocument = A;
		inspectSnapshots.set(A.id, A);
		await command("open-file");
		const originalLink = activeTab();
		originalLink.setSource("edit original leaf");
		const alias = {
			...A,
			id: 31,
			path: "/A/alias.pfdsl",
			binding: "directoryA:alias.pfdsl",
		};
		inspectSnapshots.set(alias.id, alias);
		selectedDocument = alias;
		await command("open-file");
		assert.equal(openTabs().length, 2);
		assert.notEqual(activeTab(), originalLink);
		await originalLink.read("/A/preset.yaml");
		assert.equal(calls.at(-1).args.id, A.id);
		assert.equal(originalLink.button.title, A.path);
		originalLink.button.click();
		saveReply = {
			outcome: "saved",
			current: { ...A, source: "edit original leaf", revision: "a1" },
		};
		// Save inspects the target first, so the disk keeps its old state until the save runs.
		await command("save");
		inspectSnapshots.set(A.id, saveReply.current);
		assert.equal(
			calls.filter((c) => c.command === "save_document").at(-1).args.id,
			A.id,
		);
		assert.equal(isDirty(originalLink), false);
		quitListener({ payload: "6" });
		await nextTurn();
		assert.equal(openTabs().length, 0);
		inspectSnapshots.clear();
		saveReply = null;
		// Closing must observe changes made after the last poll, even while busy.
		for (const scenario of ["deleted tab", "moved quit", "unreadable tab"]) {
			selectedDocument = { ...A, id: 20, identity: `inode:${scenario}` };
			await command("open-file");
			const clean = activeTab();
			assert.equal(isDirty(clean), false);
			const start = calls.length;
			if (scenario === "unreadable tab")
				inspectFailure = new Error("disk cannot be inspected");
			else
				pendingInspect = Promise.resolve({
					...selectedDocument,
					source: null,
					revision: null,
					identity: null,
				});
			decisions = ["cancel"];
			if (scenario === "moved quit") quitListener({ payload: "7" });
			else clean.button.parentElement.querySelector(".close-document").click();
			await nextTurn();
			const closingCalls = calls.slice(start);
			assert.ok(closingCalls.some((c) => c.command === "inspect_document"));
			assert.ok(
				closingCalls.some((c) => c.command === "confirm_close_document"),
			);
			assert.equal(isDirty(clean), true);
			assert.equal(openTabs().includes(clean), true);
			assert.equal(clean.getSource(), A.source);
			if (scenario === "moved quit")
				assert.equal(
					closingCalls.find((c) => c.command === "finish_app_exit").args
						.approved,
					false,
				);
			pendingInspect = null;
			inspectFailure = null;
			decisions = ["discard"];
			clean.button.parentElement.querySelector(".close-document").click();
			await nextTurn();
			assert.equal(openTabs().length, 0);
		}
		selectedDocument = { ...A, id: 21, identity: "inode:delayed close" };
		await command("open-file");
		const delayed = activeTab();
		let releasePoll;
		pendingInspect = new Promise((resolve) => {
			releasePoll = resolve;
		});
		const start = calls.length;
		poll();
		await nextTurn();
		delayed.button.parentElement.querySelector(".close-document").click();
		await nextTurn();
		assert.equal(openTabs().includes(delayed), true);
		assert.equal(
			calls.slice(start).filter((c) => c.command === "inspect_document").length,
			1,
		);
		let releaseFresh;
		pendingInspect = new Promise((resolve) => {
			releaseFresh = resolve;
		});
		releasePoll(selectedDocument);
		await nextTurn();
		assert.equal(
			calls.slice(start).filter((c) => c.command === "inspect_document").length,
			2,
		);
		assert.equal(openTabs().includes(delayed), true);
		assert.equal(
			calls.slice(start).some((c) => c.command === "confirm_close_document"),
			false,
		);
		decisions = ["cancel"];
		releaseFresh({
			...selectedDocument,
			source: null,
			revision: null,
			identity: null,
		});
		await nextTurn();
		assert.equal(openTabs().includes(delayed), true);
		assert.equal(isDirty(delayed), true);
		assert.equal(delayed.getSource(), A.source);
		pendingInspect = null;
		decisions = ["discard"];
		delayed.button.parentElement.querySelector(".close-document").click();
		await nextTurn();
		assert.equal(openTabs().length, 0);
		// A changes while B's confirmation is pending: the entire native quit is refused.
		selectedDocument = A;
		inspectSnapshots.set(A.id, A);
		await command("open-file");
		const early = activeTab();
		selectedDocument = B;
		inspectSnapshots.set(B.id, B);
		await command("open-file");
		const later = activeTab();
		later.setSource("dirty B during quit");
		let releaseLater;
		pendingClose = new Promise((resolve) => {
			releaseLater = resolve;
		});
		quitListener({ payload: "21" });
		await nextTurn();
		assert.equal(
			await application.command("new"),
			false,
			"a foreground operation rejects a second command",
		);
		inspectSnapshots.set(A.id, {
			...A,
			source: null,
			revision: null,
			identity: null,
		});
		releaseLater("discard");
		pendingClose = null;
		await nextTurn();
		assert.equal(openTabs().includes(early), true);
		assert.equal(openTabs().includes(later), true);
		assert.equal(early.getSource(), A.source);
		assert.equal(isDirty(early), true);
		assert.equal(later.getSource(), "dirty B during quit");
		assert.equal(
			calls.find(
				(c) => c.command === "finish_app_exit" && c.args.request === "21",
			).args.approved,
			false,
		);
	} finally {
		application?.dispose();
		dom?.window.close();
		rmSync(temp, { recursive: true, force: true });
	}
});

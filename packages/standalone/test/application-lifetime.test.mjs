import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, bundleHost, JSDOM, root } from "./helpers/host-bundle.mjs";
import { createHarness, FakeNative } from "./helpers/lifecycle-harness.mjs";

const temp = mkdtempSync(
	join(root, "packages/standalone/node_modules/.application-lifetime-"),
);
after(() => rmSync(temp, { recursive: true, force: true }));
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const flush = async () => {
	for (let i = 0; i < 100; i++) await Promise.resolve();
};

test("application import is inert and simultaneous instances own their commands and disposal", async () => {
	const output = join(temp, "application.mjs");
	await build({
		entryPoints: [join(root, "packages/standalone/src/application.ts")],
		outfile: output,
		bundle: true,
		platform: "node",
		format: "esm",
	});
	const { mountApplication } = await import(pathToFileURL(output).href);
	const hosts = [];
	const mount = () => {
		const dom = new JSDOM(
			readFileSync(join(root, "packages/standalone/index.html"), "utf8"),
		);
		const calls = [],
			tabs = [],
			intervals = new Map();
		const selection = deferred(),
			registration = deferred(),
			capability = deferred(),
			acceptance = deferred(),
			menu = deferred(),
			recent = deferred();
		let listener,
			unlistened = 0,
			menuDisposed = 0;
		const app = mountApplication({
			document: dom.window.document,
			scheduler: {
				setInterval(fn) {
					intervals.set(1, fn);
					return 1;
				},
				clearInterval(id) {
					intervals.delete(id);
				},
			},
			createTextComparison() {
				return { dispose() {} };
			},
			createDocumentTab(options) {
				const document = options.parent.ownerDocument;
				const container = document.createElement("div"),
					button = document.createElement("button");
				options.parent.append(container);
				const tab = {
					container,
					button,
					activate() {},
					deactivate() {},
					focus() {},
					canDiagram: () => false,
					canCreateDefinition: () => false,
					getSource: () => options.source,
					getRevision: () => 0,
					report: options.reportStatus,
					markSaved() {},
					setLocation() {},
					dispose() {
						container.remove();
						button.remove();
					},
				};
				tabs.push(tab);
				return tab;
			},
			native: {
				invoke: async (command, args) => {
					calls.push([command, args]);
					if (command === "document_capabilities") return capability.promise;
					if (command === "list_recent") return recent.promise;
					if (command === "select_document") return selection.promise;
				},
				listen: (_, callback) => {
					listener = callback;
					return registration.promise;
				},
				installMenu: () => menu.promise,
				verifyCorpus: () => acceptance.promise,
				setTitle: async () => {},
				closeWindow: async () => {},
			},
		});
		const host = {
			app,
			dom,
			calls,
			tabs,
			intervals,
			selection,
			registration,
			capability,
			acceptance,
			menu,
			recent,
			event: (request) => listener({ payload: request }),
			register: () =>
				registration.resolve(() => {
					unlistened++;
				}),
			finishMenu: () =>
				menu.resolve({
					update() {
						assert.fail("late menu update");
					},
					recent() {
						assert.fail("late recent update");
					},
					dispose() {
						menuDisposed++;
					},
				}),
			unlistened: () => unlistened,
			menuDisposed: () => menuDisposed,
		};
		hosts.push(host);
		return host;
	};
	const first = mount(),
		second = mount();
	try {
		await second.app.command("new");
		assert.equal(first.tabs.length, 0);
		assert.equal(second.tabs.length, 1);
		const opening = first.app.command("open-file");
		assert.equal(
			await first.app.command("new"),
			false,
			"busy commands are rejected instead of queued",
		);
		await second.app.command("new");
		assert.equal(second.tabs.length, 2);
		second.tabs[1].report("An earlier action completed.");
		const secondOpening = second.app.command("open-file");
		const dismiss = second.dom.window.document.querySelector("#dismiss-status");
		assert.equal(dismiss.hidden, false);
		assert.equal(dismiss.disabled, false);
		dismiss.click();
		let settled = false;
		const idle = second.app.idle().then(() => {
			settled = true;
		});
		await new Promise(setImmediate);
		assert.equal(
			settled,
			false,
			"a refused UI command cannot replace the accepted operation being awaited",
		);
		second.selection.resolve(null);
		await secondOpening;
		await idle;
		assert.equal(settled, true);
		first.app.dispose();
		first.app.dispose();
		first.register();
		first.finishMenu();
		first.capability.resolve({ save: true, reason: null });
		first.recent.resolve([]);
		first.acceptance.resolve({ path: "/late.pfdsl" });
		first.selection.resolve({
			id: 7,
			path: "/selected.pfdsl",
			source: "a -> b",
			revision: "1",
			binding: "7",
			identity: "7",
		});
		await opening;
		await flush();
		assert.equal(first.tabs.length, 0);
		assert.equal(first.intervals.size, 0);
		assert.equal(first.unlistened(), 1);
		assert.equal(first.menuDisposed(), 1);
		assert.ok(
			first.calls.some(
				([command, args]) => command === "release_document" && args.id === 7,
			),
		);
		assert.ok(
			!first.calls.some(([command]) =>
				[
					"exit_listener_ready",
					"open_document",
					"save_document",
					"finish_app_exit",
				].includes(command),
			),
		);
		const before = first.calls.length;
		first.event("1");
		first.dom.window.dispatchEvent(new first.dom.window.Event("focus"));
		first.dom.window.document.dispatchEvent(
			new first.dom.window.KeyboardEvent("keydown", {
				key: "s",
				metaKey: true,
			}),
		);
		first.dom.window.document.querySelector("[data-start=new]").click();
		assert.equal(await first.app.command("new"), false);
		await flush();
		assert.equal(first.calls.length, before);
		assert.equal(second.tabs.length, 2);
		assert.equal(second.intervals.size, 1);
	} finally {
		for (const host of hosts) {
			host.selection.resolve(null);
			host.app.dispose();
			host.dom.window.close();
		}
	}
});

test("simultaneous lifecycle harnesses isolate native files, polls, shortcuts and quit IDs", async () => {
	const { startHost } = await createHarness("simultaneous-hosts");
	const firstNative = new FakeNative(),
		secondNative = new FakeNative();
	const firstDoc = firstNative.add(1, "first.pfdsl", "first"),
		secondDoc = secondNative.add(1, "second.pfdsl", "second");
	const first = await startHost(firstNative, firstDoc, {
		confirm: async () => "discard",
	});
	const second = await startHost(secondNative, secondDoc, {
		confirm: async () => "discard",
	});
	try {
		const firstTab = await first.open(firstDoc),
			secondTab = await second.open(secondDoc);
		firstDoc.file = {
			...firstDoc.file,
			source: "first changed",
			mtime: ++firstNative.clock,
		};
		secondDoc.file = {
			...secondDoc.file,
			source: "second changed",
			mtime: ++secondNative.clock,
		};
		await first.runPoll();
		assert.equal(firstTab.getSource(), "first changed");
		assert.equal(secondTab.getSource(), "second");
		await second.runPoll();
		assert.equal(secondTab.getSource(), "second changed");
		firstTab.type("first edit");
		secondTab.type("second edit");
		await first.cmdS();
		assert.equal(firstDoc.file.source, "first edit");
		assert.equal(secondDoc.file.source, "second changed");
		await first.quit("1");
		assert.equal(first.isOpen(firstTab), false);
		assert.equal(second.isOpen(secondTab), true);
		await second.quit("1");
		assert.equal(second.isOpen(secondTab), false);
		assert.ok(first.log.some((item) => item.kind === "exit" && item.approved));
		assert.ok(second.log.some((item) => item.kind === "exit" && item.approved));
	} finally {
		await first.finish();
		await second.finish();
	}
});

test("disposal cancels an in-flight close decision and releases document handles once", async () => {
	const output = join(temp, "closing.mjs");
	await bundleHost(output);
	const {
		mountApplication,
		createDocumentTab,
		createTextComparison,
		createTestMenu,
	} = await import(pathToFileURL(output).href);
	const dom = new JSDOM(
		readFileSync(join(root, "packages/standalone/index.html"), "utf8"),
	);
	const confirm = deferred(),
		release = deferred();
	const calls = [],
		tabs = [];
	let quit,
		unlistened = 0;
	const snapshot = {
		id: 1,
		path: "/flow.pfdsl",
		source: "first",
		binding: "1",
		revision: "1",
		identity: "1",
	};
	const app = mountApplication({
		document: dom.window.document,
		createTextComparison,
		createDocumentTab(options) {
			const tab = createDocumentTab(options);
			tabs.push(tab);
			return tab;
		},
		scheduler: { setInterval: () => 0, clearInterval() {} },
		native: {
			invoke: async (command, args) => {
				calls.push([command, args]);
				if (command === "document_capabilities")
					return { save: true, reason: null };
				if (command === "list_recent") return [];
				if (command === "select_document" || command === "inspect_document")
					return snapshot;
				if (command === "confirm_close_document") return confirm.promise;
				if (command === "release_document") return release.promise;
			},
			listen: async (_, handler) => {
				quit = handler;
				return () => {
					unlistened++;
				};
			},
			installMenu: async (command, recent) => createTestMenu(command, recent),
			verifyCorpus: async () => null,
			setTitle: async () => {},
			closeWindow: async () => {},
		},
	});
	try {
		await flush();
		await app.command("open-file");
		tabs[0].type("edited");
		quit({ payload: "1" });
		await flush();
		assert.ok(calls.some(([command]) => command === "confirm_close_document"));
		app.dispose();
		confirm.resolve("save");
		await flush();
		assert.equal(unlistened, 1);
		assert.ok(
			!calls.some(([command]) =>
				["save_document", "choose_save_target", "finish_app_exit"].includes(
					command,
				),
			),
		);
		release.resolve();
		await app.idle();
		await flush();
		assert.equal(
			calls.filter(([command]) => command === "release_document").length,
			1,
		);
		assert.equal(
			dom.window.document.querySelectorAll("#tabs button").length,
			0,
		);
	} finally {
		app.dispose();
		dom.window.close();
	}
});

test("browser mounts explain unsupported saving without native dependencies", async () => {
	const output = join(temp, "browser.mjs");
	await bundleHost(output);
	const { mountApplication, createDocumentTab, createTextComparison } =
		await import(pathToFileURL(output).href);
	const dom = new JSDOM(
		readFileSync(join(root, "packages/standalone/index.html"), "utf8"),
	);
	const app = mountApplication({
		document: dom.window.document,
		createDocumentTab,
		createTextComparison,
	});
	try {
		await app.command("new");
		await app.command("save");
		assert.match(
			dom.window.document.querySelector("#save-support").textContent,
			/Use the desktop application to save/,
		);
		assert.match(
			dom.window.document.querySelector("#status").textContent,
			/Use the desktop application to save/,
		);
		assert.equal(
			dom.window.document.querySelectorAll("#tabs [role=tab]").length,
			1,
		);
	} finally {
		app.dispose();
		dom.window.close();
	}
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const vm = require("node:vm");

async function harness() {
	const windows = [];
	const sessions = new Map();
	const handlers = new Map();
	const writes = [];
	const errors = [];
	const menus = [];
	class BrowserWindow extends EventEmitter {
		constructor(options) {
			super();
			this.options = options;
			this.webContents = new EventEmitter();
			this.webContents.mainFrame = { url: "" };
			this.webContents.setWindowOpenHandler = (callback) => {
				this.openHandler = callback;
			};
			this.webContents.send = (...args) => {
				this.sent = args;
			};
			this.webContents.printToPDF = async (options) => {
				this.pdfOptions = options;
				return Buffer.from("%PDF-test");
			};
			windows.push(this);
		}
		async loadFile(file) {
			this.webContents.mainFrame.url = pathToFileURL(file).href;
		}
		async loadURL(url) {
			this.url = url;
		}
		destroy() {
			this.destroyed = true;
		}
	}
	const app = new EventEmitter();
	app.whenReady = () => Promise.resolve();
	app.exit = (code) => errors.push(code);
	app.quit = () => {};
	const ipcMain = new EventEmitter();
	ipcMain.handle = (name, handler) => handlers.set(name, handler);
	const session = {
		fromPartition(name) {
			if (!sessions.has(name)) {
				const value = new EventEmitter();
				value.setPermissionRequestHandler = (callback) => {
					value.permissionRequest = callback;
				};
				value.setPermissionCheckHandler = (callback) => {
					value.permissionCheck = callback;
				};
				value.webRequest = {
					onBeforeRequest: (callback) => {
						value.beforeRequest = callback;
					},
				};
				sessions.set(name, value);
			}
			return sessions.get(name);
		},
	};
	class Workspace {
		documents() {
			return [{ path: "docs/samples/a.pfdsl", name: "a.pfdsl" }];
		}
		read() {
			return "original";
		}
		writeDocument(...args) {
			writes.push(["document", ...args]);
		}
		exportPath(file) {
			return file;
		}
		writeExport(...args) {
			writes.push(["export", ...args]);
		}
	}
	const main = path.join(__dirname, "main.cjs");
	const realRequire = createRequire(main);
	vm.runInNewContext(
		fs.readFileSync(main, "utf8"),
		{
			require(name) {
				if (name === "electron")
					return {
						app,
						BrowserWindow,
						ipcMain,
						session,
						Menu: { setApplicationMenu: (menu) => menus.push(menu) },
					};
				if (name === "./workspace.cjs") return { Workspace };
				return realRequire(name);
			},
			__dirname,
			process: { env: { PFDSL_SPIKE_WORKSPACE: "/copied/corpus" } },
			console: { error: (error) => errors.push(error) },
		},
		{ filename: main },
	);
	await new Promise(setImmediate);
	assert.deepEqual(errors, []);
	const mainWindow = windows[0];
	const event = {
		sender: mainWindow.webContents,
		senderFrame: mainWindow.webContents.mainFrame,
	};
	return {
		windows,
		sessions,
		handlers,
		writes,
		ipcMain,
		event,
		menus,
		invoke: (command, args) =>
			handlers.get("pfdsl:invoke")(event, command, args),
	};
}

test("main-process IPC wires corpus read/write contracts and denies unknown commands", async () => {
	const { windows, invoke, writes, handlers, event, menus } = await harness();
	const main = windows[0];
	assert.equal(main.options.width, 1280);
	assert.equal(main.options.height, 768);
	assert.equal(main.options.useContentSize, true);
	assert.equal(main.options.title, "PFDSL Prototype Electron");
	assert.equal(main.options.webPreferences.contextIsolation, true);
	assert.equal(main.options.webPreferences.nodeIntegration, false);
	assert.equal(main.options.webPreferences.sandbox, true);
	assert.equal(main.options.webPreferences.devTools, false);
	assert.equal(main.openHandler().action, "deny");
	assert.deepEqual(menus, [null]);
	assert.equal(invoke("list_documents")[0].path, "docs/samples/a.pfdsl");
	assert.equal(
		invoke("read_document", { path: "docs/samples/a.pfdsl" }).text,
		"original",
	);
	invoke("write_document", {
		path: "docs/samples/a.pfdsl",
		text: "edited",
		expectedText: "original",
	});
	assert.deepEqual(writes[0], [
		"document",
		"docs/samples/a.pfdsl",
		"edited",
		"original",
	]);
	assert.throws(() => invoke("exec", { command: "anything" }), /Unsupported/);
	assert.throws(
		() =>
			handlers.get("pfdsl:invoke")(
				{ ...event, senderFrame: {} },
				"list_documents",
			),
		/Unexpected/,
	);
});

test("PDF export uses full-sized isolated scriptless window and scoped bytes", async () => {
	const { windows, invoke, writes, sessions } = await harness();
	await invoke("export_pdf", {
		path: "exports/large.pdf",
		svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語</text></svg>',
		width: 1600,
		height: 2400,
	});
	const printed = windows[1];
	assert.equal(printed.options.show, false);
	assert.equal(printed.options.webPreferences.javascript, false);
	assert.equal(printed.options.webPreferences.preload, undefined);
	assert.equal(printed.options.webPreferences.contextIsolation, true);
	assert.equal(printed.options.webPreferences.nodeIntegration, false);
	assert.equal(printed.options.webPreferences.sandbox, true);
	assert.equal(printed.pdfOptions.pageSize.width, 1600 / 96);
	assert.equal(printed.pdfOptions.pageSize.height, 2400 / 96);
	assert.equal(printed.pdfOptions.preferCSSPageSize, true);
	assert.equal(printed.destroyed, true);
	assert.equal(writes[0][1], "exports/large.pdf");
	assert.equal(writes[0][2].toString(), "%PDF-test");
	const pdfSession = sessions.get("pfdsl-comparison-pdf");
	for (const details of [
		{ resourceType: "image", url: "https://example.com/a.png" },
		{ resourceType: "image", url: "file:///etc/passwd" },
		{ resourceType: "script", url: "data:text/javascript,alert(1)" },
	]) {
		pdfSession.beforeRequest(details, ({ cancel }) =>
			assert.equal(cancel, true),
		);
	}
});

test("close callback holds the main window until the expected renderer allows close", async () => {
	const { windows, ipcMain, event } = await harness();
	ipcMain.emit("pfdsl:close-subscribe", event, true);
	let prevented = false;
	windows[0].emit("close", {
		preventDefault: () => {
			prevented = true;
		},
	});
	assert.equal(prevented, true);
	assert.equal(windows[0].sent[0], "pfdsl:close-requested");
	ipcMain.emit("pfdsl:close-allow", { ...event, senderFrame: {} });
	assert.equal(windows[0].destroyed, undefined);
	ipcMain.emit("pfdsl:close-allow", event);
	assert.equal(windows[0].destroyed, true);
});

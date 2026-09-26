const { app, BrowserWindow, ipcMain, session, Menu } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Workspace } = require("./workspace.cjs");
const { pdfEnvelope, trustedSender, allowedResource } = require("./policy.cjs");

const dist = path.resolve(__dirname, "../dist");
const entry = path.join(dist, "index.html");
const entryURL = pathToFileURL(entry).href;
let mainWindow;
let pdfSession;
let closeSubscribed = false;

function restrictWindow(window) {
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	window.webContents.on("will-frame-navigate", (event) =>
		event.preventDefault(),
	);
	window.webContents.on("will-attach-webview", (event) =>
		event.preventDefault(),
	);
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
}

function restrictSession(target, resourceAllowed) {
	target.setPermissionRequestHandler((_contents, _permission, callback) =>
		callback(false),
	);
	target.setPermissionCheckHandler(() => false);
	target.webRequest.onBeforeRequest((details, callback) =>
		callback({ cancel: !resourceAllowed(details) }),
	);
	target.on("will-download", (event) => event.preventDefault());
}

async function exportPDF(workspace, { path: output, svg, width, height }) {
	if (path.extname(workspace.exportPath(output)) !== ".pdf")
		throw new Error("PDF export requires a .pdf path");
	const html = pdfEnvelope(svg, width, height);
	const documentURL = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
	const printWindow = new BrowserWindow({
		show: false,
		width: Math.ceil(Math.min(width, 10000)),
		height: Math.ceil(Math.min(height, 10000)),
		webPreferences: {
			session: pdfSession,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			javascript: false,
			devTools: false,
		},
	});
	restrictWindow(printWindow);
	try {
		await printWindow.loadURL(documentURL);
		const bytes = await printWindow.webContents.printToPDF({
			printBackground: true,
			displayHeaderFooter: false,
			preferCSSPageSize: true,
			pageSize: { width: width / 96, height: height / 96 },
			margins: { top: 0, right: 0, bottom: 0, left: 0 },
		});
		workspace.writeExport(output, bytes);
	} finally {
		printWindow.destroy();
	}
}

app
	.whenReady()
	.then(async () => {
		Menu.setApplicationMenu(null);
		const root = process.env.PFDSL_SPIKE_WORKSPACE;
		if (!root)
			throw new Error(
				"PFDSL_SPIKE_WORKSPACE must point to the copied prototype corpus",
			);
		const workspace = new Workspace(root);
		const mainSession = session.fromPartition("pfdsl-comparison-main");
		restrictSession(mainSession, (details) =>
			allowedResource(details.url, dist),
		);
		pdfSession = session.fromPartition("pfdsl-comparison-pdf");
		restrictSession(
			pdfSession,
			(details) =>
				details.resourceType === "mainFrame" &&
				details.url.startsWith("data:text/html;charset=utf-8,"),
		);
		mainWindow = new BrowserWindow({
			width: 1280,
			height: 768,
			useContentSize: true,
			title: "PFDSL Prototype Electron",
			webPreferences: {
				session: mainSession,
				preload: path.join(__dirname, "preload.cjs"),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				devTools: false,
			},
		});
		restrictWindow(mainWindow);
		mainWindow.on("page-title-updated", (event) => event.preventDefault());
		mainWindow.on("close", (event) => {
			if (closeSubscribed) {
				event.preventDefault();
				mainWindow.webContents.send("pfdsl:close-requested");
			}
		});
		const trusted = (event) =>
			trustedSender(event, mainWindow.webContents, entryURL);
		ipcMain.handle("pfdsl:invoke", (event, command, args = {}) => {
			if (!trusted(event)) throw new Error("Unexpected prototype IPC sender");
			switch (command) {
				case "list_documents":
					return workspace.documents();
				case "read_document":
					return { path: args.path, text: workspace.read(args.path) };
				case "write_document":
					return workspace.writeDocument(
						args.path,
						args.text,
						args.expectedText,
					);
				case "write_export":
					return workspace.writeExport(args.path, args.bytes);
				case "export_pdf":
					return exportPDF(workspace, args);
				default:
					throw new Error("Unsupported prototype command");
			}
		});
		ipcMain.on("pfdsl:close-subscribe", (event, enabled) => {
			if (trusted(event)) closeSubscribed = enabled === true;
		});
		ipcMain.on("pfdsl:close-allow", (event) => {
			if (trusted(event)) mainWindow.destroy();
		});
		await mainWindow.loadFile(entry);
	})
	.catch((error) => {
		console.error(error);
		app.exit(1);
	});

app.on("window-all-closed", () => app.quit());

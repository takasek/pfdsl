import { analyze, diffGraphs } from "@pfdsl/core";
import type { MessageFromWebview, MessageToWebview } from "@pfdsl/editor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

// Only host callbacks and postMessage are faked. Parsing, DOT generation,
// requireActivePfdslEditor and registerPreview are the production modules.
const host = vi.hoisted(() => {
	const uri = (path: string) => ({
		path,
		fsPath: path,
		scheme: "file",
		toString: () => `file://${path}`,
	});
	const commands = new Map<string, () => unknown>();
	const panels: ReturnType<typeof createPanel>[] = [];
	let textChanged = (_event: { document: vscode.TextDocument }) => {};
	const window = {
		activeTextEditor: undefined as vscode.TextEditor | undefined,
		visibleTextEditors: [] as vscode.TextEditor[],
		createWebviewPanel: () => {
			const panel = createPanel();
			panels.push(panel);
			return panel;
		},
		onDidChangeTextEditorSelection: vi.fn(() => ({ dispose() {} })),
		showInformationMessage: vi.fn(),
	};
	function createPanel() {
		let receive = (_message: MessageFromWebview) => {};
		let disposed = () => {};
		let viewChanged = (_event: { webviewPanel: { active: boolean } }) => {};
		const messages: MessageToWebview[] = [];
		const panel = {
			title: "",
			active: true,
			messages,
			webview: {
				html: "",
				cspSource: "test-source",
				asWebviewUri: (value: unknown) => value,
				postMessage: (message: MessageToWebview) => {
					messages.push(message);
					return Promise.resolve(true);
				},
				onDidReceiveMessage: (callback: typeof receive) => {
					receive = callback;
					return { dispose() {} };
				},
			},
			onDidDispose: (callback: () => void) => {
				disposed = callback;
				return { dispose() {} };
			},
			onDidChangeViewState: (callback: typeof viewChanged) => {
				viewChanged = callback;
				return { dispose() {} };
			},
			reveal: vi.fn(),
			dispose: () => disposed(),
			receive: (message: MessageFromWebview) => receive(message),
			activate: () => viewChanged({ webviewPanel: { active: true } }),
		};
		return panel;
	}
	return {
		uri,
		commands,
		panels,
		window,
		api: {
			window,
			commands: {
				registerCommand: (name: string, callback: () => unknown) => {
					commands.set(name, callback);
					return { dispose() {} };
				},
			},
			workspace: {
				onDidChangeTextDocument: (callback: typeof textChanged) => {
					textChanged = callback;
					return { dispose() {} };
				},
			},
			Uri: {
				joinPath: (base: { path: string }, ...parts: string[]) =>
					uri([base.path, ...parts].join("/")),
			},
			ViewColumn: { Beside: 2 },
			ExtensionMode: { Development: 2 },
		},
		changeDocument: (document: vscode.TextDocument) =>
			textChanged({ document }),
	};
});

vi.mock("vscode", () => host.api);

import { clearAnalyzeCache } from "./analyze.js";
import { registerPreview } from "./preview.js";

const first = diffGraphs(
	analyze("a >> p -> b").graph,
	analyze("a >> p -> c").graph,
);
const latest = diffGraphs(
	analyze("a >> p -> b").graph,
	analyze("a >> p -> d").graph,
);

function document(name: string, source = "a >> p -> b"): vscode.TextDocument {
	return {
		uri: host.uri(`/test/${name}.pfdsl`),
		languageId: "pfdsl",
		version: 1,
		getText: () => source,
	} as unknown as vscode.TextDocument;
}

function setup() {
	const context = {
		extensionUri: host.uri("/extension"),
		extensionMode: 1,
		subscriptions: [],
	} as unknown as vscode.ExtensionContext;
	const preview = registerPreview(context);
	async function open(doc: vscode.TextDocument) {
		host.window.activeTextEditor = {
			document: doc,
			selection: { active: { line: 0, character: 0 } },
		} as vscode.TextEditor;
		await host.commands.get("pfdsl.preview")!();
		return host.panels[host.panels.length - 1]!;
	}
	return { preview, open };
}

beforeEach(() => {
	clearAnalyzeCache();
	host.panels.length = 0;
	host.commands.clear();
	host.window.activeTextEditor = undefined;
});

describe("registered preview notification lifecycle", () => {
	it("delivers the latest queued diff after render and never resends it", async () => {
		const { preview, open } = setup();
		const doc = document("first");
		const panel = await open(doc);
		preview.postDiff(first);
		preview.postDiff(latest);
		host.changeDocument(doc);
		expect(panel.messages).toEqual([]);
		panel.receive({ type: "ready" });
		expect(panel.messages.map((message) => message.type)).toEqual([
			"render",
			"diff",
		]);
		expect(panel.messages[1]).toEqual({ type: "diff", report: latest });
		expect(panel.messages[0]).toMatchObject({
			type: "render",
			focusNodeId: "a",
			dot: expect.stringContaining("digraph"),
		});
		host.changeDocument(doc);
		panel.receive({ type: "ready" });
		expect(panel.messages.map((message) => message.type)).toEqual([
			"render",
			"diff",
			"render",
			"render",
		]);
		expect(panel.messages[2]).not.toHaveProperty("focusNodeId", "a");
	});

	it("delivers a queued clear after an error and only once", async () => {
		const { preview, open } = setup();
		const doc = document("invalid", "a >> p -> b\nc >> q -> b");
		const panel = await open(doc);
		preview.postDiff(first);
		preview.postDiff(null);
		panel.receive({ type: "ready" });
		host.changeDocument(doc);
		expect(panel.messages.map((message) => message.type)).toEqual([
			"error",
			"clearDiff",
			"error",
		]);
		expect(panel.messages[0]).toMatchObject({
			message: expect.stringContaining("V001"),
		});
	});

	it("delivers a diff that replaces a queued clear", async () => {
		const { preview, open } = setup();
		const panel = await open(document("clear-then-diff"));
		preview.postDiff(null);
		preview.postDiff(latest);
		panel.receive({ type: "ready" });
		expect(panel.messages[1]).toEqual({ type: "diff", report: latest });
		expect(panel.messages).toHaveLength(2);
	});

	it("sends immediate updates after ready without redrawing", async () => {
		const { preview, open } = setup();
		const panel = await open(document("ready"));
		panel.receive({ type: "ready" });
		preview.postDiff(first);
		preview.postDiff(null);
		expect(panel.messages.slice(1)).toEqual([
			{ type: "diff", report: first },
			{ type: "clearDiff" },
		]);
	});

	it("keeps pending requests with their panel and routes new ones on activation", async () => {
		const { preview, open } = setup();
		const firstDoc = document("one");
		const one = await open(firstDoc);
		preview.postDiff(first);
		const two = await open(document("two"));
		preview.postDiff(latest);
		one.receive({ type: "ready" });
		two.receive({ type: "ready" });
		expect(one.messages[1]).toEqual({ type: "diff", report: first });
		expect(two.messages[1]).toEqual({ type: "diff", report: latest });
		one.activate();
		expect(preview.getActivePreviewDoc()).toBe(firstDoc);
		preview.postDiff(null);
		expect(one.messages[2]).toEqual({ type: "clearDiff" });
		expect(two.messages).toHaveLength(2);
	});

	it("drops disposed-panel pending work and ignores an old ready callback", async () => {
		const { preview, open } = setup();
		const doc = document("reopened");
		const old = await open(doc);
		preview.postDiff(first);
		old.dispose();
		expect(preview.getActivePreviewDoc()).toBeUndefined();
		preview.postDiff(latest);
		const reopened = await open(doc);
		old.receive({ type: "ready" });
		reopened.receive({ type: "ready" });
		expect(old.messages).toEqual([]);
		expect(reopened.messages.map((message) => message.type)).toEqual([
			"render",
		]);
	});

	it("reuses an existing panel and preserves another panel on disposal", async () => {
		const { preview, open } = setup();
		const doc = document("existing");
		const one = await open(doc);
		one.receive({ type: "ready" });
		await open(doc);
		expect(host.panels).toHaveLength(1);
		expect(one.reveal).toHaveBeenCalledWith(2, true);
		const twoDoc = document("active");
		const two = await open(twoDoc);
		one.dispose();
		expect(preview.getActivePreviewDoc()).toBe(twoDoc);
		preview.postDiff(latest);
		two.receive({ type: "ready" });
		expect(two.messages[1]).toEqual({ type: "diff", report: latest });
	});
});

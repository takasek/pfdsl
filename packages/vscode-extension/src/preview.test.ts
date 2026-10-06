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
	class Position {
		constructor(
			public line: number,
			public character: number,
		) {}
	}
	class Range {
		constructor(
			public start: Position,
			public end: Position,
		) {}
	}
	class WorkspaceEdit {
		replacements: Array<{ uri: unknown; range: Range; text: string }> = [];
		replace(uri: unknown, range: Range, text: string) {
			this.replacements.push({ uri, range, text });
		}
	}
	let textChanged = (_event: { document: vscode.TextDocument }) => {};
	let selectionChanged = (_event: {
		textEditor: vscode.TextEditor;
		selections: readonly vscode.Selection[];
	}) => {};
	const window = {
		activeTextEditor: undefined as vscode.TextEditor | undefined,
		visibleTextEditors: [] as vscode.TextEditor[],
		createWebviewPanel: () => {
			const panel = createPanel();
			panels.push(panel);
			return panel;
		},
		onDidChangeTextEditorSelection: vi.fn(
			(callback: typeof selectionChanged) => {
				selectionChanged = callback;
				return { dispose() {} };
			},
		),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showQuickPick: vi.fn(async (items: unknown[]) => items[0]),
		showTextDocument: vi.fn(async (document: vscode.TextDocument) => ({
			document,
			selection: undefined,
			revealRange: vi.fn(),
		})),
	};
	const openTextDocument = vi.fn(async (value: ReturnType<typeof uri>) => ({
		uri: value,
	}));
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
			Position,
			Range,
			Selection: Range,
			WorkspaceEdit,
			window,
			commands: {
				registerCommand: (name: string, callback: () => unknown) => {
					commands.set(name, callback);
					return { dispose() {} };
				},
			},
			workspace: {
				applyEdit: vi.fn(async (_edit: WorkspaceEdit) => true),
				openTextDocument,
				fs: {
					stat: vi.fn(async () => ({ type: 1 })),
					readFile: vi.fn(),
				},
				onDidChangeTextDocument: (callback: typeof textChanged) => {
					textChanged = callback;
					return { dispose() {} };
				},
			},
			Uri: {
				file: uri,
				parse: (value: string) => ({ toString: () => value }),
				joinPath: (base: { path: string }, ...parts: string[]) =>
					uri([base.path, ...parts].join("/")),
			},
			ViewColumn: { One: 1, Beside: 2 },
			env: { openExternal: vi.fn(async () => true) },
			FileType: { File: 1, Directory: 2 },
			ExtensionMode: { Development: 2 },
		},
		changeDocument: (document: vscode.TextDocument) =>
			textChanged({ document }),
		changeSelection: (
			document: vscode.TextDocument,
			line: number,
			character: number,
			startCharacter = character - 1,
		) =>
			selectionChanged({
				textEditor: { document } as vscode.TextEditor,
				selections: [
					{
						active: { line, character },
						start: { line, character: startCharacter },
						end: { line, character },
						isEmpty: false,
					},
				] as vscode.Selection[],
			}),
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
		getText: (range?: vscode.Range) => {
			if (!range) return source;
			const offset = ({ line, character }: vscode.Position) =>
				source
					.split("\n")
					.slice(0, line)
					.reduce((sum, text) => sum + text.length + 1, 0) + character;
			return source.slice(offset(range.start), offset(range.end));
		},
		positionAt: (offset: number) => {
			const lines = source.slice(0, offset).split("\n");
			return new host.api.Position(lines.length - 1, lines.at(-1)!.length);
		},
	} as unknown as vscode.TextDocument;
}

function setup() {
	const context = {
		extensionUri: host.uri("/extension"),
		extensionMode: 1,
		subscriptions: [],
	} as unknown as vscode.ExtensionContext;
	const preview = registerPreview(context);
	async function open(doc: vscode.TextDocument, viewColumn = 1) {
		host.window.activeTextEditor = {
			document: doc,
			viewColumn,
			selection: { active: { line: 0, character: 0 } },
		} as vscode.TextEditor;
		await host.commands.get("pfdsl.preview")!();
		return host.panels[host.panels.length - 1]!;
	}
	return { preview, open };
}

it.each([
	["foo bar://x", "valid-location.txt"],
	["valid-location.txt", "foo bar://x"],
])("opens the valid preview location when another URI is invalid: %j", async (...locs) => {
	const { open } = setup();
	const panel = await open(
		document(
			"mixed",
			`---\nartifact:\n  b:\n    location: ${JSON.stringify(locs)}\n---\na >> p -> b\n`,
		),
	);
	await panel.receive({ type: "openLocation", nodeId: "b" });
	await vi.waitFor(() =>
		expect(host.api.workspace.openTextDocument).toHaveBeenCalledWith(
			expect.objectContaining({ fsPath: "/test/valid-location.txt" }),
		),
	);
	expect(host.window.showWarningMessage).toHaveBeenCalledWith(
		expect.stringContaining("foo bar://x"),
	);
});

it("reports all-invalid preview locations without opening anything", async () => {
	const { open } = setup();
	const panel = await open(
		document(
			"invalid",
			'---\nartifact:\n  b:\n    location: ["foo bar://x", "bad url://x"]\n---\na >> p -> b\n',
		),
	);
	await panel.receive({ type: "openLocation", nodeId: "b" });
	await vi.waitFor(() =>
		expect(host.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining("foo bar://x"),
		),
	);
	expect(host.api.workspace.openTextDocument).not.toHaveBeenCalled();
	expect(host.window.showQuickPick).not.toHaveBeenCalled();
});

it.each([
	["valid-location.txt"],
	["valid-location.txt", "other.txt"],
	["https://example.com/result", "valid-location.txt"],
])("keeps valid preview location behavior: %j", async (...locs) => {
	const { open } = setup();
	const panel = await open(
		document(
			"valid",
			`---\nartifact:\n  b:\n    location: ${JSON.stringify(locs)}\n---\na >> p -> b\n`,
		),
	);
	await panel.receive({ type: "openLocation", nodeId: "b" });
	await vi.waitFor(() =>
		expect(
			host.api.workspace.openTextDocument.mock.calls.length +
				host.api.env.openExternal.mock.calls.length,
		).toBe(1),
	);
	expect(host.window.showWarningMessage).not.toHaveBeenCalled();
	expect(host.window.showQuickPick.mock.calls.length).toBe(
		locs.length > 1 ? 1 : 0,
	);
});

beforeEach(() => {
	vi.clearAllMocks();
	clearAnalyzeCache();
	host.panels.length = 0;
	host.commands.clear();
	host.window.activeTextEditor = undefined;
	host.api.workspace.applyEdit.mockClear();
	host.api.workspace.fs.readFile.mockReset();
	host.api.workspace.openTextDocument
		.mockReset()
		.mockImplementation(async (value) => ({ uri: value }));
	host.window.visibleTextEditors = [];
});

it("focuses a selected semantic definition key and ignores an identically named field", async () => {
	const { open } = setup();
	const doc = document(
		"semantic-focus",
		"---\nartifact:\n  a: {label: A, status: todo}\n  status: {label: State}\n---\na >> p -> status\n",
	);
	const panel = await open(doc);
	panel.receive({ type: "ready" });
	host.changeSelection(doc, 2, 3);
	expect(panel.messages.at(-1)).toEqual({ type: "focus", nodeId: "a" });
	host.changeSelection(doc, 2, 22);
	expect(panel.messages.at(-1)).toEqual({ type: "clearFocus" });
	host.changeSelection(doc, 5, 16, 0);
	expect(panel.messages.at(-1)).toEqual({ type: "clearFocus" });
});

it("focuses a quoted authored definition key selected with its quotes", async () => {
	const { open } = setup();
	const doc = document(
		"quoted-focus",
		'---\nartifact:\n  "my input": {label: Input}\n---\n"my input" >> p -> b\n',
	);
	const panel = await open(doc);
	panel.receive({ type: "ready" });
	host.changeSelection(doc, 2, 12, 2);
	expect(panel.messages.at(-1)).toEqual({ type: "focus", nodeId: "my input" });
});

it("applies source-bound node creation as one WorkspaceEdit and rejects a stale or disposed request", async () => {
	const { open } = setup();
	const source = "a >> p -> b\n";
	const doc = document("editing", source);
	const panel = await open(doc);
	panel.receive({ type: "ready" });
	await panel.receive({ type: "createDefinition", nodeId: "b", source });
	expect(host.api.workspace.applyEdit).toHaveBeenCalledTimes(1);
	const edit = host.api.workspace.applyEdit.mock.calls[0]![0];
	expect(edit.replacements).toHaveLength(1);
	expect(edit.replacements[0]!.text).toContain("label: b");
	expect(edit.replacements[0]!.range.start).toEqual(
		new host.api.Position(0, 0),
	);
	expect(edit.replacements[0]!.range.end).toEqual(new host.api.Position(0, 0));
	expect(edit.replacements[0]!.text).not.toContain("a >> p");
	await panel.receive({
		type: "addConnector",
		nodeId: "a",
		source: "older",
		connector: ">>",
		otherId: "q",
	});
	expect(host.api.workspace.applyEdit).toHaveBeenCalledTimes(1);
	panel.dispose();
	await panel.receive({
		type: "addConnector",
		nodeId: "a",
		source,
		connector: ">>",
		otherId: "q",
	});
	expect(host.api.workspace.applyEdit).toHaveBeenCalledTimes(1);
});

it("reveals a local preview connection while preserving preview focus and source selection", async () => {
	const { open } = setup();
	let source = "first >> task -> old\na >> p -> b\nlast >> finish -> end\n";
	const original = source;
	const doc = document("connection-edit", source);
	vi.spyOn(doc, "getText").mockImplementation(() => source);
	host.api.workspace.applyEdit.mockImplementationOnce(async (edit) => {
		const replacement = edit.replacements[0]!;
		const offset = (pos: { line: number; character: number }) =>
			original
				.split("\n")
				.slice(0, pos.line)
				.reduce((n, line) => n + line.length + 1, 0) + pos.character;
		source =
			original.slice(0, offset(replacement.range.start)) +
			replacement.text +
			original.slice(offset(replacement.range.end));
		return true;
	});
	const panel = await open(doc);
	await panel.receive({
		type: "addConnector",
		nodeId: "p",
		source,
		connector: "->",
		otherId: "new_result",
	});
	const replacement =
		host.api.workspace.applyEdit.mock.calls[0]![0].replacements[0]!;
	expect(replacement.range.start.line).toBe(2);
	expect(replacement.range.end.line).toBe(2);
	expect(replacement.text).toBe("p -> new_result\n");
	expect(source).toBe(
		"first >> task -> old\na >> p -> b\np -> new_result\nlast >> finish -> end\n",
	);
	const editor = await host.window.showTextDocument.mock.results.at(-1)!.value;
	expect(host.window.showTextDocument).toHaveBeenCalledWith(doc, {
		viewColumn: 1,
		preserveFocus: true,
	});
	expect(editor.selection).toBeUndefined();
	expect(editor.revealRange).toHaveBeenCalledWith(
		new host.api.Range(
			new host.api.Position(2, "p -> new_result".length),
			new host.api.Position(2, "p -> new_result".length),
		),
	);
	expect(host.window.showInformationMessage).not.toHaveBeenCalled();
});

it("refreshes a preview edit from the replacement document after the source is closed", async () => {
	const { preview, open } = setup();
	const source = "a >> p -> b\n";
	const original = document("reopened-source", source);
	const panel = await open(original, 1);
	Object.assign(panel, { viewColumn: 1 });
	panel.receive({ type: "ready" });
	Object.assign(original, { isClosed: true });
	host.api.workspace.openTextDocument.mockResolvedValueOnce(
		document("reopened-source", source),
	);
	const reopened = document("reopened-source", `${source}p -> after_close\n`);
	Object.assign(reopened, { version: 2 });
	host.api.workspace.applyEdit.mockImplementationOnce(async () => {
		host.changeDocument(reopened);
		return true;
	});
	await panel.receive({
		type: "addConnector",
		nodeId: "p",
		source,
		connector: "->",
		otherId: "after_close",
	});
	expect(preview.getActivePreviewDoc()).toBe(reopened);
	expect(panel.messages.at(-1)).toMatchObject({
		type: "render",
		editing: { source: reopened.getText() },
	});
	expect(host.window.showTextDocument).toHaveBeenCalledWith(reopened, {
		viewColumn: host.api.ViewColumn.Beside,
		preserveFocus: true,
	});
	expect(original.getText()).toBe(source);
});

it.each([
	"addConnector",
	"createDefinition",
] as const)("rejects %s from a closed preview when the file changed outside the editor", async (type) => {
	const { preview, open } = setup();
	const source = "a >> p -> b\n";
	const original = document(`external-${type}`, source);
	const panel = await open(original);
	panel.receive({ type: "ready" });
	Object.assign(original, { isClosed: true });
	const diskSource = `external >> rebuild -> result\n${source}`;
	const current = document(`external-${type}`, diskSource);
	host.api.workspace.openTextDocument.mockResolvedValueOnce(current);
	await panel.receive(
		type === "addConnector"
			? { type, nodeId: "p", source, connector: "->", otherId: "new_result" }
			: { type, nodeId: "b", source },
	);
	expect(host.api.workspace.applyEdit).not.toHaveBeenCalled();
	expect(host.api.workspace.openTextDocument).toHaveBeenCalledWith(
		original.uri,
	);
	expect(preview.getActivePreviewDoc()).toBe(current);
	expect(panel.messages.at(-1)).toMatchObject({
		type: "render",
		editing: { source: diskSource },
	});
	expect(host.window.showInformationMessage).toHaveBeenCalledWith(
		"The document changed. Reopen Node actions and try again.",
	);
	expect(host.window.showTextDocument).not.toHaveBeenCalled();
	expect(current.getText()).toBe(diskSource);
});

it.each([
	"unavailable",
	"disposed",
	"closed",
])("does not edit while reopening a source that becomes %s", async (state) => {
	const { open } = setup();
	const source = "a >> p -> b\n";
	const original = document(`reopen-${state}`, source);
	const panel = await open(original);
	panel.receive({ type: "ready" });
	Object.assign(original, { isClosed: true });
	if (state === "unavailable")
		host.api.workspace.openTextDocument.mockRejectedValueOnce(
			new Error("File not found"),
		);
	else if (state === "disposed")
		host.api.workspace.openTextDocument.mockImplementationOnce(async () => {
			panel.dispose();
			return original;
		});
	else host.api.workspace.openTextDocument.mockResolvedValueOnce(original);
	await panel.receive({
		type: "addConnector",
		nodeId: "p",
		source,
		connector: "->",
		otherId: "new_result",
	});
	expect(host.api.workspace.applyEdit).not.toHaveBeenCalled();
	expect(host.window.showTextDocument).not.toHaveBeenCalled();
	expect(panel.messages).toHaveLength(1);
	if (state !== "disposed")
		expect(host.window.showInformationMessage).toHaveBeenCalledWith(
			"The source document could not be reopened.",
		);
	else expect(host.window.showInformationMessage).not.toHaveBeenCalled();
});

it.each([
	"utf8",
	"utf8bom",
	"utf16le",
	"utf16be",
])("rejects an external file change while a hidden clean %s document is retained", async (encoding) => {
	const { open } = setup();
	const source = "a >> p -> b\n";
	const doc = document(`retained-${encoding}`, source);
	const panel = await open(doc);
	Object.assign(doc, { isDirty: false, isClosed: false, encoding });
	host.window.activeTextEditor = undefined;
	const diskSource = `external >> rebuild -> result\n${source}`;
	const bytes = Buffer.from(
		diskSource,
		encoding.startsWith("utf16") ? "utf16le" : "utf8",
	);
	if (encoding === "utf16be") bytes.swap16();
	host.api.workspace.fs.readFile.mockResolvedValueOnce(bytes);
	await panel.receive({
		type: "addConnector",
		nodeId: "p",
		source,
		connector: "->",
		otherId: "new_result",
	});
	expect(host.api.workspace.applyEdit).not.toHaveBeenCalled();
	expect(host.window.showInformationMessage).toHaveBeenCalledWith(
		"The file changed outside VS Code. Reload the source file before editing from the preview.",
	);
	expect(host.api.workspace.fs.readFile).toHaveBeenCalledWith(doc.uri);
});

it.each([
	"clean",
	"dirty",
	"bom",
	"unknown-encoding",
])("keeps hidden source editing when the buffer is %s", async (state) => {
	const { open } = setup();
	const source = "a >> p -> b\n";
	const doc = document(`hidden-${state}`, source);
	const panel = await open(doc);
	Object.assign(doc, {
		isDirty: state === "dirty",
		isClosed: false,
		encoding: state === "unknown-encoding" ? undefined : "utf8",
	});
	host.api.workspace.fs.readFile.mockResolvedValueOnce(
		Buffer.from(
			`${state === "bom" ? "\ufeff" : ""}${source}`,
			state === "unknown-encoding" ? "utf16le" : "utf8",
		),
	);
	host.api.workspace.applyEdit.mockImplementationOnce(async () => {
		vi.spyOn(doc, "getText").mockReturnValue(`${source}p -> new_result\n`);
		return true;
	});
	await panel.receive({
		type: "addConnector",
		nodeId: "p",
		source,
		connector: "->",
		otherId: "new_result",
	});
	expect(host.api.workspace.applyEdit).toHaveBeenCalledTimes(1);
	expect(host.window.showTextDocument).toHaveBeenCalledWith(doc, {
		viewColumn: 1,
		preserveFocus: true,
	});
	if (state === "dirty" || state === "unknown-encoding")
		expect(host.api.workspace.fs.readFile).not.toHaveBeenCalled();
	else expect(host.api.workspace.fs.readFile).toHaveBeenCalledWith(doc.uri);
});

it("stops a hidden clean preview edit if its file cannot be read", async () => {
	const { open } = setup();
	const source = "a >> p -> b\n";
	const doc = document("unreadable-hidden", source);
	const panel = await open(doc);
	Object.assign(doc, { isDirty: false, encoding: "utf8" });
	host.api.workspace.fs.readFile.mockRejectedValueOnce(
		new Error("File not found"),
	);
	await panel.receive({
		type: "addConnector",
		nodeId: "p",
		source,
		connector: "->",
		otherId: "new_result",
	});
	expect(host.api.workspace.applyEdit).not.toHaveBeenCalled();
	expect(host.window.showInformationMessage).toHaveBeenCalledWith(
		"The source file could not be read.",
	);
});

it.each([
	"closed",
	"moved",
	"group removed",
])("keeps definition creation outside the preview column (source: %s)", async (state) => {
	const { open } = setup();
	const source = "a >> p -> b\n";
	const doc = document("definition-column", source);
	const panel = await open(doc, 3);
	if (state === "moved")
		host.window.visibleTextEditors = [
			{ document: doc, viewColumn: 4 },
		] as vscode.TextEditor[];
	if (state === "group removed") Object.assign(panel, { viewColumn: 3 });
	host.api.workspace.applyEdit.mockImplementationOnce(async (edit) => {
		vi.spyOn(doc, "getText").mockReturnValue(
			edit.replacements[0]!.text + source,
		);
		return true;
	});
	await panel.receive({ type: "createDefinition", nodeId: "b", source });
	expect(host.window.showTextDocument).toHaveBeenCalledWith(
		doc,
		expect.objectContaining({
			viewColumn:
				state === "moved"
					? 4
					: state === "group removed"
						? host.api.ViewColumn.Beside
						: 3,
			preserveFocus: false,
			selection: expect.any(host.api.Range),
		}),
	);
});

describe("registered preview file navigation", () => {
	it("resolves subflow openFile from the parent document and location from basePath", async () => {
		const { open } = setup();
		const doc = document(
			"flows/parent",
			"---\nbasePath: ../\nartifact:\n  b:\n    location: docs/result.md\nprocess:\n  p:\n    subflow: child.pfdsl\n---\na >> p -> b\n",
		);
		host.window.visibleTextEditors = [
			{ document: doc, viewColumn: 1 },
		] as vscode.TextEditor[];
		const panel = await open(doc);
		panel.receive({ type: "openFile", path: "child.pfdsl" });
		await vi.waitFor(() => {
			expect(host.window.showTextDocument).toHaveBeenCalledWith(
				expect.objectContaining({
					uri: expect.objectContaining({ fsPath: "/test/flows/child.pfdsl" }),
				}),
				{ viewColumn: 1 },
			);
		});
		panel.receive({ type: "openLocation", nodeId: "b" });
		await vi.waitFor(() => {
			expect(host.window.showTextDocument).toHaveBeenCalledWith(
				expect.objectContaining({
					uri: expect.objectContaining({ fsPath: "/test/docs/result.md" }),
				}),
				{ viewColumn: 1 },
			);
		});
		expect(host.api.workspace.openTextDocument).toHaveBeenCalledTimes(2);
	});
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

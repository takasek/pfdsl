import { expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
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
	const source =
		'---\nprocess: {"build": {command: make}}\n---\na >> build -> b\n';
	const uri = {
		toString: () => "file:///repo/main.pfdsl",
		scheme: "file",
		fsPath: "/repo/main.pfdsl",
	};
	const doc = { uri, version: 1, getText: () => source };
	const editor = {
		document: doc,
		selection: undefined as Range | undefined,
		revealRange: vi.fn(),
	};
	const commands = new Map<string, (...args: string[]) => unknown>();
	const providers: vscode.HoverProvider[] = [];
	return {
		source,
		editor,
		commands,
		providers,
		api: {
			Position,
			Range,
			Selection: Range,
			MarkdownString: class {
				constructor(public value: string) {}
			},
			Hover: class {
				constructor(
					public contents: unknown,
					public range: Range,
				) {}
			},
			Uri: { parse: () => uri },
			commands: {
				registerCommand: (
					id: string,
					callback: (...args: string[]) => unknown,
				) => {
					commands.set(id, callback);
					return {};
				},
			},
			window: {
				visibleTextEditors: [editor],
				createOutputChannel: () => ({ appendLine() {} }),
				showInformationMessage: vi.fn(),
			},
			workspace: { openTextDocument: async () => doc },
			languages: {
				registerHoverProvider: (
					_language: string,
					provider: vscode.HoverProvider,
				) => {
					providers.push(provider);
					return {};
				},
			},
		},
	};
});

it("hovers a full quoted body ID rather than either bare word", async () => {
	registerHover({ subscriptions: [] } as unknown as vscode.ExtensionContext);
	const source =
		'---\nprocess: {"my process": {label: Build}}\n---\na >> "my process" -> out\n';
	const doc = {
		uri: { toString: () => "file:///repo/quoted.pfdsl" },
		version: 1,
		getText: () => source,
		getWordRangeAtPosition: () => undefined,
	} as unknown as vscode.TextDocument;
	const hover = await host.providers.at(-1)!.provideHover!(
		doc,
		new host.api.Position(3, 12) as vscode.Position,
		{} as vscode.CancellationToken,
	);
	expect(hover).toBeDefined();
	expect(hover?.range?.start.character).toBe(5);
	expect(hover?.range?.end.character).toBe(17);
	expect(JSON.stringify(hover?.contents)).toContain("Build");
});

vi.mock("vscode", () => host.api);

import { registerHover } from "./hover.js";

it("hover navigation selects the complete authored quoted declaration", async () => {
	registerHover({ subscriptions: [] } as unknown as vscode.ExtensionContext);
	host.commands.get("pfdsl._gotoNodeDefinition")!(
		"file:///repo/main.pfdsl",
		"build",
	);
	await Promise.resolve();
	const selected = host.editor.selection!;
	expect(selected).toBeDefined();
	expect(
		host.source
			.split("\n")
			[selected.start.line]?.slice(
				selected.start.character,
				selected.end.character,
			),
	).toBe('"build"');
});

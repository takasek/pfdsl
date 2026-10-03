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
	return {
		source,
		editor,
		commands,
		api: {
			Position,
			Range,
			Selection: Range,
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
				createOutputChannel: () => ({}),
				showInformationMessage: vi.fn(),
			},
			workspace: { openTextDocument: async () => doc },
			languages: { registerHoverProvider: () => ({}) },
		},
	};
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

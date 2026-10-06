import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
	class Selection extends Range {
		get active() {
			return this.end;
		}
	}
	const commands = new Map<string, () => unknown>();
	const window = {
		activeTextEditor: undefined as vscode.TextEditor | undefined,
		showInformationMessage: vi.fn(),
	};
	return {
		commands,
		window,
		api: {
			Position,
			Range,
			Selection,
			window,
			commands: {
				registerCommand: (name: string, callback: () => unknown) => {
					commands.set(name, callback);
					return { dispose() {} };
				},
			},
		},
	};
});

vi.mock("vscode", () => host.api);

import { clearAnalyzeCache } from "./analyze.js";
import { findFrontmatterDefinition, registerDefinitionJump } from "./jump.js";

const source = `---
artifact:
  "status": {}
  other:
    status: done
process:
  p: {}
---
status >> p -> status
status
`;

let documentSequence = 0;

function open(text = source, line = 2, character = 5) {
	let currentText = text;
	let version = 1;
	const uri = `file:///jump-test-${documentSequence++}.pfdsl`;
	const doc = {
		uri: { toString: () => uri },
		languageId: "pfdsl",
		get version() {
			return version;
		},
		getText: () => currentText,
		getWordRangeAtPosition: vi.fn(),
	} as unknown as vscode.TextDocument;
	const pos = new host.api.Position(line, character);
	const editor = {
		document: doc,
		selection: new host.api.Selection(pos, pos),
		revealRange: vi.fn(),
	} as unknown as vscode.TextEditor;
	host.window.activeTextEditor = editor;
	return {
		editor,
		doc,
		edit: (text: string) => {
			currentText = text;
			version++;
		},
		move: (line: number, character: number) => {
			const pos = new host.api.Position(line, character);
			editor.selection = new host.api.Selection(pos, pos) as vscode.Selection;
		},
	};
}

function invoke(command = "pfdsl.cycleNodeOccurrence") {
	expect(host.commands.has(command)).toBe(true);
	host.commands.get(command)!();
}

beforeEach(() => {
	clearAnalyzeCache();
	documentSequence = 0;
	host.commands.clear();
	host.window.activeTextEditor = undefined;
	host.window.showInformationMessage.mockClear();
	registerDefinitionJump({
		subscriptions: [],
	} as unknown as vscode.ExtensionContext);
});

describe("registered node jump commands", () => {
	it("cycles repeated IDs and reveals every selected target", () => {
		const { editor, doc } = open();
		const starts = [];
		for (let i = 0; i < 4; i++) {
			invoke();
			starts.push([
				editor.selection.start.line,
				editor.selection.start.character,
			]);
			expect(editor.revealRange).toHaveBeenLastCalledWith(
				new host.api.Range(editor.selection.start, editor.selection.end),
			);
		}
		expect(starts).toEqual([
			[8, 0],
			[8, 15],
			[9, 0],
			[2, 2],
		]);
		expect(doc.getWordRangeAtPosition).not.toHaveBeenCalled();
	});

	it("uses the edited document after occurrences are added and removed", () => {
		const { editor, edit, move } = open("a >> p -> a\n", 0, 10);
		edit("a >> p -> a\na\n");
		invoke();
		expect(editor.selection.start).toEqual(new host.api.Position(1, 0));
		edit("a >> p -> a\n");
		move(0, 10);
		invoke();
		expect(editor.selection.start).toEqual(new host.api.Position(0, 0));
	});

	it("preserves direct definition jumps and the existing no-definition message", () => {
		const { editor } = open(source, 8, 18);
		invoke("pfdsl.jumpToDefinition");
		expect(editor.selection.start).toEqual(new host.api.Position(2, 2));
		expect(editor.selection.end).toEqual(new host.api.Position(2, 10));
		expect(editor.revealRange).toHaveBeenCalled();
		expect(findFrontmatterDefinition(editor.document, "status")).toEqual(
			new host.api.Position(2, 2),
		);
		expect(host.window.showInformationMessage).not.toHaveBeenCalled();
		const missing = open("missing >> p\n", 0, 2);
		invoke("pfdsl.jumpToDefinition");
		expect(host.window.showInformationMessage).toHaveBeenCalledWith(
			'No frontmatter definition found for "missing"',
		);
		expect(missing.editor.revealRange).not.toHaveBeenCalled();
	});

	it("leaves field names and non-node positions unchanged for both commands", () => {
		for (const [line, character] of [
			[4, 6],
			[4, 13],
			[1, 2],
			[8, 8],
		]) {
			const { editor } = open(source, line!, character!);
			const selection = editor.selection;
			invoke();
			invoke("pfdsl.jumpToDefinition");
			expect(editor.selection).toBe(selection);
			expect(editor.revealRange).not.toHaveBeenCalled();
		}
		expect(host.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("cycles aliased definitions through body only while preserving direct alias targets", () => {
		const text =
			"---\nmetadata: &nodes {a: {}, b: {}}\nartifact: *nodes\n---\na >> p -> b\na\n";
		const { editor, move } = open(text, 4, 0);
		invoke();
		expect(editor.selection.start).toEqual(new host.api.Position(5, 0));
		invoke();
		expect(editor.selection.start).toEqual(new host.api.Position(4, 0));
		invoke("pfdsl.jumpToDefinition");
		expect(editor.selection.start).toEqual(new host.api.Position(2, 10));
		move(2, 12);
		const selection = editor.selection;
		invoke();
		invoke("pfdsl.jumpToDefinition");
		expect(editor.selection).toBe(selection);
	});

	it("ignores absent editors and other languages", () => {
		invoke();
		invoke("pfdsl.jumpToDefinition");
		const { editor, doc } = open();
		Object.assign(doc, { languageId: "plaintext" });
		invoke();
		invoke("pfdsl.jumpToDefinition");
		expect(editor.revealRange).not.toHaveBeenCalled();
	});
});

describe("node jump contributions", () => {
	const manifest = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	);
	it("exposes cycle and direct commands in the editor context menu", () => {
		for (const command of [
			"pfdsl.cycleNodeOccurrence",
			"pfdsl.jumpToDefinition",
		]) {
			expect(manifest.contributes.commands).toContainEqual(
				expect.objectContaining({ command }),
			);
			expect(manifest.contributes.menus["editor/context"]).toContainEqual(
				expect.objectContaining({ command, when: "editorLangId == pfdsl" }),
			);
		}
	});

	it("uses editor-focused chords and releases Alt+F12 to Peek Definition", () => {
		expect(manifest.contributes.keybindings).toContainEqual({
			command: "pfdsl.cycleNodeOccurrence",
			key: "ctrl+k ctrl+alt+n",
			mac: "cmd+k cmd+alt+n",
			when: "editorLangId == pfdsl && editorTextFocus",
		});
		expect(manifest.contributes.keybindings).toContainEqual({
			command: "pfdsl.jumpToDefinition",
			key: "ctrl+k ctrl+alt+d",
			mac: "cmd+k cmd+alt+d",
			when: "editorLangId == pfdsl && editorTextFocus",
		});
		expect(
			manifest.contributes.keybindings.some(
				(binding: { key: string }) => binding.key === "alt+f12",
			),
		).toBe(false);
	});
});

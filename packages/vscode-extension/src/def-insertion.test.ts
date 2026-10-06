import { insertDefinition } from "@pfdsl/core";
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
	class WorkspaceEdit {
		readonly replacements: { uri: unknown; range: Range; text: string }[] = [];
		replace(uri: unknown, range: Range, text: string) {
			this.replacements.push({ uri, range, text });
		}
	}
	class CodeAction {
		edit?: WorkspaceEdit;
		command?: { command: string; title: string; arguments: unknown[] };
		constructor(
			public title: string,
			public kind: string,
		) {}
	}
	let sequence = 0;
	function document(source: string, selectedId: string, languageId = "pfdsl") {
		const uri = { toString: () => `file:///quick-fix-${sequence++}.pfdsl` };
		const uriString = uri.toString();
		uri.toString = () => uriString;
		function offsetAt(position: Position) {
			const lines = source.split("\n");
			return (
				lines
					.slice(0, position.line)
					.reduce((n, line) => n + line.length + 1, 0) + position.character
			);
		}
		const doc = {
			uri,
			languageId,
			version: 1,
			isClosed: false,
			getText: (range?: Range) =>
				range
					? source.slice(offsetAt(range.start), offsetAt(range.end))
					: source,
			getWordRangeAtPosition: () => {
				const start = source.lastIndexOf(selectedId);
				if (start < 0) return undefined;
				const preceding = source.slice(0, start).split("\n");
				const position = new Position(
					preceding.length - 1,
					preceding.at(-1)!.length,
				);
				return new Range(
					position,
					new Position(position.line, position.character + selectedId.length),
				);
			},
			update: (next: string) => {
				source = next;
				doc.version++;
			},
			apply: (edit: WorkspaceEdit) => {
				for (const replacement of edit.replacements) {
					source =
						source.slice(0, offsetAt(replacement.range.start)) +
						replacement.text +
						source.slice(offsetAt(replacement.range.end));
				}
				doc.version++;
			},
		};
		return doc;
	}
	type Document = ReturnType<typeof document>;
	function editor(document: Document) {
		return {
			document,
			viewColumn: 1,
			selection: undefined as Range | undefined,
			revealRange: vi.fn(),
		};
	}
	const textDocuments: Document[] = [];
	const visibleTextEditors: ReturnType<typeof editor>[] = [];
	const commands = new Map<string, (...args: unknown[]) => unknown>();
	const providers: {
		provideCodeActions(
			document: Document,
			range: Range,
		): CodeAction[] | undefined;
	}[] = [];
	const showTextDocument = vi.fn(async (doc: Document) => {
		const existing = visibleTextEditors.find(
			(e) => e.document.uri.toString() === doc.uri.toString(),
		);
		if (existing) return existing;
		const opened = editor(doc);
		visibleTextEditors.push(opened);
		return opened;
	});
	return {
		document,
		editor,
		providers,
		commands,
		textDocuments,
		visibleTextEditors,
		showTextDocument,
		api: {
			Position,
			Range,
			Selection: Range,
			WorkspaceEdit,
			CodeAction,
			CodeActionKind: { QuickFix: "quickfix" },
			commands: {
				registerCommand: (
					name: string,
					callback: (...args: unknown[]) => unknown,
				) => {
					commands.set(name, callback);
					return { dispose: () => commands.delete(name) };
				},
			},
			languages: {
				registerCodeActionsProvider: vi.fn(
					(_language: string, provider: (typeof providers)[number]) => {
						providers.push(provider);
						return {
							dispose: () => providers.splice(providers.indexOf(provider), 1),
						};
					},
				),
			},
			workspace: { textDocuments },
			window: {
				visibleTextEditors,
				showTextDocument,
				showInformationMessage: vi.fn(),
			},
		},
	};
});

vi.mock("vscode", () => host.api);

import { clearAnalyzeCache } from "./analyze.js";
import { registerDefInsertion } from "./def-insertion.js";

beforeEach(() => {
	clearAnalyzeCache();
	host.commands.clear();
	host.providers.length = 0;
	host.textDocuments.length = 0;
	host.visibleTextEditors.length = 0;
	vi.clearAllMocks();
	host.showTextDocument.mockImplementation(async (doc) => {
		const existing = host.visibleTextEditors.find(
			(e) => e.document.uri.toString() === doc.uri.toString(),
		);
		if (existing) return existing;
		const opened = host.editor(doc);
		host.visibleTextEditors.push(opened);
		return opened;
	});
	registerDefInsertion({
		subscriptions: [],
	} as unknown as vscode.ExtensionContext);
});

function prepare(source: string, id: string) {
	const document = host.document(source, id);
	host.textDocuments.push(document);
	const preceding = source.slice(0, source.lastIndexOf(id)).split("\n");
	const position = new host.api.Position(
		preceding.length - 1,
		preceding.at(-1)!.length,
	);
	const action = host.providers[0]!.provideCodeActions(
		document,
		new host.api.Range(position, position),
	)![0]!;
	return { document, action };
}

async function followUp(action: ReturnType<typeof prepare>["action"]) {
	expect(action.command).toBeDefined();
	const command = action.command!;
	expect(host.commands.has(command.command)).toBe(true);
	await host.commands.get(command.command)!(...command.arguments);
}

function selectedText(editor: ReturnType<typeof host.editor>) {
	return editor.selection && editor.document.getText(editor.selection);
}

describe("definition Quick Fix", () => {
	it("resolves the complete quoted ID without a bare-word range", () => {
		const source = 'a >> "my process" -> out\n';
		const doc = host.document(source, "my process");
		vi.spyOn(doc, "getWordRangeAtPosition").mockReturnValue(undefined);
		const pos = new host.api.Position(0, 12);
		const actions = host.providers[0]!.provideCodeActions(
			doc,
			new host.api.Range(pos, pos),
		);
		expect(actions?.[0]?.title).toBe(
			'Insert process definition for "my process"',
		);
	});
	it("retains one frontmatter-only WorkspaceEdit and wires its follow-up command", async () => {
		const source =
			'---\n# retained\nartifact: {input: {label: "Input"}}\n---\ninput >> build -> out # body remains\n';
		const { document, action } = prepare(source, "out");
		expect(action.title).toBe('Insert artifact definition for "out"');
		expect(action.kind).toBe("quickfix");
		expect(action.edit!.replacements).toHaveLength(1);
		const replacement = action.edit!.replacements[0]!;
		expect(replacement.uri).toBe(document.uri);
		expect(replacement.range.start).toEqual(new host.api.Position(0, 0));
		expect(replacement.range.end).toEqual(new host.api.Position(4, 0));
		expect(replacement.text).toBe(
			insertDefinition(source, "artifact", "out").output,
		);
		expect(replacement.text).toContain("# retained");
		expect(replacement.text).not.toContain("criteria:");
		expect(replacement.text).not.toContain("input >>");
		document.apply(action.edit!);
		await followUp(action);
		expect(
			document.getText().endsWith("input >> build -> out # body remains\n"),
		).toBe(true);
		expect(selectedText(host.visibleTextEditors[0]!)).toBe("out");
		expect(action.edit!.replacements).toHaveLength(1);
	});

	it.each([
		["build", "process", false],
		["input", "artifact", false],
		["out", "artifact", true],
	] as const)("selects %s and gives criteria guidance only when applicable", async (id, kind, needsCriteria) => {
		const { document, action } = prepare("input >> build -> out\n", id);
		document.apply(action.edit!);
		await followUp(action);
		const target = host.visibleTextEditors[0]!;
		expect(selectedText(target)).toBe(id);
		expect(target.revealRange).toHaveBeenCalledWith(target.selection);
		const hint = host.api.window.showInformationMessage.mock.calls[0]![0];
		expect(hint).toContain(`Edit the label for ${kind} "${id}"`);
		expect(hint.includes("criteria")).toBe(needsCriteria);
		expect(hint.includes("W002")).toBe(needsCriteria);
		expect(document.getText()).not.toContain("criteria:");
	});

	it("uses the current target snapshot with quoted flow YAML and CRLF, leaving the unrelated editor alone", async () => {
		const { document, action } = prepare("input >> build -> out\r\n", "out");
		document.apply(action.edit!);
		document.update(
			'---\r\n"artifact": {"out": {"label": "Ready: review", criteria: Reviewed}}\r\n---\r\ninput >> build -> out\r\n',
		);
		const unrelated = host.editor(
			host.document("unrelated >> task -> other\n", "other"),
		);
		const matching = host.editor(document);
		host.visibleTextEditors.push(unrelated, matching);
		await followUp(action);
		expect(selectedText(matching)).toBe("Ready: review");
		expect(matching.selection!.start.line).toBe(1);
		expect(matching.selection!.start.character).toBeGreaterThan(0);
		expect(unrelated.selection).toBeUndefined();
		expect(unrelated.revealRange).not.toHaveBeenCalled();
		expect(host.showTextDocument.mock.calls[0]![0]).toBe(document);
		expect(
			host.api.window.showInformationMessage.mock.calls[0]![0],
		).not.toContain("criteria");
	});

	it.each([
		"closed",
		"removed",
		"definition removed",
		"label removed",
		"different language",
	])("does nothing when the target is %s", async (state) => {
		const { document, action } = prepare("input >> build -> out\n", "out");
		document.apply(action.edit!);
		if (state === "closed") document.isClosed = true;
		if (state === "removed") host.textDocuments.length = 0;
		if (state === "definition removed")
			document.update("input >> build -> out\n");
		if (state === "label removed")
			document.update(
				"---\nartifact: {out: {description: Output}}\n---\ninput >> build -> out\n",
			);
		if (state === "different language") document.languageId = "plaintext";
		await followUp(action);
		expect(host.showTextDocument).not.toHaveBeenCalled();
		expect(host.api.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("does not select an editor returned for another document", async () => {
		const { document, action } = prepare("input >> build -> out\n", "out");
		document.apply(action.edit!);
		const unrelated = host.editor(
			host.document("unrelated >> task -> other\n", "other"),
		);
		host.showTextDocument.mockResolvedValue(unrelated);
		await followUp(action);
		expect(unrelated.selection).toBeUndefined();
		expect(unrelated.revealRange).not.toHaveBeenCalled();
		expect(host.api.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it.each([
		"closed",
		"definition removed",
	])("rechecks the target after showing its editor when it becomes %s", async (state) => {
		const { document, action } = prepare("input >> build -> out\n", "out");
		document.apply(action.edit!);
		const matching = host.editor(document);
		host.showTextDocument.mockImplementation(async () => {
			if (state === "closed") document.isClosed = true;
			else document.update("input >> build -> out\n");
			return matching;
		});
		await followUp(action);
		expect(matching.selection).toBeUndefined();
		expect(matching.revealRange).not.toHaveBeenCalled();
		expect(host.api.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("ignores failure to show a document that disappeared", async () => {
		const { document, action } = prepare("input >> build -> out\n", "out");
		document.apply(action.edit!);
		host.showTextDocument.mockRejectedValue(new Error("document disposed"));
		await followUp(action);
		expect(host.api.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it("continues to omit the action for an already defined node or another language", () => {
		for (const document of [
			host.document(
				"---\nartifact: {out: {label: Output}}\n---\ninput >> build -> out\n",
				"out",
			),
			host.document("input >> build -> out\n", "out", "plaintext"),
		]) {
			expect(
				host.providers[0]!.provideCodeActions(
					document,
					new host.api.Range(
						new host.api.Position(0, 0),
						new host.api.Position(0, 0),
					),
				),
			).toBeUndefined();
		}
	});
});

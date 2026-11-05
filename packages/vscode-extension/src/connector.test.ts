import { beforeEach, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
	const commands = new Map<string, () => Promise<void>>();
	const window = {
		activeTextEditor: undefined as unknown,
		showQuickPick: vi.fn(),
		showInputBox: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	};
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
	return {
		commands,
		window,
		api: {
			Position,
			Range,
			Selection: Range,
			window,
			commands: {
				registerCommand: (id: string, callback: () => Promise<void>) => {
					commands.set(id, callback);
					return {};
				},
			},
		},
	};
});
vi.mock("vscode", () => host.api);

import { clearAnalyzeCache } from "./analyze.js";
import { registerConnectorEditing } from "./connector.js";

beforeEach(() => {
	clearAnalyzeCache();
	vi.clearAllMocks();
	host.commands.clear();
});

function prepare(source: string) {
	const doc = {
		uri: { toString: () => "file:///repo/connector.pfdsl" },
		languageId: "pfdsl",
		version: 1,
		getText: () => source,
		getWordRangeAtPosition: () => undefined,
		lineAt: (line: number) => ({
			range: new host.api.Range(
				new host.api.Position(line, 0),
				new host.api.Position(line, source.split("\n")[line]!.length),
			),
		}),
	};
	const edit = vi.fn(
		async (
			callback: (builder: { insert: (...args: unknown[]) => void }) => void,
		) => {
			callback({ insert: vi.fn() });
			return true;
		},
	);
	host.window.activeTextEditor = {
		document: doc,
		selection: { active: new host.api.Position(0, 8) },
		edit,
		revealRange: vi.fn(),
	};
	registerConnectorEditing({
		subscriptions: [],
	} as unknown as vscode.ExtensionContext);
	return { edit, doc };
}

it("resolves a quoted process and offers correctly quoted connection choices", async () => {
	prepare('a >> "my process" -> out\n');
	host.window.showQuickPick.mockResolvedValueOnce(undefined);
	await host.commands.get("pfdsl.addConnector")!();
	expect(host.window.showQuickPick).toHaveBeenCalled();
	expect(
		host.window.showQuickPick.mock.calls[0]![0].map(
			(item: { label: string }) => item.label,
		),
	).toEqual(['… >> "my process"', '… >>? "my process"', '"my process" -> …']);
	expect(host.window.showInformationMessage).not.toHaveBeenCalled();
});

it("reports a duplicate quoted edge without surrounding its syntax with another pair of quotes", async () => {
	prepare('a >> "my process" -> out\n');
	host.window.showQuickPick
		.mockResolvedValueOnce({ connector: ">>" })
		.mockResolvedValueOnce({ label: "a" });
	host.window.showWarningMessage.mockResolvedValueOnce(undefined);
	await host.commands.get("pfdsl.addConnector")!();
	expect(host.window.showWarningMessage.mock.calls[0]?.[0]).toBe(
		'Connection a >> "my process" already exists.',
	);
});

it("refuses an output to another process's artifact and describes the producer in its picker", async () => {
	const s = prepare('a >> "my process" -> out\nb >> q -> taken\n');
	host.window.showQuickPick
		.mockResolvedValueOnce({ connector: "->" })
		.mockResolvedValueOnce({ label: "taken" });
	await host.commands.get("pfdsl.addConnector")!();
	expect(s.edit).not.toHaveBeenCalled();
	expect(host.window.showInformationMessage).toHaveBeenCalledWith(
		expect.stringContaining("q"),
	);
	expect(host.window.showQuickPick.mock.calls[1]![0]).toContainEqual(
		expect.objectContaining({
			label: "taken",
			description: expect.stringContaining("q"),
		}),
	);
});

it("does not insert from a picker whose authored source changed", async () => {
	const s = prepare('a >> "my process" -> out\nb >> q -> taken\n');
	host.window.showQuickPick
		.mockResolvedValueOnce({ connector: "->" })
		.mockImplementationOnce(async () => {
			s.doc.getText = () =>
				'a >> "my process" -> out\nb >> q -> taken\nq -> free\n';
			s.doc.version++;
			return { label: "free" };
		});
	await host.commands.get("pfdsl.addConnector")!();
	expect(s.edit).not.toHaveBeenCalled();
	expect(host.window.showInformationMessage).toHaveBeenCalledWith(
		expect.stringContaining("document changed"),
	);
});

it("validates a typed output and refuses a submitted conflicting ID even if input validation is bypassed", async () => {
	const s = prepare('a >> "my process" -> out\nb >> q -> taken\n');
	host.window.showQuickPick
		.mockResolvedValueOnce({ connector: "->" })
		.mockImplementationOnce(async (items) => items[0]);
	host.window.showInputBox.mockImplementationOnce(async (options) => {
		expect(options.validateInput("taken")).toContain("q");
		expect(options.validateInput("fresh")).toBeUndefined();
		return "taken";
	});
	await host.commands.get("pfdsl.addConnector")!();
	expect(s.edit).not.toHaveBeenCalled();
	expect(host.window.showInformationMessage).toHaveBeenCalledWith(
		expect.stringContaining("already produced by q"),
	);
});

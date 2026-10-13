import { beforeEach, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
	const channel = { clear: vi.fn(), appendLine: vi.fn(), show: vi.fn() };
	const callbacks = new Map<string, () => unknown>();
	const window = {
		activeTextEditor: undefined as vscode.TextEditor | undefined,
		createOutputChannel: () => channel,
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	};
	return {
		channel,
		callbacks,
		window,
		api: {
			window,
			commands: {
				registerCommand(name: string, callback: () => unknown) {
					callbacks.set(name, callback);
					return { dispose() {} };
				},
			},
		},
	};
});
vi.mock("vscode", () => host.api);

import { clearAnalyzeCache } from "./analyze.js";
import { registerExport } from "./export.js";

beforeEach(() => {
	vi.clearAllMocks();
	clearAnalyzeCache();
	host.window.activeTextEditor = undefined;
	registerExport(
		{ subscriptions: [] } as unknown as vscode.ExtensionContext,
		() => undefined,
	);
});

it.each([
	["[b,a] >> p -> [z,y]", "a >> p\nb >> p\np -> y\np -> z\n"],
	["---\nartifact:\n  b: {status: done}\n---\na >> p -> b", "a >> p\np -> b\n"],
	["lonely", ""],
])("registered normalization preserves output-channel behavior for %s", (source, output) => {
	host.window.activeTextEditor = {
		document: {
			languageId: "pfdsl",
			version: 1,
			uri: { toString: () => "untitled:normalize" },
			getText: () => source,
		},
	} as unknown as vscode.TextEditor;
	host.callbacks.get("pfdsl.normalize")!();
	expect(host.channel.clear).toHaveBeenCalledOnce();
	expect(host.channel.appendLine.mock.calls).toEqual([[output]]);
	expect(host.channel.show.mock.calls).toEqual([[true]]);
	expect(host.window.showErrorMessage).not.toHaveBeenCalled();
});

it("blocks errors without clearing previous channel content and ignores absent editors", () => {
	host.callbacks.get("pfdsl.normalize")!();
	expect(host.channel.clear).not.toHaveBeenCalled();
	host.window.activeTextEditor = {
		document: {
			languageId: "pfdsl",
			version: 1,
			uri: { toString: () => "untitled:normalize" },
			getText: () => "a >>",
		},
	} as unknown as vscode.TextEditor;
	host.callbacks.get("pfdsl.normalize")!();
	expect(host.channel.clear).not.toHaveBeenCalled();
	expect(host.channel.appendLine).not.toHaveBeenCalled();
	expect(host.channel.show).not.toHaveBeenCalled();
	expect(host.window.showErrorMessage).toHaveBeenCalledWith(
		"Fix errors before normalizing.",
	);
});

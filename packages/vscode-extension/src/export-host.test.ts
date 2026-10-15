import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
	const commands = new Map<string, () => Promise<void>>();
	const writes: string[] = [],
		messages: string[] = [];
	const uri = (path: string) => ({
		path,
		fsPath: path,
		scheme: "file",
		toString: () => path,
	});
	let cancel = false;
	return {
		commands,
		writes,
		messages,
		uri,
		setCancel(value: boolean) {
			cancel = value;
		},
		window: {
			activeTextEditor: {
				document: {
					languageId: "pfdsl",
					uri: uri("/source/日本語.pfdsl"),
					version: 1,
					getText: () => "a >> p -> b\n",
				},
			},
			createOutputChannel: () => ({
				appendLine: (message: string) => messages.push(message),
				show() {},
				dispose() {},
			}),
			showQuickPick: async (items: { description: string }[]) =>
				items.find((item) => item.description === "all"),
			showSaveDialog: async () =>
				cancel ? undefined : uri("/chosen/日本語.dot"),
			showWarningMessage: vi.fn(),
			showInformationMessage: vi.fn(),
			showErrorMessage: vi.fn(),
		},
	};
});
vi.mock("vscode", () => ({
	window: host.window,
	Uri: { file: host.uri },
	commands: {
		registerCommand: (name: string, run: () => Promise<void>) => {
			host.commands.set(name, run);
			return { dispose() {} };
		},
	},
	workspace: {
		fs: {
			writeFile: async (uri: { fsPath: string }) => {
				host.writes.push(uri.fsPath);
				if (uri.fsPath.endsWith(".svg")) throw new Error("disk full");
			},
		},
	},
}));
vi.mock("@pfdsl/preview-engine", () => ({
	renderDotToSvg: async () => '<svg xmlns="http://www.w3.org/2000/svg"/>',
}));
vi.mock("@pfdsl/graphviz-exporter", () => ({
	svgToBinary: async (_svg: string, format: string) => {
		if (format === "pdf") throw new Error("Puppeteer unavailable");
		return new Uint8Array([1]);
	},
}));

import { registerExport } from "./export.js";

describe("registered VS Code export", () => {
	it("reports conversion and write failures individually and retains other outputs", async () => {
		registerExport(
			{ subscriptions: [] } as unknown as vscode.ExtensionContext,
			() => undefined,
		);
		await host.commands.get("pfdsl.export")!();
		expect(host.writes).toEqual([
			"/chosen/日本語.dot",
			"/chosen/日本語.svg",
			"/chosen/日本語.png",
			"/chosen/日本語.tsv",
		]);
		const message = host.messages.at(-1)!;
		expect(message).toContain("PDF: conversion-failed");
		expect(message).toContain("SVG: write-failed");
		expect(message).toContain("DOT: /chosen/日本語.dot");
		expect(message).not.toContain("SVG: /chosen/日本語.svg");
		expect(host.window.showWarningMessage).toHaveBeenCalled();
		host.setCancel(true);
		await host.commands.get("pfdsl.export")!();
		expect(host.writes).toHaveLength(4);
	});
});

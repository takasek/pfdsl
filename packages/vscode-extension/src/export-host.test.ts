import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
	const commands = new Map<string, () => Promise<void>>();
	const writes: { path: string; bytes: Buffer }[] = [];
	const messages: string[] = [];
	const failedWrites = new Set<string>();
	const uri = (path: string) => ({
		path,
		fsPath: path,
		scheme: "file",
		toString: () => path,
	});
	let cancel = false;
	let format = "all";
	return {
		commands,
		writes,
		messages,
		failedWrites,
		uri,
		setCancel(value: boolean) {
			cancel = value;
		},
		selectFormat(value: string) {
			format = value;
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
				items.find((item) => item.description === format),
			showSaveDialog: async () =>
				cancel
					? undefined
					: uri(`/chosen/日本語${format === "all" ? ".dot" : format}`),
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
			writeFile: async (uri: { fsPath: string }, bytes: Uint8Array) => {
				host.writes.push({ path: uri.fsPath, bytes: Buffer.from(bytes) });
				if (host.failedWrites.has(uri.fsPath)) throw new Error("disk full");
			},
		},
	},
}));
vi.mock("@pfdsl/preview-engine", () => ({
	renderDotToSvg: async () =>
		'<svg xmlns="http://www.w3.org/2000/svg"><text>日本語</text></svg>',
}));
vi.mock("@pfdsl/graphviz-exporter", () => ({
	svgToBinary: async (_svg: string, format: string) => {
		if (format === "pdf") throw new Error("Puppeteer unavailable");
		return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
	},
}));

import { registerExport } from "./export.js";

describe("registered VS Code export", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		host.commands.clear();
		host.writes.length = 0;
		host.messages.length = 0;
		host.failedWrites.clear();
		host.setCancel(false);
		host.selectFormat("all");
		registerExport(
			{ subscriptions: [] } as unknown as vscode.ExtensionContext,
			() => undefined,
		);
	});

	it.each([
		{
			format: ".png",
			bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
		},
		{
			format: ".svg",
			bytes: Buffer.from(
				'<svg xmlns="http://www.w3.org/2000/svg"><text>日本語</text></svg>',
				"utf8",
			),
		},
	])("saves the full bytes for a single $format export", async ({
		format,
		bytes,
	}) => {
		host.selectFormat(format);
		await host.commands.get("pfdsl.export")!();
		expect(host.writes).toEqual([{ path: `/chosen/日本語${format}`, bytes }]);
		expect(host.window.showInformationMessage).toHaveBeenCalledWith(
			`Exported: /chosen/日本語${format}`,
		);
	});

	it("reports conversion and write failures individually and retains other outputs", async () => {
		host.failedWrites.add("/chosen/日本語.svg");
		await host.commands.get("pfdsl.export")!();
		expect(host.writes).toEqual([
			{
				path: "/chosen/日本語.dot",
				bytes: Buffer.from(
					'digraph PFDSL {\n  rankdir=LR;\n  newrank=true;\n\n  "a" [shape=box, label="a", penwidth="2"];\n  "b" [shape=box, label="b", penwidth="2"];\n  "p" [shape=ellipse, label="p"];\n\n  "a" -> "p";\n  "p" -> "b";\n}\n',
					"utf8",
				),
			},
			{
				path: "/chosen/日本語.svg",
				bytes: Buffer.from(
					'<svg xmlns="http://www.w3.org/2000/svg"><text>日本語</text></svg>',
					"utf8",
				),
			},
			{
				path: "/chosen/日本語.png",
				bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]),
			},
			{
				path: "/chosen/日本語.tsv",
				bytes: Buffer.from(
					"kind\tid\tlabel\tdescription\tstatus\ttags\towner\nartifact\ta\t\t\t\t\t\nartifact\tb\t\t\t\t\t\nprocess\tp\t\t\t\t\t\n",
					"utf8",
				),
			},
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

import { constants } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
	const commands = new Map<string, () => Promise<void>>();
	const writes: { path: string; bytes: Buffer }[] = [];
	const messages: string[] = [];
	const failedWrites = new Set<string>();
	const files = new Map<string, Buffer>();
	const partial = { fail: false };
	const laterFiles = new Map<string, Buffer>();
	const uri = (path: string, scheme = "file", authority = "") => ({
		path,
		fsPath: path,
		scheme,
		authority,
		with: (change: { path: string }) => uri(change.path, scheme, authority),
		toString: () =>
			scheme === "file" ? path : `${scheme}://${authority}${path}`,
	});
	const saveDialog = vi.fn(async () =>
		cancel
			? undefined
			: uri(`/chosen/日本語${format === "all" ? ".dot" : format}`),
	);
	const stat = vi.fn(async (target: ReturnType<typeof uri>) => {
		if (!files.has(target.toString())) {
			throw Object.assign(new Error("File not found"), {
				code: "FileNotFound",
			});
		}
		return { type: 1 };
	});
	const writeFile = async (
		target: ReturnType<typeof uri>,
		content: Uint8Array,
	) => {
		const path = target.toString();
		const concurrent = laterFiles.get(path);
		if (concurrent) files.set(path, concurrent);
		const bytes = Buffer.from(content);
		if (partial.fail) {
			files.set(path, bytes.subarray(0, 3));
			throw new Error("short write");
		}
		if (!path.endsWith(".tmp")) writes.push({ path, bytes });
		if (failedWrites.has(path)) throw new Error("disk full");
		files.set(path, bytes);
	};
	let cancel = false;
	let format = "all";
	return {
		commands,
		writes,
		messages,
		failedWrites,
		files,
		partial,
		laterFiles,
		stat,
		writeFile,
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
			showSaveDialog: saveDialog,
			showWarningMessage: vi.fn(),
			showInformationMessage: vi.fn(),
			showErrorMessage: vi.fn(),
		},
	};
});
vi.mock("vscode", () => ({
	window: host.window,
	env: {},
	Uri: { file: host.uri },
	commands: {
		registerCommand: (name: string, run: () => Promise<void>) => {
			host.commands.set(name, run);
			return { dispose() {} };
		},
	},
	workspace: {
		fs: {
			stat: host.stat,
			writeFile: host.writeFile,
			delete: async (target: ReturnType<typeof host.uri>) => {
				host.files.delete(target.toString());
			},
			rename: async (
				source: ReturnType<typeof host.uri>,
				target: ReturnType<typeof host.uri>,
				{ overwrite }: { overwrite: boolean },
			) => {
				const path = target.toString();
				const concurrent = host.laterFiles.get(path);
				if (concurrent) host.files.set(path, concurrent);
				if (host.files.has(path) && !overwrite) throw new Error("File exists");
				host.files.set(path, host.files.get(source.toString())!);
				host.files.delete(source.toString());
			},
		},
	},
}));
vi.mock("node:fs/promises", () => ({
	copyFile: async (source: string, path: string, flags: number) => {
		const concurrent = host.laterFiles.get(path);
		if (concurrent) host.files.set(path, concurrent);
		if (flags & constants.COPYFILE_EXCL && host.files.has(path))
			throw new Error("File exists");
		await host.writeFile(host.uri(path), host.files.get(source)!);
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
		host.files.clear();
		host.partial.fail = false;
		host.laterFiles.clear();
		host.setCancel(false);
		host.selectFormat("all");
		registerExport(
			{ subscriptions: [] } as unknown as vscode.ExtensionContext,
			() => undefined,
		);
	});

	it("lists existing siblings before writing anything and leaves all bytes intact on cancel", async () => {
		const tsv = "/chosen/日本語.tsv";
		host.files.set(tsv, Buffer.from([0xff, 0, 0x21]));
		const before = new Map(host.files);
		await host.commands.get("pfdsl.export")!();
		const prompt = host.window.showWarningMessage.mock.calls[0];
		expect(prompt?.[1]).toMatchObject({ modal: true });
		expect(JSON.stringify(prompt)).toContain(tsv);
		expect(JSON.stringify(prompt)).not.toContain("/chosen/日本語.dot");
		expect(host.writes).toHaveLength(0);
		expect(host.files).toEqual(before);
	});

	it("rechecks completed formats on retry and replaces an annotated SVG only with confirmation", async () => {
		await host.commands.get("pfdsl.export")!();
		const svg = "/chosen/日本語.svg";
		const original = host.files.get(svg);
		expect(original).toBeDefined();
		host.files.set(svg, Buffer.from("annotation after partial failure"));
		const before = new Map(host.files);
		host.writes.length = 0;
		host.window.showWarningMessage.mockClear();
		await host.commands.get("pfdsl.export")!();
		expect(host.writes).toHaveLength(0);
		expect(host.files).toEqual(before);
		const prompt = JSON.stringify(host.window.showWarningMessage.mock.calls[0]);
		for (const path of before.keys()) expect(prompt).toContain(path);
		expect(prompt).not.toContain("/chosen/日本語.pdf");
		host.window.showWarningMessage.mockResolvedValueOnce("Replace");
		await host.commands.get("pfdsl.export")!();
		expect(host.files.get(svg)).toEqual(original);
		expect(host.files.has("/chosen/日本語.pdf")).toBe(false);
		expect(host.messages.at(-1)).toContain("PDF: conversion-failed");
	});

	it("checks and saves all siblings at the selected provider and authority", async () => {
		const remote = "memfs://remote/chosen/report";
		host.window.showSaveDialog.mockResolvedValueOnce(
			host.uri("/chosen/report.dot", "memfs", "remote"),
		);
		host.files.set(`${remote}.tsv`, Buffer.from("existing"));
		host.window.showWarningMessage.mockResolvedValueOnce("Replace");
		await host.commands.get("pfdsl.export")!();
		expect(
			JSON.stringify(host.window.showWarningMessage.mock.calls[0]),
		).toContain(`${remote}.tsv`);
		expect([...host.files.keys()].sort()).toEqual(
			["dot", "png", "svg", "tsv"].map((ext) => `${remote}.${ext}`),
		);
		expect(host.messages.at(-1)).toContain(`SVG: ${remote}.svg`);
	});

	it("stops before any write when a provider cannot inspect a target", async () => {
		host.stat.mockRejectedValueOnce(new Error("provider unavailable"));
		await host.commands.get("pfdsl.export")!();
		expect(host.writes).toHaveLength(0);
		expect(host.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("provider unavailable"),
		);
	});

	it("does not replace a sibling created by someone else after the initial check", async () => {
		const tsv = "/chosen/日本語.tsv";
		const other = Buffer.from("concurrent export");
		host.laterFiles.set(tsv, other);
		await host.commands.get("pfdsl.export")!();
		expect(host.files.get(tsv)).toEqual(other);
		expect(host.messages.at(-1)).toContain("TSV: write-failed");
	});

	it("leaves no new output after a partial storage write", async () => {
		host.partial.fail = true;
		await host.commands.get("pfdsl.export")!();
		expect(host.messages.at(-1)).toContain("DOT: write-failed");
		expect([...host.files.keys()]).toEqual([]);
	});

	it("keeps an intervening provider-side write and cleans up temporary output", async () => {
		host.window.showSaveDialog.mockResolvedValueOnce(
			host.uri("/chosen/report.dot", "memfs", "remote"),
		);
		const prefix = "memfs://remote/chosen/report";
		const other = Buffer.from("new provider data");
		host.laterFiles.set(`${prefix}.tsv`, other);
		await host.commands.get("pfdsl.export")!();
		expect(host.files.get(`${prefix}.tsv`)).toEqual(other);
		expect(host.messages.at(-1)).toContain("TSV: write-failed");
		expect([...host.files.keys()].sort()).toEqual(
			["dot", "png", "svg", "tsv"].map((ext) => `${prefix}.${ext}`),
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

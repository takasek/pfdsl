import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

// Only VS Code registration, URI objects and filesystem calls are faked.
// The provider, snapshot analysis and CST-backed link extraction are production code.
const host = vi.hoisted(() => {
	class Uri {
		private constructor(
			public scheme: string,
			public fsPath: string,
			public query: string,
			public fragment: string,
			private value: string,
		) {}
		static parse(value: string) {
			const parsed = new URL(value);
			return new Uri(
				parsed.protocol.slice(0, -1),
				decodeURIComponent(parsed.pathname),
				parsed.search.slice(1),
				parsed.hash.slice(1),
				value,
			);
		}
		static file(path: string) {
			return Uri.parse(
				`file://${path.split("/").map(encodeURIComponent).join("/")}`,
			);
		}
		static joinPath(base: Uri, ...parts: string[]) {
			return Uri.file([base.fsPath.replace(/\/+$/, ""), ...parts].join("/"));
		}
		toString() {
			return this.value;
		}
	}
	class Range {
		constructor(
			public startLine: number,
			public startCharacter: number,
			public endLine: number,
			public endCharacter: number,
		) {}
	}
	class DocumentLink {
		tooltip?: string;
		constructor(
			public range: Range,
			public target: Uri,
		) {}
	}
	const commands = new Map<string, (path: string) => unknown>();
	let provider: vscode.DocumentLinkProvider | undefined;
	const stat = vi.fn(async () => ({ type: 1 }));
	const readDirectory = vi.fn(async () => [] as [string, number][]);
	const window = {
		showTextDocument: vi.fn(async () => {}),
		showQuickPick: vi.fn(),
		showWarningMessage: vi.fn(),
	};
	return {
		commands,
		stat,
		readDirectory,
		window,
		getProvider: () => provider!,
		api: {
			Uri,
			Range,
			DocumentLink,
			FileType: { File: 1, Directory: 2 },
			window,
			workspace: { fs: { stat, readDirectory } },
			commands: {
				registerCommand: (
					name: string,
					callback: (path: string) => unknown,
				) => {
					commands.set(name, callback);
					return { dispose() {} };
				},
			},
			languages: {
				registerDocumentLinkProvider: (
					_language: string,
					value: vscode.DocumentLinkProvider,
				) => {
					provider = value;
					return { dispose() {} };
				},
			},
		},
	};
});

vi.mock("vscode", () => host.api);

import { clearAnalyzeCache } from "./analyze.js";
import { registerDocumentLinks } from "./document-link.js";

async function provide(location: string) {
	registerDocumentLinks({
		subscriptions: [],
	} as unknown as vscode.ExtensionContext);
	const doc = {
		uri: host.api.Uri.file("/repo/.pfdsl/roadmap.pfdsl"),
		version: 1,
		getText: () =>
			`---\nbasePath: ../\nartifact:\n  spec:\n    location: "${location}"\n---\n`,
	} as unknown as vscode.TextDocument;
	return (
		(await host
			.getProvider()
			.provideDocumentLinks(doc, {} as vscode.CancellationToken)) ?? []
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	clearAnalyzeCache();
	host.commands.clear();
	host.stat.mockResolvedValue({ type: host.api.FileType.File });
	host.readDirectory.mockResolvedValue([]);
});

describe("registered document link provider", () => {
	it.each([
		[
			"file:///repo/docs/spec.md?revision=1",
			"/repo/docs/spec.md",
			"revision=1",
			"",
		],
		[
			"file:///repo/docs/design%20spec.md#L10",
			"/repo/docs/design spec.md",
			"",
			"L10",
		],
		["file:///repo/docs/100%25.md", "/repo/docs/100%.md", "", ""],
	])("preserves the authored file URI: %s", async (target, fsPath, query, fragment) => {
		const links = await provide(target);
		expect(links).toHaveLength(1);
		expect(links[0]?.target?.toString()).toBe(target);
		expect(links[0]?.target).toMatchObject({ fsPath, query, fragment });
		expect(host.stat).toHaveBeenCalledWith(host.api.Uri.file(fsPath));
	});

	it("preserves a non-file URI without checking the filesystem", async () => {
		const target = "vscode://publisher.extension/open?file=spec.md";
		const links = await provide(target);
		expect(links[0]?.target?.toString()).toBe(target);
		expect(host.stat).not.toHaveBeenCalled();
	});

	it("keeps URI-special characters in a quoted local filename", async () => {
		const links = await provide("docs/design, #100%.md");
		expect(links[0]?.target?.toString()).toBe(
			"file:///repo/docs/design,%20%23100%25.md",
		);
		expect(links[0]?.target).toMatchObject({
			fsPath: "/repo/docs/design, #100%.md",
			query: "",
			fragment: "",
		});
		expect(host.stat).toHaveBeenCalledWith(
			host.api.Uri.file("/repo/docs/design, #100%.md"),
		);
	});

	it("retains the directory command and opens its decoded filesystem path", async () => {
		host.stat.mockResolvedValue({ type: host.api.FileType.Directory });
		host.readDirectory.mockResolvedValue([["spec.md", host.api.FileType.File]]);
		const links = await provide("file:///repo/docs/design%20specs/?revision=1");
		const link = links[0]!;
		expect(link.tooltip).toBe("Open file in folder…");
		expect(link.target?.scheme).toBe("command");
		const args = JSON.parse(decodeURIComponent(link.target!.query));
		expect(args).toEqual(["/repo/docs/design specs/"]);
		await host.commands.get("pfdsl._openDirLocation")!(args[0]);
		expect(host.readDirectory).toHaveBeenCalledWith(host.api.Uri.file(args[0]));
		expect(host.window.showTextDocument).toHaveBeenCalledWith(
			host.api.Uri.file("/repo/docs/design specs/spec.md"),
		);
	});

	it("resolves a relative directory from basePath before creating the command", async () => {
		host.stat.mockResolvedValue({ type: host.api.FileType.Directory });
		const links = await provide("docs");
		expect(JSON.parse(decodeURIComponent(links[0]!.target!.query))).toEqual([
			"/repo/docs",
		]);
		expect(host.stat).toHaveBeenCalledWith(host.api.Uri.file("/repo/docs"));
	});
});

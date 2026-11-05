import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiffReport } from "@pfdsl/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

const host = vi.hoisted(() => {
	const commands = new Map<string, () => unknown>();
	const spawnSync = vi.fn();
	const window = {
		activeTextEditor: undefined as vscode.TextEditor | undefined,
		showQuickPick: vi.fn(),
		showInputBox: vi.fn(),
		showOpenDialog: vi.fn(),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	};
	return {
		commands,
		spawnSync,
		window,
		api: {
			window,
			commands: {
				registerCommand: (name: string, callback: () => unknown) => {
					commands.set(name, callback);
					return { dispose() {} };
				},
				executeCommand: vi.fn(async () => {}),
			},
			workspace: {
				getWorkspaceFolder: () => ({ uri: { fsPath: "/repo" } }),
			},
		},
	};
});

vi.mock("vscode", () => host.api);
vi.mock("node:child_process", () => ({ spawnSync: host.spawnSync }));

import { clearAnalyzeCache } from "./analyze.js";
import { registerDiff } from "./diff.js";

function source(status: string, label: string): string {
	return `---
artifact:
  spec:
    status: ${status}
    criteria: Reviewed
process:
  build:
    label: ${label}
---
req >> build -> spec
`;
}

beforeEach(() => {
	vi.clearAllMocks();
	clearAnalyzeCache();
	host.commands.clear();
	host.window.activeTextEditor = undefined;
});

describe("registered diff command", () => {
	it.each([
		"file",
		"git",
	])("reports metadata-only changes when comparing with %s", async (mode) => {
		const directory = mkdtempSync(join(tmpdir(), "pfdsl-diff-command-"));
		try {
			const comparisonPath = join(directory, "comparison.pfdsl");
			const before = source("todo", "Build");
			writeFileSync(comparisonPath, before);
			host.window.showQuickPick.mockResolvedValue({ id: mode });
			host.window.showOpenDialog.mockResolvedValue([
				{ fsPath: comparisonPath },
			]);
			host.window.showInputBox.mockResolvedValue("HEAD~1");
			host.spawnSync.mockReturnValue({ status: 0, stdout: before });
			const postDiff = vi.fn<[DiffReport | null], void>();
			registerDiff(
				{ subscriptions: [] } as unknown as vscode.ExtensionContext,
				postDiff,
			);

			for (const [text, changedNodes] of [
				[source("done", "Publish"), ["build", "spec"]],
				[before, []],
			] as const) {
				clearAnalyzeCache();
				host.window.activeTextEditor = {
					document: {
						uri: {
							fsPath: "/repo/main.pfdsl",
							toString: () => "file:///repo/main.pfdsl",
						},
						languageId: "pfdsl",
						version: 1,
						getText: () => text,
					},
				} as vscode.TextEditor;
				await host.commands.get("pfdsl.diff")!();
				expect(postDiff).toHaveBeenLastCalledWith({
					addedNodes: [],
					removedNodes: [],
					changedNodes,
					addedEdges: [],
					removedEdges: [],
					addedFeedback: [],
					removedFeedback: [],
				});
			}
			expect(host.api.commands.executeCommand).toHaveBeenCalledWith(
				"pfdsl.preview",
			);
			expect(host.window.showErrorMessage).not.toHaveBeenCalled();
			if (mode === "git") {
				expect(host.spawnSync).toHaveBeenCalledWith(
					"git",
					["show", "HEAD~1:main.pfdsl"],
					{ cwd: "/repo", encoding: "utf-8" },
				);
			}
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});

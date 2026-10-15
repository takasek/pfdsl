import type { DirectoryEntry, ReferenceTarget } from "@pfdsl/editor";
import { invoke } from "@tauri-apps/api/core";
import type { ComparisonBaseline } from "./comparison.js";
import type { DiskSnapshot } from "./document-session.js";

export interface ReferenceServices {
	context(): Promise<string | null>;
	inspect(path: string): Promise<"file" | "directory">;
	list(path: string): Promise<DirectoryEntry[]>;
	open(target: ReferenceTarget, isCurrent?: () => boolean): Promise<void>;
	compareFile(): Promise<ComparisonBaseline | null>;
	compareGit(reference: string): Promise<ComparisonBaseline>;
	run(
		command: string,
		cwd: string,
		terminal: "terminal" | "ghostty",
	): Promise<void>;
}

export function createNativeReferenceServices(
	documentId: () => number | undefined,
	available: () => boolean,
	openSnapshot: (snapshot: DiskSnapshot) => Promise<void>,
): ReferenceServices {
	function check() {
		if (!available())
			throw new Error("Return to the originating document and try again.");
	}
	function bound<T>(command: string, args: Record<string, unknown> = {}) {
		check();
		return invoke<T>(command, { id: documentId() ?? null, ...args });
	}
	return {
		context: () => bound("reference_context"),
		inspect: (path) => bound("inspect_reference", { path }),
		list: (path) => bound("reference_directory", { path }),
		async open(target, isCurrent = () => true) {
			const snapshot = await bound<DiskSnapshot | null>(
				"open_reference",
				target,
			);
			if (!snapshot) return;
			if (!available() || !isCurrent()) {
				await invoke("release_document", { id: snapshot.id });
				return;
			}
			try {
				await openSnapshot(snapshot);
			} catch (error) {
				await invoke("release_document", { id: snapshot.id });
				throw error;
			}
		},
		compareFile: () => {
			check();
			return invoke("choose_comparison");
		},
		compareGit: (reference) => {
			if (documentId() === undefined)
				return Promise.reject(
					new Error(
						"Save this document before using Git comparison. File comparison remains available.",
					),
				);
			return bound("compare_git", { reference });
		},
		run: (command, cwd, terminal) =>
			bound("run_process", { command, cwd, terminal }),
	};
}

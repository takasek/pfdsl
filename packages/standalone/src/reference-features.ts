import { resolveLocationFsPath } from "@pfdsl/core";
import {
	analyzeSnapshot,
	type DocumentReference,
	documentReferences,
	expandDirectory,
	joinReferencePath,
	type MessageFromWebview,
	type MessageToWebview,
	nodeIdAtSourcePosition,
	normalizeLocation,
	resolveDocumentReference,
} from "@pfdsl/editor";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { createComparison } from "./comparison.js";
import type { ReferenceServices } from "./reference-services.js";

export function registerReferenceFeatures(
	editor: monaco.editor.IStandaloneCodeEditor,
	container: HTMLElement,
	services: ReferenceServices | undefined,
	send: (message: MessageToWebview) => void,
	report: (message: string) => void,
) {
	const model = editor.getModel()!;
	let disposed = false,
		generation = 0;
	let cancelPanel: (() => void) | undefined;
	const banner = document.createElement("div");
	banner.className = "reference-comparison";
	banner.hidden = true;
	container.append(banner);
	const comparison = createComparison(
		() => model.getValue(),
		() => model.getVersionId(),
		send,
		report,
		(label) => {
			banner.replaceChildren();
			banner.hidden = label === null;
			if (label === null) return;
			const text = document.createElement("span");
			text.textContent = `Structural diff: ${label} → current editor (including metadata)`;
			const clear = document.createElement("button");
			clear.textContent = "Clear comparison";
			clear.onclick = () => comparison.clear();
			banner.append(text, clear);
		},
	);
	const valid = (request: number, version: number) =>
		!disposed && generation === request && model.getVersionId() === version;
	const required = () => {
		if (!services)
			throw new Error(
				"Use the desktop application for external references, comparison and process commands.",
			);
		return services;
	};
	function prompt(
		title: string,
		choices?: string[],
		initial = "",
	): Promise<string | null> {
		cancelPanel?.();
		if (disposed) return Promise.resolve(null);
		return new Promise((resolve) => {
			const panel = document.createElement("form");
			panel.className = "reference-dialog";
			panel.setAttribute("role", "dialog");
			panel.setAttribute("aria-label", title);
			const label = document.createElement("label");
			label.textContent = title;
			const input = choices
				? document.createElement("select")
				: document.createElement("input");
			if (choices)
				for (const value of choices) {
					const option = document.createElement("option");
					option.value = value;
					option.textContent = value;
					(input as HTMLSelectElement).append(option);
				}
			else input.value = initial;
			label.append(input);
			const finish = (value: string | null) => {
				panel.remove();
				if (cancelPanel === cancel) cancelPanel = undefined;
				if (!disposed) editor.focus();
				resolve(value);
			};
			const cancel = () => finish(null);
			cancelPanel = cancel;
			const cancelButton = document.createElement("button");
			cancelButton.type = "button";
			cancelButton.textContent = "Cancel";
			cancelButton.onclick = cancel;
			const submit = document.createElement("button");
			submit.type = "submit";
			submit.textContent = choices ? "Open" : "Compare";
			panel.append(label, cancelButton, submit);
			panel.onsubmit = (event) => {
				event.preventDefault();
				if (input.value.trim()) finish(input.value);
			};
			panel.onkeydown = (event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					cancel();
				}
			};
			container.append(panel);
			input.focus();
		});
	}
	async function open(reference: Pick<DocumentReference, "field" | "value">) {
		const service = required();
		const request = ++generation,
			version = model.getVersionId();
		const source = analyzeSnapshot(model.getValue());
		const path = await service.context();
		if (!valid(request, version)) return;
		let target = resolveDocumentReference(
			path,
			reference,
			source.frontmatter?.basePath,
		);
		if (
			target.kind === "path" &&
			(await service.inspect(target.value)) === "directory"
		) {
			if (!valid(request, version)) return;
			let failure: unknown;
			const candidates = await expandDirectory(
				{
					read: async (path) => {
						try {
							return await service.list(path);
						} catch (error) {
							failure = error;
							throw error;
						}
					},
					join: joinReferencePath,
				},
				target.value,
			);
			if (!valid(request, version)) return;
			if (!candidates.length) {
				if (failure) throw failure;
				throw new Error(`No files found in ${target.value}`);
			}
			const selected =
				candidates.length === 1
					? candidates[0]!
					: await prompt("Open reference file", candidates);
			if (!selected || !valid(request, version)) return;
			target = { kind: "path", value: selected };
		}
		if (valid(request, version))
			await service.open(target, () => valid(request, version));
	}
	async function run(
		command: string,
		terminal: "terminal" | "ghostty" = "terminal",
	) {
		const service = required();
		const request = ++generation,
			version = model.getVersionId();
		const current = analyzeSnapshot(model.getValue());
		const path = await service.context();
		if (!valid(request, version)) return;
		if (!path)
			throw new Error("Save this document before running a process command.");
		await service.run(
			command,
			resolveLocationFsPath(path, ".", current.frontmatter?.basePath),
			terminal,
		);
		report(
			`Command sent to ${terminal === "terminal" ? "Terminal.app" : "Ghostty"}. Process completion is not monitored.`,
		);
	}
	function runAtCursor(terminal: "terminal" | "ghostty") {
		const current = analyzeSnapshot(model.getValue()),
			position = editor.getPosition();
		if (!position) return;
		const id = nodeIdAtSourcePosition(current, current.source, {
			line: position.lineNumber - 1,
			character: position.column - 1,
		});
		const command =
			id === undefined
				? undefined
				: current.frontmatter?.process?.[id]?.command;
		if (!command) {
			report("Place the cursor on a process with a command.");
			return;
		}
		return run(command, terminal);
	}
	const safely = (work: () => unknown | Promise<unknown>) => async () => {
		try {
			if (!disposed) await work();
		} catch (error) {
			if (!disposed) report(String(error));
		}
	};
	const actions = [
		editor.addAction({
			id: "pfdsl.compareFile",
			label: "Compare structure with file…",
			contextMenuGroupId: "pfdsl",
			run: safely(() => comparison.compare(() => required().compareFile())),
		}),
		editor.addAction({
			id: "pfdsl.compareGit",
			label: "Compare structure with Git ref…",
			contextMenuGroupId: "pfdsl",
			run: safely(() =>
				comparison.compare(async () => {
					const reference = await prompt(
						"Compare with Git commit, branch or tag",
						undefined,
						"HEAD",
					);
					return reference === null ? null : required().compareGit(reference);
				}),
			),
		}),
		editor.addAction({
			id: "pfdsl.clearDiff",
			label: "Clear structural comparison",
			run: () => comparison.clear(),
		}),
		editor.addAction({
			id: "pfdsl.runTerminal",
			label: "Run process command in Terminal.app",
			contextMenuGroupId: "pfdsl",
			run: safely(() => runAtCursor("terminal")),
		}),
		editor.addAction({
			id: "pfdsl.runGhostty",
			label: "Run process command in Ghostty",
			contextMenuGroupId: "pfdsl",
			run: safely(() => runAtCursor("ghostty")),
		}),
		monaco.languages.registerLinkProvider("pfdsl", {
			provideLinks(target) {
				if (disposed || target !== model) return { links: [] };
				return {
					links: documentReferences(analyzeSnapshot(model.getValue())).map(
						(ref, index) => ({
							range: new monaco.Range(
								ref.range.start.line,
								ref.range.start.column,
								ref.range.end.line,
								ref.range.end.column,
							),
							url: monaco.Uri.from({
								scheme: "pfdsl-reference",
								path: `/${editor.getId()}`,
								query: JSON.stringify({ version: model.getVersionId(), index }),
							}),
							tooltip: "Open reference",
						}),
					),
				};
			},
		}),
		monaco.editor.registerLinkOpener({
			async open(resource) {
				if (
					resource.scheme !== "pfdsl-reference" ||
					resource.path !== `/${editor.getId()}`
				)
					return false;
				if (disposed) return true;
				try {
					const { version, index } = JSON.parse(resource.query);
					if (version !== model.getVersionId()) return true;
					const ref = documentReferences(analyzeSnapshot(model.getValue()))[
						index
					];
					if (ref) await open(ref);
				} catch (error) {
					report(String(error));
				}
				return true;
			},
		}),
	];
	return {
		open,
		run,
		async handleMessage(message: MessageFromWebview) {
			const current = analyzeSnapshot(model.getValue());
			if (message.type === "openUrl")
				await open({ field: "location", value: message.url });
			else if (message.type === "openFile")
				await open({ field: "subflow", value: message.path });
			else if (message.type === "openLocation") {
				const kind = current.nodeKinds.get(message.nodeId);
				const meta = kind && current.frontmatter?.[kind]?.[message.nodeId];
				const locations = normalizeLocation(
					meta && "location" in meta ? meta.location : undefined,
				);
				const request = ++generation,
					version = model.getVersionId();
				const value =
					locations.length === 1
						? locations[0]
						: await prompt("Open location", locations);
				if (value && valid(request, version))
					await open({ field: "location", value });
			}
		},
		refresh: comparison.refresh,
		cancelPending() {
			generation++;
			comparison.cancelPending();
			cancelPanel?.();
		},
		locationChanged() {
			generation++;
			comparison.clear();
			cancelPanel?.();
		},
		dispose() {
			disposed = true;
			generation++;
			comparison.dispose();
			cancelPanel?.();
			banner.remove();
			for (const action of actions) action.dispose();
		},
	};
}

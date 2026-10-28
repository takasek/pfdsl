import type { DiskSnapshot, SaveResult } from "./document-session.js";
import type { createDocumentTab, DocumentTab } from "./document-tab.js";
import { createExportResults } from "./export-results.js";
import { createNativeExportServices } from "./export-services.js";
import type { MenuState, RecentTarget } from "./native-menu.js";
import { createNativeReferenceServices } from "./reference-services.js";
import type { createTextComparison } from "./text-comparison.js";
import { createWindowTitle } from "./window-title.js";
import {
	createWorkspaceController,
	type DecisionAnswer,
	type DecisionRequest,
	type WorkspaceCommand,
	type WorkspaceDocument,
	type WorkspaceSnapshot,
} from "./workspace-controller.js";

export type NativeInvoke = typeof import("@tauri-apps/api/core").invoke;
export interface NativeMenu {
	update(state: MenuState): void;
	recent(targets: RecentTarget[]): void;
	dispose(): void | Promise<void>;
}
export interface ApplicationOptions {
	document: Document;
	createDocumentTab: typeof createDocumentTab;
	createTextComparison: typeof createTextComparison;
	native?: {
		invoke: NativeInvoke;
		listen(
			event: string,
			callback: (event: { payload: string }) => void,
		): Promise<() => void>;
		installMenu(
			command: (id: string) => void,
			recent: (target: RecentTarget) => void,
			report: (error: unknown) => void,
			signal: AbortSignal,
		): Promise<NativeMenu>;
		verifyCorpus(signal: AbortSignal): Promise<{ path: string } | null>;
		setTitle(title: string): Promise<void>;
		closeWindow(): Promise<void>;
	};
	scheduler?: {
		setInterval(callback: () => void, delay: number): number;
		clearInterval(id: number): void;
	};
}

/** Each mounted host owns its documents, external callbacks and teardown. Importing is inert. */
export function mountApplication(options: ApplicationOptions) {
	const { document, createDocumentTab, createTextComparison } = options;
	const window = document.defaultView!;
	const lifetime = new window.AbortController();
	const scheduler = options.scheduler ?? window;
	let disposed = false;
	let currentCommand: Promise<unknown> = Promise.resolve();
	const cleanups = new Set<() => void>();
	const cancelDialogs = new Set<() => void>();
	const invoke: NativeInvoke = async (command, args) => {
		// Resource release is still permitted after disposal, including late selections.
		if (disposed && !["release_document", "release_export"].includes(command))
			throw new Error("Application disposed");
		if (!options.native)
			throw new Error("Use the desktop application for this operation.");
		return options.native.invoke(command, args);
	};
	const status = document.querySelector<HTMLElement>("#status")!;
	status.setAttribute("aria-live", "polite");
	status.setAttribute("aria-atomic", "true");
	const diagnostics = document.createElement("div");
	diagnostics.id = "diagnostics";
	diagnostics.setAttribute("role", "status");
	diagnostics.setAttribute("aria-live", "polite");
	diagnostics.setAttribute("aria-atomic", "true");
	status.before(diagnostics);
	const dismissStatus = document.createElement("button");
	dismissStatus.id = "dismiss-status";
	dismissStatus.textContent = "Dismiss action notice";
	dismissStatus.hidden = true;
	status.after(dismissStatus);
	const presentExportResults = createExportResults(document.body, report);
	const showExportResults: typeof presentExportResults = (...args) => {
		if (!disposed) presentExportResults(...args);
	};
	const tabs = document.querySelector<HTMLElement>("#tabs")!;
	const documents = document.querySelector<HTMLElement>("#documents")!;
	const conflicts = document.querySelector<HTMLElement>("#conflicts")!;
	const native = options.native;
	const updateNativeTitle = createWindowTitle(
		async (title) => {
			if (!disposed) await native?.setTitle(title);
		},
		(error) => report(`Could not update the window title: ${String(error)}`),
	);
	let nativeMenu: NativeMenu | undefined;
	let state: WorkspaceSnapshot;
	interface Entry {
		key: string;
		tab: DocumentTab;
		navigation: HTMLElement;
		readonly state: WorkspaceDocument;
		readonly name: string;
		readonly path: string | null;
	}
	// UI objects do not determine membership; every traversal uses the controller snapshot.
	const entries = new Map<string, Entry>();
	const opened = () => state.documents.map((item) => entries.get(item.key)!);
	let active: Entry | undefined;
	let busy = false;
	let folderRoot: string | undefined;
	let recentTargets: RecentTarget[] = [];
	let saveCapability = { save: false, reason: "" };
	const saveSupport = document.querySelector<HTMLElement>("#save-support")!;
	function updateSaveControls() {
		if (disposed) return;
		saveSupport.textContent = saveCapability.reason;
		updateMenu();
	}
	const controller = createWorkspaceController({
		files: {
			chooseDocument: () => {
				if (!native)
					return Promise.reject(
						new Error("Use the desktop application to choose a file."),
					);
				return invoke<DiskSnapshot | null>("select_document");
			},
			openPath: (path, recent) =>
				invoke<DiskSnapshot>(recent ? "open_recent" : "open_document", {
					path,
				}),
			chooseSaveTarget: (name) =>
				invoke<DiskSnapshot | null>("choose_save_target", { name }),
			inspect: (id) => invoke<DiskSnapshot>("inspect_document", { id }),
			save: (request) => invoke<SaveResult>("save_document", request),
			release: (id) => invoke("release_document", { id }),
		},
		editors: {
			create(initial, events) {
				const { key, name, source, location } = initial;
				let renderedLocation = JSON.stringify([location?.id, location?.path]);
				const tab = createDocumentTab({
					parent: documents,
					key,
					name,
					source,
					path: location?.path ?? null,
					read: readFor(location?.id),
					referenceServices: native
						? createNativeReferenceServices(
								() =>
									controller
										.snapshot()
										.documents.find((item) => item.key === key)?.location?.id,
								() =>
									!disposed &&
									!state.busy &&
									state.active === key &&
									state.documents.some((item) => item.key === key),
								(snapshot, isCurrent) => controller.accept(snapshot, isCurrent),
								invoke,
							)
						: undefined,
					exportServices: native
						? createNativeExportServices(invoke)
						: undefined,
					showExportResults,
					reportStatus: events.notice,
					onChange: events.changed,
				});
				const navigation = document.createElement("span");
				navigation.className = "document-tab";
				navigation.setAttribute("role", "none");
				const close = document.createElement("button");
				close.className = "close-document";
				close.textContent = "×";
				close.setAttribute("aria-label", `Close ${name}`);
				close.setAttribute("tabindex", "-1");
				navigation.append(tab.button, close);
				tabs.append(navigation);
				const entry: Entry = {
					key,
					tab,
					navigation,
					get state() {
						return state.documents.find((item) => item.key === key)!;
					},
					get name() {
						return this.state.name;
					},
					get path() {
						return this.state.location?.path ?? null;
					},
				};
				entries.set(key, entry);
				tab.button.onclick = () => {
					void controller.dispatch({ type: "activate", key });
				};
				close.onclick = () => {
					void dispatch({ type: "close", keys: [key] });
				};
				return {
					getSource: () => tab.getSource(),
					getRevision: () => tab.getRevision(),
					setSource: (value) => tab.setSource(value),
					markSaved: (value) => tab.markSaved(value),
					setLocation(path, name, id) {
						const next = JSON.stringify([id, path]);
						if (next === renderedLocation) return;
						renderedLocation = next;
						tab.setLocation(path, name, readFor(id));
					},
					dispose() {
						tab.dispose();
						navigation.remove();
						entries.delete(key);
					},
				};
			},
		},
		decisions: { request: presentDecision },
		...(native
			? {
					host: {
						capabilities: () =>
							invoke<{ save: boolean; reason: string | null }>(
								"document_capabilities",
							),
						recent: () => invoke<RecentTarget[]>("list_recent"),
						rememberDocument: (path: string) =>
							invoke<void>("remember_document", { path }),
						chooseFolder: () => invoke<string | null>("select_folder"),
						openRecentFolder: (path: string) =>
							invoke<string>("open_recent_folder", { path }),
						listDocuments: () => invoke<string[]>("list_documents"),
						rememberFolder: (path: string) =>
							invoke<void>("remember_folder", { path }),
						finishQuit: (request: string, approved: boolean) =>
							invoke<void>("finish_app_exit", { request, approved }),
					},
				}
			: {}),
	});
	state = controller.snapshot();
	function dispatch(command: WorkspaceCommand) {
		const result = controller.dispatch(command);
		currentCommand = result;
		return result;
	}
	let renderedFolder: WorkspaceSnapshot["folder"] = null;
	function render(next: WorkspaceSnapshot) {
		if (disposed) return;
		const previousActive = active;
		const recentChanged = state.recentTargets !== next.recentTargets;
		state = next;
		busy = next.busy;
		active = entries.get(next.active ?? "");
		saveCapability = { ...next.saveCapability };
		recentTargets = next.recentTargets.map((target) => ({ ...target }));
		if (recentChanged) nativeMenu?.recent(recentTargets);
		if (renderedFolder !== next.folder) {
			renderedFolder = next.folder;
			if (next.folder) showFolder(next.folder);
		}
		if (active !== previousActive) {
			for (const entry of opened()) {
				if (entry !== active) entry.tab.deactivate?.();
				entry.tab.container.style.display = entry === active ? "flex" : "none";
				entry.tab.button.setAttribute(
					"aria-selected",
					String(entry === active),
				);
			}
			active?.tab.activate();
			if (active) {
				const viewport = tabs.getBoundingClientRect(),
					tab = active.navigation.getBoundingClientRect();
				if (tab.left < viewport.left)
					tabs.scrollLeft += tab.left - viewport.left;
				else if (tab.right > viewport.right)
					tabs.scrollLeft += Math.min(
						tab.right - viewport.right,
						tab.left - viewport.left,
					);
			}
		}
		for (const button of document.querySelectorAll<HTMLButtonElement>(
			"#sidebar, #files button, .close-document, [data-start], #try-sample",
		))
			button.disabled = busy;
		renderWorkspace();
		renderConflict();
	}
	function renderStatus() {
		if (disposed) return;
		const lines = [...opened()].flatMap((entry) =>
			entry.state.saveNotice
				? [
						`Save needs attention — ${entry.path ?? entry.name}: ${entry.state.saveNotice.message}`,
					]
				: [],
		);
		if (active?.state.notice)
			lines.push(
				`Last action — ${active.path ?? active.name}: ${active.state.notice.message}`,
			);
		if (state.appNotice) lines.push(`Application notice: ${state.appNotice}`);
		const text = lines.join("\n");
		if (status.textContent !== text) status.textContent = text;
		dismissStatus.hidden = !active?.state.notice && !state.appNotice;
		const summary = active
			? `Current diagnostics — ${active.path ?? active.name}: ${active.tab.getDiagnosticsSummary?.() ?? "Checking…"}`
			: "";
		if (diagnostics.textContent !== summary) diagnostics.textContent = summary;
	}
	dismissStatus.onclick = () => {
		void dispatch({ type: "dismiss" });
	};
	const readFor =
		(id: number | undefined) =>
		async (path: string): Promise<string | null> => {
			try {
				return await invoke<string>(
					id === undefined ? "read_document" : "read_dependency",
					{ id, path },
				);
			} catch {
				return null;
			}
		};
	function report(error: unknown) {
		if (disposed) return;
		controller.notify(String(error));
	}
	function basename(path: string) {
		return path.split("/").pop()!;
	}
	function updateMenu() {
		if (disposed) return;
		const sidebar =
			!document.querySelector<HTMLElement>("#folder-sidebar")!.hidden;
		const toggle = document.querySelector<HTMLButtonElement>("#sidebar")!;
		toggle.hidden = !folderRoot;
		toggle.disabled = busy || !folderRoot;
		toggle.setAttribute("aria-expanded", String(sidebar));
		toggle.setAttribute(
			"aria-label",
			sidebar ? "Hide sidebar" : "Show sidebar",
		);
		nativeMenu?.update({
			busy,
			document: !!active,
			save: saveCapability.save,
			folder: !!folderRoot,
			sidebar,
			diagram: active?.tab.canDiagram() ?? false,
			definition: active?.tab.canCreateDefinition() ?? false,
		});
	}
	function renderWorkspace() {
		if (disposed) return;
		for (const entry of opened()) {
			entry.navigation.classList.toggle("selected", entry === active);
			const sameName = [...opened()].filter(
				(other) => other.name === entry.name,
			);
			let visibleName = entry.name;
			if (sameName.length > 1 && entry.path) {
				const parents = sameName
					.filter((other) => other.path)
					.map((other) => other.path!.split("/").slice(0, -1));
				const parent = entry.path.split("/").slice(0, -1);
				let depth = 1;
				while (
					depth < parent.length &&
					parents.filter(
						(parts) =>
							parts.slice(-depth).join("/") === parent.slice(-depth).join("/"),
					).length > 1
				)
					depth++;
				visibleName += ` — ${parent.slice(-depth).join("/") || "/"}`;
			}
			entry.tab.button.textContent = `${visibleName}${entry.state.dirty ? " •" : ""}`;
			entry.tab.button.title = entry.path ?? `${entry.name} — Not saved`;
			entry.navigation
				.querySelector(".close-document")!
				.setAttribute("aria-label", `Close ${entry.name}`);
		}
		document.querySelector<HTMLElement>("#start-screen")!.hidden = !!active;
		document.querySelector<HTMLElement>("#documents")!.hidden = !active;
		document.querySelector<HTMLElement>("#document-state")!.textContent =
			!active
				? ""
				: active.state.conflict
					? "External change — review required"
					: !active.path
						? "Not saved"
						: active.state.dirty
							? "Modified"
							: "Saved";
		const location = document.querySelector<HTMLElement>("#document-location")!;
		location.textContent =
			active?.path ?? (active ? "Not saved to a file" : "");
		location.title = active?.path ?? (active ? "Not saved to a file" : "");
		location.hidden = !active;
		document.title = active
			? `${active.tab.button.textContent} — PFDSL`
			: "PFDSL";
		if (native) updateNativeTitle(document.title);
		renderStatus();
		for (const file of document.querySelectorAll<HTMLButtonElement>(
			"#files button",
		))
			file.setAttribute("aria-current", String(file.title === active?.path));
		updateSaveControls();
	}
	function showFolder(folder: NonNullable<WorkspaceSnapshot["folder"]>) {
		folderRoot = folder.root;
		document.querySelector<HTMLElement>("#folder-sidebar")!.hidden = false;
		document.querySelector<HTMLElement>("#folder-title")!.textContent =
			basename(folder.root);
		document.querySelector<HTMLButtonElement>("#sidebar")!.title = folder.root;
		const list = document.querySelector<HTMLElement>("#files")!;
		list.replaceChildren();
		for (const path of folder.files) {
			const button = document.createElement("button");
			button.textContent = path.slice(folder.root.length + 1);
			button.title = path;
			button.onclick = () => {
				void dispatch({ type: "open-path", path });
			};
			list.append(button);
		}
	}
	async function presentDecision(
		request: DecisionRequest,
		signal: AbortSignal,
	): Promise<DecisionAnswer> {
		if (signal.aborted) return "cancel";
		if (request.kind === "close")
			return invoke<"save" | "discard" | "cancel">("confirm_close_document", {
				name: request.name,
				allowSave: request.allowSave,
			});
		let answer: string;
		if (request.kind === "replace")
			answer = await choose(
				"Review the target",
				`Replace the disk version of ${request.target.path} with the editor content? The disk version shown below differs from the editor, and a further change before saving stops the save. Replace Observed Version writes the editor content to this file and resolves this target only after the revision is confirmed. Keep Editing closes this comparison without writing; editor content and unresolved changes remain. Choose Another File opens Save As; cancelling retains the current content and unresolved state. A further disk or editor change stops the save.`,
				[
					["cancel", "Keep Editing"],
					["another", "Choose Another File"],
					["replace", "Replace Observed Version"],
				],
				{ local: request.editor, disk: request.target.source },
			);
		else if (request.kind === "recreate")
			answer = await choose(
				"Recreate missing file",
				`Create ${request.target.path} again? A file created by another writer will not be overwritten.`,
				[
					["cancel", "Keep Editing"],
					["create", "Create File"],
				],
			);
		else
			answer = await choose(
				"Discard editor changes",
				`Replace the editor content with the observed current disk version of ${request.target.path}? Use Disk Version retains that disk version without writing and replaces the editor content after a fresh revision check. This resolves the matching external change; any separate unresolved target remains. Keep Editing closes this comparison without writing or replacing the editor; unresolved changes remain.`,
				[
					["cancel", "Keep Editing"],
					["disk", "Use Disk Version"],
				],
				{ local: request.editor, disk: request.target.source },
			);
		return answer as DecisionAnswer;
	}
	function choose(
		title: string,
		message: string,
		choices: Array<[string, string]>,
		comparison?: { local: string; disk: string | null },
	): Promise<string> {
		if (disposed) return Promise.resolve("cancel");
		const dialog = document.createElement("dialog");
		const origin = document.activeElement as HTMLElement | null;
		const heading = document.createElement("h2");
		heading.textContent = title;
		const text = document.createElement("p");
		text.textContent = message;
		dialog.append(heading, text);
		let comparisonView: ReturnType<typeof createTextComparison> | undefined;
		const buttons = document.createElement("div");
		buttons.className = "dialog-actions";
		dialog.append(buttons);
		document.body.append(dialog);
		return new Promise((resolve) => {
			let settled = false;
			const finish = (choice: string) => {
				if (settled) return;
				settled = true;
				cancelDialogs.delete(cancel);
				comparisonView?.dispose();
				dialog.close();
				dialog.remove();
				if (!disposed && origin?.isConnected) origin.focus();
				else active?.tab.focus?.();
				resolve(choice);
			};
			const cancel = () => finish("cancel");
			cancelDialogs.add(cancel);
			for (const [value, name] of choices) {
				const button = document.createElement("button");
				button.textContent = name;
				button.onclick = () => finish(value);
				buttons.append(button);
			}
			dialog.oncancel = (event) => {
				event.preventDefault();
				finish("cancel");
			};
			if (comparison)
				comparisonView = createTextComparison(
					dialog,
					comparison.local,
					comparison.disk,
				);
			dialog.showModal();
		});
	}
	let renderedEntry: Entry | undefined;
	let renderedState = "";
	function renderConflict() {
		if (disposed) return;
		const panel = active?.state.conflict ?? null;
		const state = active ? JSON.stringify([panel, saveCapability.save]) : "";
		if (active === renderedEntry && state === renderedState) return;
		renderedEntry = active;
		renderedState = state;
		conflicts.replaceChildren();
		if (!active) return;
		const entry = active;
		if (panel) {
			const message = document.createElement("p");
			message.textContent = `${panel.state} ${panel.message} Recovery target: ${panel.targetPath}.`;
			conflicts.append(message);
			const preview = document.createElement("details");
			const summary = document.createElement("summary");
			summary.textContent = "Observed external version";
			const text = document.createElement("pre");
			// Compare against the snapshot the buttons below act on.
			const observed = panel.observed;
			text.textContent = observed
				? (observed.source ?? "File is missing")
				: "The current disk content could not be confirmed.";
			preview.append(summary, text);
			conflicts.append(preview);
			const replace = document.createElement("button");
			replace.textContent = "Review and Save Here…";
			replace.disabled = !panel.actions.review;
			replace.title = saveCapability.reason;
			replace.onclick = () => {
				void dispatch({ type: "save", key: entry.key, mode: "observed" });
			};
			const another = document.createElement("button");
			another.textContent = "Save As…";
			another.disabled = !panel.actions.saveAs;
			another.title = saveCapability.reason;
			another.onclick = () => {
				void dispatch({ type: "save", key: entry.key, mode: "as" });
			};
			const use = document.createElement("button");
			use.textContent = "Use Current Disk Version…";
			use.disabled = !panel.actions.adopt;
			use.onclick = () => {
				void dispatch({ type: "adopt", key: entry.key });
			};
			conflicts.append(replace, another, use);
			if (panel.originalChanged) {
				const notice = document.createElement("p");
				notice.textContent = `The original document ${panel.originalChanged} also changed. Its disk version is preserved. Resolve the Save As target above, or save the editor elsewhere.`;
				conflicts.append(notice);
			}
		}
	}
	const commands: Record<string, () => void> = {
		new() {
			void dispatch({ type: "new" }).then(() => active?.tab.focus());
		},
		format: () => active?.tab.format(),
		"format-flat": () => active?.tab.format("flat"),
		normalize: () => active?.tab.normalize(),
		save() {
			void dispatch({ type: "save" });
		},
		"save-as"() {
			void dispatch({ type: "save", mode: "as" });
		},
		"open-file"() {
			void dispatch({ type: "open-file" });
		},
		open() {
			void dispatch({ type: "open-folder" });
		},
		sidebar() {
			if (!folderRoot) return;
			const sidebar = document.querySelector<HTMLElement>("#folder-sidebar")!;
			sidebar.hidden = !sidebar.hidden;
			updateMenu();
			active?.tab.activate();
		},
	};
	// WebView owns this shortcut: a native accelerator as well could switch twice.
	document.addEventListener(
		"keydown",
		(event) => {
			if (
				event.isComposing ||
				busy ||
				document.querySelector("dialog[open], .reference-dialog") ||
				!event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.key !== "Tab" ||
				!active
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			performCommand(event.shiftKey ? "previous-tab" : "next-tab");
		},
		{ capture: true, signal: lifetime.signal },
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.isComposing || (nativeMenu && event.isTrusted)) return;
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
				event.preventDefault();
				performCommand(event.shiftKey ? "save-as" : "save");
			}
		},
		{ signal: lifetime.signal },
	);
	document.querySelector<HTMLButtonElement>("#sidebar")!.onclick = () => {
		performCommand("sidebar");
	};
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"[data-start]",
	))
		button.onclick = () => performCommand(button.dataset.start!);
	document.querySelector<HTMLButtonElement>("#try-sample")!.onclick = () => {
		if (disposed || busy) return;
		void dispatch({
			type: "new",
			name: "Sample",
			source: "---\ntitle: Sample flow\n---\nidea >> design -> plan\n",
		}).then(() => active?.tab.focus?.());
	};
	function performCommand(id: string) {
		if (disposed || busy || document.querySelector("dialog[open]")) return;
		const command = commands[id];
		if (command) {
			command();
			return;
		}
		if (id === "close-window") {
			if (native) currentCommand = native.closeWindow().catch(report);
			return;
		}
		if (!active) return;
		if (id === "close-tab") {
			void dispatch({ type: "close", keys: [active.key] }).then(() =>
				active?.tab.focus?.(),
			);
			return;
		}
		if (id === "next-tab" || id === "previous-tab") {
			void dispatch({
				type: "cycle",
				direction: id === "next-tab" ? "next" : "previous",
			}).then(() => active?.tab.focus?.());
			return;
		}
		const target = document.activeElement as HTMLElement | null;
		if (
			["undo", "redo", "delete"].includes(id) &&
			target?.matches("input,textarea") &&
			!target.closest(".monaco-editor")
		) {
			document.execCommand(id);
			return;
		}
		active.tab.command(id === "find" ? "actions.find" : id);
	}
	function openRecentTarget(target: RecentTarget) {
		void dispatch(
			target.kind === "folder"
				? { type: "open-folder", path: target.path }
				: { type: "open-path", path: target.path, recent: true },
		);
	}
	controller.subscribe(render);
	render(state);
	if (native)
		void native
			.installMenu(performCommand, openRecentTarget, report, lifetime.signal)
			.then((menu) => {
				if (disposed) {
					void Promise.resolve(menu.dispose()).catch(report);
					return;
				}
				nativeMenu = menu;
				menu.recent(recentTargets);
				updateMenu();
			})
			.catch(report);
	updateSaveControls();
	if (native) {
		void native
			.verifyCorpus(lifetime.signal)
			.then(async (entry) => {
				if (entry && !disposed)
					await controller.accept(
						await invoke<DiskSnapshot>("open_document", { path: entry.path }),
					);
			})
			.catch((error) => report(`Verification failed: ${String(error)}`));
		void native
			.listen("pfdsl-quit-requested", ({ payload }) => {
				const foreground = !busy;
				const request = controller.requestQuit(payload);
				if (foreground) currentCommand = request;
			})
			.then((unlisten) => {
				if (disposed) {
					unlisten();
					return;
				}
				cleanups.add(unlisten);
				return invoke("exit_listener_ready");
			})
			.catch(report);
		const check = () => controller.refresh();
		const interval = scheduler.setInterval(() => {
			void check();
		}, 1_000);
		cleanups.add(() => scheduler.clearInterval(interval));
		window.addEventListener(
			"focus",
			() => {
				void check();
			},
			{ signal: lifetime.signal },
		);
	}

	return {
		/** Dispatch immediately; false means the host refused the command. */
		command(id: string): Promise<boolean> {
			if (disposed || busy || document.querySelector("dialog[open]"))
				return Promise.resolve(false);
			performCommand(id);
			return currentCommand.then(() => true);
		},
		/** Wait for the current accepted command and its document-handle cleanup. */
		async idle() {
			await currentCommand;
			await controller.idle();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			lifetime.abort();
			for (const cleanup of cleanups) cleanup();
			cleanups.clear();
			void Promise.resolve(nativeMenu?.dispose()).catch(report);
			for (const cancel of cancelDialogs) cancel();
			controller.dispose();
			active = undefined;
			diagnostics.remove();
			dismissStatus.remove();
			status.textContent = "";
			conflicts.replaceChildren();
			document.querySelectorAll(".export-results").forEach((panel) => {
				panel.remove();
			});
			for (const element of document.querySelectorAll<HTMLElement>(
				"#sidebar, [data-start], #try-sample",
			))
				element.onclick = null;
		},
	};
}

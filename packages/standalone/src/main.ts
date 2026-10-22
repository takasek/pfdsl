import { previewStyles } from "@pfdsl/editor";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { verifyNativeCorpus } from "./acceptance.js";
import {
	closeDocuments,
	type DiskSnapshot,
	DocumentSession,
	type OperationPlan,
	type SaveResult,
	sameDocument,
} from "./document-session.js";
import { createDocumentTab, type DocumentTab } from "./document-tab.js";
import { createExportResults } from "./export-results.js";
import { nativeExportServices } from "./export-services.js";
import { createNativeReferenceServices } from "./reference-services.js";
import "./style.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installNativeMenu, type RecentTarget } from "./native-menu.js";
import { createTextComparison } from "./text-comparison.js";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};
const style = document.createElement("style");
style.textContent = previewStyles;
document.head.append(style);
const status = document.querySelector<HTMLElement>("#status")!;
const showExportResults = createExportResults(document.body, report);
const tabs = document.querySelector<HTMLElement>("#tabs")!;
const documents = document.querySelector<HTMLElement>("#documents")!;
const conflicts = document.querySelector<HTMLElement>("#conflicts")!;
const native = "__TAURI_INTERNALS__" in window;
let nativeMenu: Awaited<ReturnType<typeof installNativeMenu>> | undefined;
let folderRoot: string | undefined;
let recentTargets: RecentTarget[] = [];
let saveCapability = {
	save: false,
	reason: native
		? "Checking document saving support…"
		: "Use the desktop application to save files.",
};
const saveSupport = document.querySelector<HTMLElement>("#save-support")!;
function updateSaveControls() {
	saveSupport.textContent = saveCapability.reason;
	updateMenu();
}
async function loadSaveCapability() {
	const previousReason = saveCapability.reason;
	try {
		const capability = await invoke<{ save: boolean; reason: string | null }>(
			"document_capabilities",
		);
		if (
			typeof capability?.save !== "boolean" ||
			(!capability.save &&
				(typeof capability.reason !== "string" || !capability.reason.trim()))
		) {
			throw new Error("Invalid document saving capability");
		}
		saveCapability = {
			save: capability.save,
			reason: capability.save ? "" : capability.reason!,
		};
	} catch (error) {
		saveCapability = {
			save: false,
			reason: `Could not determine document saving support: ${String(error)}. Saving is disabled.`,
		};
	}
	if (status.textContent === previousReason)
		status.textContent = saveCapability.save
			? "Document saving is available."
			: saveCapability.reason;
	updateSaveControls();
	renderConflict();
}
interface Entry {
	tab: DocumentTab;
	session: DocumentSession;
	name: string;
	navigation: HTMLElement;
	path: string | null;
	documentID: number | undefined;
}
const opened = new Set<Entry>();
const documentHandles = new Set<number>();
async function releaseUnusedDocuments() {
	for (const id of documentHandles) {
		// An acceptance document can arrive while an earlier release is pending.
		if ([...opened].some(({ session }) => session.usesDocument(id))) continue;
		await invoke("release_document", { id });
		documentHandles.delete(id);
	}
}
let active: Entry | undefined;
let serial = 0;
let busy = false;
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
	status.textContent = String(error);
}
function basename(path: string) {
	return path.split("/").pop()!;
}
function updateMenu() {
	const sidebar =
		!document.querySelector<HTMLElement>("#folder-sidebar")!.hidden;
	const toggle = document.querySelector<HTMLButtonElement>("#sidebar")!;
	toggle.hidden = !folderRoot;
	toggle.disabled = busy || !folderRoot;
	toggle.setAttribute("aria-expanded", String(sidebar));
	toggle.setAttribute("aria-label", sidebar ? "Hide sidebar" : "Show sidebar");
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
	for (const entry of opened) {
		entry.navigation.classList.toggle("selected", entry === active);
		const sameName = [...opened].filter((other) => other.name === entry.name);
		const visibleName =
			sameName.length > 1 && entry.path
				? `${entry.name} — ${entry.path.slice(0, entry.path.lastIndexOf("/"))}`
				: entry.name;
		entry.tab.button.textContent = `${visibleName}${entry.session.isDirty() ? " •" : ""}`;
		entry.tab.button.title = entry.path ?? `${entry.name} — Not saved`;
	}
	document.querySelector<HTMLElement>("#start-screen")!.hidden = !!active;
	document.querySelector<HTMLElement>("#documents")!.hidden = !active;
	document.querySelector<HTMLElement>("#document-state")!.textContent = !active
		? ""
		: active.session.panel()
			? "External change — review required"
			: !active.path
				? "Not saved"
				: active.session.isDirty()
					? "Modified"
					: "Saved";
	const location = document.querySelector<HTMLElement>("#document-location")!;
	location.textContent = active?.path ?? (active ? "Not saved to a file" : "");
	location.title = active?.path ?? (active ? "Not saved to a file" : "");
	location.hidden = !active;
	document.title = active ? `${active.name} — PFDSL` : "PFDSL";
	for (const file of document.querySelectorAll<HTMLButtonElement>(
		"#files button",
	))
		file.setAttribute("aria-current", String(file.title === active?.path));
	updateSaveControls();
}
function syncLocation(entry: Entry) {
	const disk = entry.session.location;
	if (!disk) return;
	const name = basename(disk.path);
	if (
		entry.path !== disk.path ||
		entry.name !== name ||
		entry.documentID !== disk.id
	) {
		entry.name = name;
		entry.path = disk.path;
		entry.documentID = disk.id;
		entry.tab.setLocation(disk.path, name, readFor(disk.id));
	}
	entry.tab.markSaved(entry.session.savedSource);
	entry.navigation
		.querySelector(".close-document")!
		.setAttribute("aria-label", `Close ${entry.name}`);
}
function activate(entry: Entry) {
	active = entry;
	for (const other of opened) {
		if (other !== entry) other.tab.deactivate?.();
		other.tab.container.style.display = other === entry ? "flex" : "none";
		other.tab.button.setAttribute("aria-selected", String(other === entry));
	}
	entry.tab.activate();
	renderWorkspace();
	renderConflict();
	const bar = document.querySelector<HTMLElement>("#tabs")!;
	const viewport = bar.getBoundingClientRect();
	const tab = entry.navigation.getBoundingClientRect();
	if (tab.left < viewport.left) bar.scrollLeft += tab.left - viewport.left;
	else if (tab.right > viewport.right)
		bar.scrollLeft += Math.min(
			tab.right - viewport.right,
			tab.left - viewport.left,
		);
}
function run(action: () => Promise<unknown>) {
	if (busy) return;
	busy = true;
	updateMenu();
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"#sidebar, #files button, .close-document, [data-start], #try-sample",
	))
		button.disabled = true;
	void action()
		.catch(report)
		.finally(async () => {
			await releaseUnusedDocuments().catch(report);
			busy = false;
			for (const button of document.querySelectorAll<HTMLButtonElement>(
				"#files button, .close-document, [data-start], #try-sample",
			))
				button.disabled = false;
			updateSaveControls();
			renderWorkspace();
			renderConflict();
		});
}
function openDocument(name: string, source: string, disk: DiskSnapshot | null) {
	const existing =
		disk &&
		[...opened].find(
			(entry) => entry.session.disk && sameDocument(entry.session.disk, disk),
		);
	if (existing) {
		if (existing.session.rebindDisk(disk)) {
			syncLocation(existing);
			renderWorkspace();
			void remember(disk.path).catch(report);
		}
		activate(existing);
		return;
	}
	let entry: Entry | undefined;
	const tab = createDocumentTab({
		parent: documents,
		key: `document-${++serial}`,
		name,
		source,
		path: disk?.path ?? null,
		read: readFor(disk?.id),
		referenceServices: native
			? createNativeReferenceServices(
					() => entry?.session.location?.id,
					() => !!entry && !busy && opened.has(entry) && active === entry,
					async (snapshot, isCurrent) => {
						try {
							await openSnapshot(snapshot, isCurrent);
						} finally {
							await releaseUnusedDocuments();
						}
					},
				)
			: undefined,
		exportServices: native ? nativeExportServices : undefined,
		showExportResults,
		reportStatus: (message) =>
			report(entry ? `${entry.name}: ${message}` : message),
		onChange: () => {
			if (entry) renderWorkspace();
		},
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
	entry = {
		tab,
		session: new DocumentSession(tab, disk),
		name,
		navigation,
		path: disk?.path ?? null,
		documentID: disk?.id,
	};
	const current = entry;
	opened.add(current);
	tab.button.onclick = () => activate(current);
	close.onclick = () => run(() => closeEntries([current]));
	activate(current);
	if (disk) void remember(disk.path).catch(report);
}
async function openSnapshot(snapshot: DiskSnapshot, isCurrent = () => true) {
	try {
		if (!isCurrent()) return;
		if (snapshot.source === null)
			throw new Error(
				"This file is missing. Choose its new location or save the retained editor content elsewhere.",
			);
		if (
			![...opened].some(
				(entry) =>
					entry.session.disk && sameDocument(entry.session.disk, snapshot),
			)
		) {
			for (const entry of opened) {
				const previous = entry.session.location;
				if (!previous?.identity || previous.identity !== snapshot.identity)
					continue;
				// Equal inodes can be simultaneous hard links. Only a missing old leaf permits rename recovery.
				const current = await invoke<DiskSnapshot>("inspect_document", {
					id: previous.id,
				}).catch(() => null);
				if (!isCurrent()) return;
				if (!opened.has(entry) || entry.session.location?.id !== previous.id)
					continue;
				if (
					current?.source === null &&
					entry.session.rebindDisk(snapshot, true)
				) {
					syncLocation(entry);
					renderWorkspace();
					// Rebinding/activation may invalidate this operation's own origin.
					openDocument(basename(snapshot.path), snapshot.source, snapshot);
					return;
				}
			}
		}
		if (!isCurrent()) return;
		openDocument(basename(snapshot.path), snapshot.source, snapshot);
	} finally {
		// Before adoption this function is the sole owner; the normal sweep cannot release it.
		if ([...opened].some(({ session }) => session.usesDocument(snapshot.id))) {
			documentHandles.add(snapshot.id);
		} else {
			await invoke("release_document", { id: snapshot.id });
		}
	}
}
async function remember(path: string) {
	await invoke("remember_document", { path });
	await refreshRecent();
}
async function refreshRecent() {
	if (!native) return;
	const recent =
		await invoke<Array<{ kind: "file" | "folder"; path: string }>>(
			"list_recent",
		);
	recentTargets = recent;
	nativeMenu?.recent(recentTargets);
}
async function showFolder(root: string) {
	const paths = await invoke<string[]>("list_documents");
	folderRoot = root;
	document.querySelector<HTMLElement>("#folder-sidebar")!.hidden = false;
	document.querySelector<HTMLElement>("#folder-title")!.textContent =
		basename(root);
	const toggle = document.querySelector<HTMLButtonElement>("#sidebar")!;
	toggle.disabled = false;
	toggle.title = root;
	updateMenu();
	const files = document.querySelector<HTMLElement>("#files")!;
	files.replaceChildren();
	for (const path of paths) {
		const button = document.createElement("button");
		button.textContent = path.slice(root.length + 1);
		button.title = path;
		button.onclick = () =>
			run(async () =>
				openSnapshot(await invoke<DiskSnapshot>("open_document", { path })),
			);
		files.append(button);
	}
	await invoke("remember_folder", { path: root });
	await refreshRecent();
	status.textContent = `Opened ${root}. Save documents explicitly.`;
}
function choose(
	title: string,
	message: string,
	choices: Array<[string, string]>,
	comparison?: { local: string; disk: string | null },
): Promise<string> {
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
			comparisonView?.dispose();
			dialog.close();
			dialog.remove();
			if (origin?.isConnected) origin.focus();
			else active?.tab.focus?.();
			resolve(choice);
		};
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
function otherOpenTarget(entry: Entry, target: DiskSnapshot) {
	return [...opened].find(
		(item) =>
			item !== entry &&
			item.session.disk &&
			sameDocument(item.session.disk, target),
	);
}
function explainOpenTarget(entry: Entry, target: DiskSnapshot) {
	const other = otherOpenTarget(entry, target);
	if (!other) return false;
	status.textContent = `The target is already open as ${other.name}. Both editor buffers are retained. Choose another file or close that tab explicitly.`;
	return true;
}
async function saveEntry(
	entry: Entry,
	as = false,
	observed = false,
	confirmation?: OperationPlan,
): Promise<boolean> {
	if (!saveCapability.save) {
		status.textContent = saveCapability.reason;
		return false;
	}
	const session = entry.session;
	const checkConfirmation = () => {
		if (confirmation && !session.holds(confirmation, "editor")) {
			status.textContent =
				"The document changed after the decision was asked. Editor content is retained; close it again.";
			return false;
		}
		return true;
	};
	let target = observed ? (session.panel()?.observed ?? null) : session.disk;
	// A target picked in the chooser has no acknowledged content to compare with.
	const chosen = as || !target;
	let inspected = false;
	if (chosen) {
		target = await invoke<DiskSnapshot | null>("choose_save_target", {
			name: entry.name.endsWith(".pfdsl") ? entry.name : `${entry.name}.pfdsl`,
		});
		if (!target) return false;
		documentHandles.add(target.id);
	} else {
		// The remembered snapshot may predate an external change; review what is on disk now.
		const remembered = target!;
		const scope = session.begin();
		let fresh: DiskSnapshot;
		try {
			fresh = await invoke<DiskSnapshot>("inspect_document", {
				id: remembered.id,
			});
		} catch (error) {
			session.observe(remembered, { error }, scope);
			renderWorkspace();
			renderConflict();
			status.textContent = `Could not read ${remembered.path}: ${String(error)}. The save was not attempted. Editor content is retained.`;
			return false;
		}
		// Even a no-op or reload exit must still belong to the Close Save decision.
		if (!checkConfirmation()) return false;
		const clean = !session.isDirty();
		const outcome = session.observe(remembered, { snapshot: fresh }, scope);
		target = fresh;
		// A clean editor has nothing to save: it follows the disk instead of replacing it.
		if (!observed && outcome === "reloaded") {
			syncLocation(entry);
			status.textContent =
				"Reloaded the current disk version; there was nothing to save.";
			renderWorkspace();
			renderConflict();
			return true;
		}
		// Normalized line endings still make a manual save write the editor text.
		if (
			!observed &&
			clean &&
			fresh.source !== null &&
			session.acknowledges(fresh) &&
			fresh.source === entry.tab.getSource()
		) {
			syncLocation(entry);
			status.textContent = "Already saved.";
			renderWorkspace();
			renderConflict();
			return true;
		}
		inspected = true;
	}
	if (explainOpenTarget(entry, target!)) return false;
	const selected = target!;
	if (!checkConfirmation()) return false;
	// Identical text leaves nothing to overwrite, so there is nothing to review.
	const review =
		selected.source !== null &&
		selected.source !== entry.tab.getSource() &&
		(chosen || observed || !session.acknowledges(selected));
	const recreate = !review && inspected && selected.source === null;
	const plan = session.plan(recreate ? "recreate" : "save", selected);
	if (review) {
		const decision = await choose(
			"Review the target",
			`Replace the disk version of ${selected.path} with the editor content? The disk version shown below differs from the editor, and a further change before saving stops the save. Replace Observed Version writes the editor content to this file and resolves this target only after the revision is confirmed. Keep Editing closes this comparison without writing; editor content and unresolved changes remain. Choose Another File opens Save As; cancelling retains the current content and unresolved state. A further disk or editor change stops the save.`,
			[
				["cancel", "Keep Editing"],
				["another", "Choose Another File"],
				["replace", "Replace Observed Version"],
			],
			{ local: plan.editor, disk: plan.disk },
		);
		if (decision === "another")
			return saveEntry(entry, true, false, confirmation);
		if (decision !== "replace") return false;
	} else if (recreate) {
		const decision = await choose(
			"Recreate missing file",
			`Create ${selected.path} again? A file created by another writer will not be overwritten.`,
			[
				["cancel", "Keep Editing"],
				["create", "Create File"],
			],
		);
		if (decision !== "create") return false;
	}
	const outcome = await session.save(plan, (request) =>
		invoke<SaveResult>("save_document", {
			id: request.target!.id,
			source: request.editor,
			expected: request.revision,
		}),
	);
	if (outcome.stale) {
		status.textContent =
			"The document changed while the review was open. Editor content is retained; review it again.";
		renderWorkspace();
		renderConflict();
		return false;
	}
	if (outcome.saved && session.disk) {
		syncLocation(entry);
		await remember(session.disk.path).catch((error) =>
			report(`Saved; recent targets could not be updated: ${String(error)}`),
		);
	}
	status.textContent = `${entry.name}: ${outcome.message || (outcome.saved ? "Saved." : "The save was not accepted. Editor content is retained.")}`;
	renderWorkspace();
	renderConflict();
	return outcome.saved;
}
let renderedEntry: Entry | undefined;
let renderedState = "";
function renderConflict() {
	const panel = active?.session.panel() ?? null;
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
		replace.disabled = !observed || !saveCapability.save;
		replace.title = saveCapability.reason;
		replace.onclick = () => run(() => saveEntry(entry, false, true));
		const another = document.createElement("button");
		another.textContent = "Save As…";
		another.disabled = !saveCapability.save;
		another.title = saveCapability.reason;
		another.onclick = () => run(() => saveEntry(entry, true));
		const use = document.createElement("button");
		use.textContent = "Use Current Disk Version…";
		use.disabled = !observed || observed.source === null;
		use.onclick = () => run(() => useDiskVersion(entry));
		conflicts.append(replace, another, use);
		if (panel.originalChanged) {
			const notice = document.createElement("p");
			notice.textContent = `The original document ${panel.originalChanged} also changed. Its disk version is preserved. Resolve the Save As target above, or save the editor elsewhere.`;
			conflicts.append(notice);
		}
	}
}
/** Replaces the editor with the version the panel shows, after a fresh read confirms it. */
async function useDiskVersion(entry: Entry) {
	const session = entry.session;
	const observed = session.panel()?.observed;
	if (!observed || explainOpenTarget(entry, observed)) return;
	const plan = session.plan("adopt", observed);
	const choice = await choose(
		"Discard editor changes",
		`Replace the editor content with the observed current disk version of ${observed.path}? Use Disk Version retains that disk version without writing and replaces the editor content after a fresh revision check. This resolves the matching external change; any separate unresolved target remains. Keep Editing closes this comparison without writing or replacing the editor; unresolved changes remain.`,
		[
			["cancel", "Keep Editing"],
			["disk", "Use Disk Version"],
		],
		{ local: plan.editor, disk: plan.disk },
	);
	if (choice !== "disk") return;
	const scope = session.begin();
	let current: DiskSnapshot;
	try {
		current = await invoke<DiskSnapshot>("inspect_document", {
			id: observed.id,
		});
	} catch (error) {
		session.observe(observed, { error }, scope);
		throw error;
	}
	session.observe(observed, { snapshot: current }, scope);
	if (explainOpenTarget(entry, current)) return;
	if (!session.adopt(plan)) {
		status.textContent = session.holds(plan, "editor")
			? "The disk changed again. Review the new version."
			: "The editor changed during the read. Your new edits are retained; review again.";
		return;
	}
	syncLocation(entry);
	await remember(current.path).catch(report);
	renderWorkspace();
	status.textContent = "Reloaded the current disk version.";
}
function dispose(entry: Entry) {
	opened.delete(entry);
	entry.session.dispose();
	entry.tab.dispose();
	entry.navigation.remove();
	if (active === entry) {
		active = undefined;
		const next = [...opened].at(-1);
		if (next) activate(next);
	}
	renderConflict();
	renderWorkspace();
}
async function closeEntries(entries: Entry[]) {
	const membership = [...opened];
	return closeDocuments(
		entries.map((entry) =>
			Object.assign(entry, {
				isDirty: () => entry.session.isDirty(),
				prepareClose: async () => {
					// Finish an older poll, then read again for this close request.
					await entry.session.prepareClose();
					await entry.session
						.checkExternal((id) =>
							invoke<DiskSnapshot>("inspect_document", { id }),
						)
						.catch(report);
				},
				closeVersion: () => entry.session.closeVersion(),
				closePlan: () => entry.session.plan("close", null),
			}),
		),
		async (entry) =>
			invoke<"save" | "discard" | "cancel">("confirm_close_document", {
				name: entry.name,
				allowSave: saveCapability.save,
			}),
		(entry, plan) => saveEntry(entry, false, false, plan),
		dispose,
		() =>
			opened.size === membership.length &&
			membership.every((entry) => opened.has(entry)),
	);
}
const commands: Record<string, () => void> = {
	new() {
		const openNames = new Set([...opened].map((entry) => entry.name));
		let number = 1;
		while (openNames.has(`Untitled ${number}`)) number++;
		openDocument(`Untitled ${number}`, "", null);
		active?.tab.focus();
	},
	format: () => active?.tab.format(),
	"format-flat": () => active?.tab.format("flat"),
	normalize: () => active?.tab.normalize(),
	save: () =>
		run(async () => {
			if (active) await saveEntry(active);
		}),
	"save-as": () =>
		run(async () => {
			if (active) await saveEntry(active, true);
		}),
	"open-file": () =>
		run(async () => {
			if (!native)
				throw new Error("Use the desktop application to choose a file.");
			const snapshot = await invoke<DiskSnapshot | null>("select_document");
			if (snapshot) await openSnapshot(snapshot);
		}),
	open: () =>
		run(async () => {
			if (!native)
				throw new Error("Use the desktop application to choose a folder.");
			const root = await invoke<string | null>("select_folder");
			if (root) await showFolder(root);
		}),
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
	true,
);
document.addEventListener("keydown", (event) => {
	if (event.isComposing || (nativeMenu && event.isTrusted)) return;
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
		event.preventDefault();
		performCommand(event.shiftKey ? "save-as" : "save");
	}
});
document.querySelector<HTMLButtonElement>("#sidebar")!.onclick = () => {
	performCommand("sidebar");
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
	"[data-start]",
))
	button.onclick = () => performCommand(button.dataset.start!);
document.querySelector<HTMLButtonElement>("#try-sample")!.onclick = () => {
	if (busy) return;
	openDocument(
		"Sample",
		"---\ntitle: Sample flow\n---\nidea >> design -> plan\n",
		null,
	);
	active?.tab.focus?.();
};
function performCommand(id: string) {
	if (busy || document.querySelector("dialog[open]")) return;
	const command = commands[id];
	if (command) {
		command();
		return;
	}
	if (id === "close-window") {
		void getCurrentWindow().close().catch(report);
		return;
	}
	if (!active) return;
	if (id === "close-tab") {
		const entry = active;
		run(async () => {
			await closeEntries([entry]);
			active?.tab.focus?.();
		});
		return;
	}
	if (id === "next-tab" || id === "previous-tab") {
		const entries = [...opened];
		const index = entries.indexOf(active);
		activate(
			entries[
				(index + (id === "next-tab" ? 1 : entries.length - 1)) % entries.length
			]!,
		);
		active?.tab.focus?.();
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
	run(async () => {
		if (target.kind === "folder")
			await showFolder(
				await invoke<string>("open_recent_folder", { path: target.path }),
			);
		else
			await openSnapshot(
				await invoke<DiskSnapshot>("open_recent", { path: target.path }),
			);
	});
}
renderWorkspace();
if (native)
	void installNativeMenu(performCommand, openRecentTarget, report)
		.then((menu) => {
			nativeMenu = menu;
			menu.recent(recentTargets);
			updateMenu();
		})
		.catch(report);
updateSaveControls();
if (native) {
	void loadSaveCapability();
	void refreshRecent().catch(report);
	void verifyNativeCorpus()
		.then(async (entry) => {
			if (entry)
				await openSnapshot(
					await invoke<DiskSnapshot>("open_document", { path: entry.path }),
				);
		})
		.catch((error) => report(`Verification failed: ${String(error)}`));
	let closingRequest: string | null = null;
	let completedRequest = 0n;
	const refusingRequests = new Set<string>();
	void listen<string>("pfdsl-quit-requested", ({ payload: request }) => {
		// Native IDs increase monotonically; queued events from a completed request are stale.
		if (
			!/^[1-9][0-9]*$/.test(request) ||
			BigInt(request) <= completedRequest ||
			closingRequest === request ||
			refusingRequests.has(request)
		)
			return;
		if (busy || closingRequest !== null) {
			refusingRequests.add(request);
			void invoke("finish_app_exit", { request, approved: false })
				.then(() => {
					completedRequest =
						completedRequest > BigInt(request)
							? completedRequest
							: BigInt(request);
				})
				.catch(report)
				.finally(() => refusingRequests.delete(request));
			return;
		}
		closingRequest = request;
		run(async () => {
			let approved = false;
			try {
				approved = await closeEntries([...opened]);
			} finally {
				try {
					await invoke("finish_app_exit", { request, approved });
					completedRequest =
						completedRequest > BigInt(request)
							? completedRequest
							: BigInt(request);
				} finally {
					closingRequest = null;
				}
			}
		});
	})
		.then(() => invoke("exit_listener_ready"))
		.catch(report);
	const check = async () => {
		if (busy) return;
		for (const entry of opened) {
			if (busy) break;
			try {
				await entry.session.checkExternal((id) =>
					invoke<DiskSnapshot>("inspect_document", { id }),
				);
				if (opened.has(entry)) {
					syncLocation(entry);
					renderWorkspace();
				}
			} catch (error) {
				if (opened.has(entry)) renderWorkspace();
				report(
					`Could not check ${entry.name}: ${String(error)}. Editor content is retained.`,
				);
			}
		}
		renderConflict();
	};
	setInterval(() => {
		void check();
	}, 1_000);
	window.addEventListener("focus", () => {
		void check();
	});
}

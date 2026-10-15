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
import { createNativeReferenceServices } from "./reference-services.js";
import "./style.css";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};
const style = document.createElement("style");
style.textContent = previewStyles;
document.head.append(style);
const status = document.querySelector<HTMLElement>("#status")!;
const tabs = document.querySelector<HTMLElement>("#tabs")!;
const documents = document.querySelector<HTMLElement>("#documents")!;
const conflicts = document.querySelector<HTMLElement>("#conflicts")!;
const native = "__TAURI_INTERNALS__" in window;
let saveCapability = {
	save: false,
	reason: native
		? "Checking document saving support…"
		: "Use the desktop application to save files.",
};
const saveSupport = document.querySelector<HTMLElement>("#save-support")!;
function updateSaveControls() {
	for (const selector of ["#save", "#save-as"]) {
		const button = document.querySelector<HTMLButtonElement>(selector)!;
		button.disabled = busy || !saveCapability.save;
		button.title = saveCapability.reason;
	}
	saveSupport.textContent = saveCapability.reason;
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
function label(entry: Entry) {
	entry.tab.button.textContent = `${entry.name}${entry.session.isDirty() ? " •" : ""}`;
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
	renderConflict();
}
function run(action: () => Promise<unknown>) {
	if (busy) return;
	busy = true;
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"header button, #files button, #recent button, .close-document",
	))
		button.disabled = true;
	void action()
		.catch(report)
		.finally(async () => {
			await releaseUnusedDocuments().catch(report);
			busy = false;
			for (const button of document.querySelectorAll<HTMLButtonElement>(
				"header button, #files button, #recent button, .close-document",
			))
				button.disabled = false;
			updateSaveControls();
			if (active) label(active);
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
			label(existing);
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
		reportStatus: report,
		onChange: () => {
			if (entry) label(entry);
		},
	});
	const navigation = document.createElement("span");
	navigation.className = "document-tab";
	const close = document.createElement("button");
	close.className = "close-document";
	close.textContent = "×";
	close.setAttribute("aria-label", `Close ${name}`);
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
					label(entry);
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
	const container = document.querySelector<HTMLElement>("#recent")!;
	container.replaceChildren();
	for (const target of recent) {
		const button = document.createElement("button");
		button.textContent = `${target.kind === "folder" ? "Folder: " : ""}${basename(target.path)}`;
		button.title = target.path;
		button.onclick = () =>
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
		container.append(button);
	}
}
async function showFolder(root: string) {
	const paths = await invoke<string[]>("list_documents");
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
	const heading = document.createElement("h2");
	heading.textContent = title;
	const text = document.createElement("p");
	text.textContent = message;
	dialog.append(heading, text);
	if (comparison)
		for (const [label, value] of [
			["Editor content", comparison.local],
			["Observed disk content", comparison.disk ?? "File is missing"],
		] as const) {
			const caption = document.createElement("label");
			caption.textContent = label;
			const field = document.createElement("textarea");
			field.readOnly = true;
			field.value = value;
			caption.append(field);
			dialog.append(caption);
		}
	const buttons = document.createElement("div");
	buttons.className = "dialog-actions";
	dialog.append(buttons);
	document.body.append(dialog);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (choice: string) => {
			if (settled) return;
			settled = true;
			dialog.close();
			dialog.remove();
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
			label(entry);
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
			label(entry);
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
			label(entry);
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
			`Replace the disk version of ${selected.path} with the editor content? The disk version shown below differs from the editor, and a further change before saving stops the save.`,
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
		label(entry);
		renderConflict();
		return false;
	}
	if (outcome.saved && session.disk) {
		syncLocation(entry);
		await remember(session.disk.path).catch((error) =>
			report(`Saved; recent targets could not be updated: ${String(error)}`),
		);
	}
	status.textContent =
		outcome.message ||
		(outcome.saved
			? "Saved."
			: "The save was not accepted. Editor content is retained.");
	label(entry);
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
		`Replace the editor content with the observed current disk version of ${observed.path}?`,
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
	label(entry);
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
document.querySelector<HTMLButtonElement>("#new")!.onclick = () => {
	if (!busy) openDocument(`Untitled ${serial + 1}`, "", null);
};
document.querySelector<HTMLButtonElement>("#format")!.onclick = () => {
	if (!busy) active?.tab.format();
};
document.querySelector<HTMLButtonElement>("#format-flat")!.onclick = () => {
	if (!busy) active?.tab.format("flat");
};
document.querySelector<HTMLButtonElement>("#normalize")!.onclick = () => {
	if (!busy) active?.tab.normalize();
};
document.querySelector<HTMLButtonElement>("#save")!.onclick = () =>
	run(async () => {
		if (active) await saveEntry(active);
	});
document.querySelector<HTMLButtonElement>("#save-as")!.onclick = () =>
	run(async () => {
		if (active) await saveEntry(active, true);
	});
document.querySelector<HTMLButtonElement>("#open-file")!.onclick = () =>
	run(async () => {
		if (!native)
			throw new Error("Use the desktop application to choose a file.");
		const snapshot = await invoke<DiskSnapshot | null>("select_document");
		if (snapshot) await openSnapshot(snapshot);
	});
document.querySelector<HTMLButtonElement>("#open")!.onclick = () =>
	run(async () => {
		if (!native)
			throw new Error("Use the desktop application to choose a folder.");
		const root = await invoke<string | null>("select_folder");
		if (root) await showFolder(root);
	});
document.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
		event.preventDefault();
		run(async () => {
			if (active) await saveEntry(active, event.shiftKey);
		});
	}
});
openDocument(
	"Welcome",
	"---\ntitle: Welcome to PFDSL\n---\nidea >> design -> plan\n",
	null,
);
openDocument(
	"日本語",
	"---\ntitle: 日本語のフロー\nartifact:\n  input:\n    label: 入力\n  output:\n    label: 成果物\nprocess:\n  build:\n    label: 作成する\n---\ninput >> build -> output\n",
	null,
);
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
					label(entry);
				}
			} catch (error) {
				if (opened.has(entry)) label(entry);
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

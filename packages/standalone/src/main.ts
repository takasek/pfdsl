import { previewStyles } from "@pfdsl/editor";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { verifyNativeCorpus } from "./acceptance.js";
import {
	closeDocuments,
	type DiskSnapshot,
	DocumentSession,
	type SaveResult,
	sameDocument,
} from "./document-session.js";
import { createDocumentTab, type DocumentTab } from "./document-tab.js";
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
		if (
			[...opened].some(
				({ session }) =>
					session.disk?.id === id || session.pendingTarget?.id === id,
			)
		)
			continue;
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
	const disk = entry.session.disk;
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
			if (active) label(active);
			renderConflict();
		});
}
function openDocument(name: string, source: string, disk: DiskSnapshot | null) {
	if (disk) documentHandles.add(disk.id);
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
async function openSnapshot(snapshot: DiskSnapshot) {
	documentHandles.add(snapshot.id);
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
			const previous = entry.session.disk;
			if (!previous?.identity || previous.identity !== snapshot.identity)
				continue;
			// Equal inodes can be simultaneous hard links. Only a missing old leaf permits rename recovery.
			const current = await invoke<DiskSnapshot>("inspect_document", {
				id: previous.id,
			}).catch(() => null);
			if (
				current?.source === null &&
				entry.session.rebindDisk(snapshot, true)
			) {
				syncLocation(entry);
				label(entry);
				break;
			}
		}
	}
	openDocument(basename(snapshot.path), snapshot.source, snapshot);
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
): Promise<boolean> {
	if (!native) throw new Error("Use the desktop application to save files.");
	let target = observed ? entry.session.observed : entry.session.disk;
	if (as || !target) {
		target = await invoke<DiskSnapshot | null>("choose_save_target", {
			name: entry.name.endsWith(".pfdsl") ? entry.name : `${entry.name}.pfdsl`,
		});
		if (!target) return false;
		documentHandles.add(target.id);
	}
	if (explainOpenTarget(entry, target)) return false;
	if (target.source !== null && (as || observed || entry.session.conflict)) {
		const decision = await choose(
			"Review the target",
			`Replace the observed version of ${target.path}? A detected external change before saving will stop the save.`,
			[
				["cancel", "Keep Editing"],
				["another", "Choose Another File"],
				["replace", "Replace Observed Version"],
			],
			{ local: entry.tab.getSource(), disk: target.source },
		);
		if (decision === "another") return saveEntry(entry, true);
		if (decision !== "replace") return false;
	} else if (observed && target.source === null) {
		const decision = await choose(
			"Recreate missing file",
			`Create ${target.path} again? A file created by another writer will not be overwritten.`,
			[
				["cancel", "Keep Editing"],
				["create", "Create File"],
			],
		);
		if (decision !== "create") return false;
	}
	const selected = target;
	const saved = await entry.session.save(async (source) => {
		const result = await invoke<SaveResult>("save_document", {
			id: selected.id,
			source,
			expected: selected.revision,
		});
		return result;
	}, selected);
	if (saved && entry.session.disk) {
		const disk = entry.session.disk;
		syncLocation(entry);
		await remember(disk.path).catch((error) =>
			report(`Saved; recent targets could not be updated: ${String(error)}`),
		);
	}
	status.textContent =
		entry.session.message ||
		(saved
			? "Saved."
			: "The save was not accepted. Editor content is retained.");
	label(entry);
	renderConflict();
	return saved;
}
let renderedEntry: Entry | undefined;
let renderedState = "";
function renderConflict() {
	const state = active
		? JSON.stringify([
				active.session.message,
				active.session.conflict,
				active.session.observed,
				active.session.sourceConflict,
				active.session.saveFailure,
				active.session.pendingTarget,
			])
		: "";
	if (active === renderedEntry && state === renderedState) return;
	renderedEntry = active;
	renderedState = state;
	conflicts.replaceChildren();
	if (!active) return;
	const entry = active;
	if (entry.session.conflict || entry.session.saveFailure) {
		const message = document.createElement("p");
		const publication = entry.session.saveFailure?.publication;
		const state =
			publication === "published"
				? "Content was published, but the save was not accepted."
				: publication === "unknown"
					? "Whether content was published could not be confirmed."
					: "";
		message.textContent = `${state} ${entry.session.message} Recovery target: ${entry.session.pendingTarget?.path ?? entry.session.observed?.path ?? "unknown"}.`;
		conflicts.append(message);
		const preview = document.createElement("details");
		const summary = document.createElement("summary");
		summary.textContent = "Observed external version";
		const text = document.createElement("pre");
		text.textContent =
			entry.session.conflict?.source ??
			"The current disk content could not be confirmed.";
		preview.append(summary, text);
		conflicts.append(preview);
		const replace = document.createElement("button");
		replace.textContent = "Review and Save Here…";
		replace.disabled = !entry.session.observed;
		replace.onclick = () => run(() => saveEntry(entry, false, true));
		const another = document.createElement("button");
		another.textContent = "Save As…";
		another.onclick = () => run(() => saveEntry(entry, true));
		const use = document.createElement("button");
		use.textContent = "Use Current Disk Version…";
		use.disabled =
			!entry.session.observed || entry.session.observed.source === null;
		use.onclick = () =>
			run(async () => {
				const observed = entry.session.observed;
				if (!observed || explainOpenTarget(entry, observed)) return;
				const confirmedVersion = entry.session.closeVersion();
				const choice = await choose(
					"Discard editor changes",
					`Replace the editor content with the observed current disk version of ${observed.path}?`,
					[
						["cancel", "Keep Editing"],
						["disk", "Use Disk Version"],
					],
					{ local: entry.tab.getSource(), disk: observed.source },
				);
				if (choice !== "disk") return;
				const current = await invoke<DiskSnapshot>("inspect_document", {
					id: observed.id,
				});
				if (current.revision !== observed.revision) {
					entry.session.conflict = current;
					entry.session.observed = current;
					status.textContent =
						"The disk changed again. Review the new version.";
					return;
				}
				if (explainOpenTarget(entry, current)) return;
				if (!entry.session.useDiskIfUnchanged(current, confirmedVersion)) {
					status.textContent =
						"The editor changed during the read. Your new edits are retained; review again.";
					return;
				}
				syncLocation(entry);
				await remember(current.path).catch(report);
				label(entry);
				status.textContent = "Reloaded the current disk version.";
			});
		conflicts.append(replace, another, use);
	}
	if (entry.session.sourceConflict) {
		const notice = document.createElement("p");
		notice.textContent = `The original document ${entry.session.sourceConflict.path} also changed. Its disk version is preserved. Resolve the Save As target above, or save the editor elsewhere.`;
		conflicts.append(notice);
	}
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
			}),
		),
		async (entry) =>
			invoke<"save" | "discard" | "cancel">("confirm_close_document", {
				name: entry.name,
			}),
		saveEntry,
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
if (native) {
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
			if (entry.session.disk) {
				try {
					await entry.session.checkExternal((id) =>
						invoke<DiskSnapshot>("inspect_document", {
							id,
						}),
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

import {
	type DocumentRecord,
	DocumentRecords,
	documentName,
} from "./document-records.js";
import {
	closeDocuments,
	type DiskSnapshot,
	DocumentSession,
	type OperationPlan,
	sameDocument,
} from "./document-session.js";
import {
	createSaveAsController,
	type DocumentFiles,
} from "./save-as-controller.js";

export type WorkspaceCommand =
	| { type: "new"; name?: string; source?: string }
	| { type: "open-file" }
	| { type: "open-path"; path: string; recent?: boolean }
	| { type: "open-folder"; path?: string }
	| { type: "activate"; key: string }
	| { type: "cycle"; direction: "next" | "previous" }
	| { type: "save"; key?: string; mode?: "normal" | "as" | "observed" }
	| { type: "adopt"; key?: string }
	| { type: "close"; keys?: readonly string[] }
	| { type: "dismiss"; key?: string };

export interface WorkspaceEditor {
	getSource(): string;
	getRevision(): number | string;
	setSource(source: string): void;
	dispose(): void;
	setLocation?(path: string, name: string, id: number): void;
	markSaved?(source: string): void;
}
export interface WorkspaceEditors {
	create(
		initial: {
			key: string;
			name: string;
			source: string;
			location: Readonly<DiskSnapshot> | null;
		},
		events: {
			changed(): void;
			notice(message: string, channel?: string): void;
		},
	): WorkspaceEditor;
}
export interface WorkspaceFiles extends DocumentFiles {
	chooseDocument(): Promise<DiskSnapshot | null>;
	openPath(path: string, recent: boolean): Promise<DiskSnapshot>;
	inspect(id: number): Promise<DiskSnapshot>;
}
export interface WorkspaceHost {
	capabilities(): Promise<{ save: boolean; reason: string | null }>;
	recent(): Promise<Array<{ kind: "file" | "folder"; path: string }>>;
	rememberDocument(path: string): Promise<void>;
	chooseFolder(): Promise<string | null>;
	openRecentFolder(path: string): Promise<string>;
	listDocuments(): Promise<string[]>;
	rememberFolder(path: string): Promise<void>;
	finishQuit(request: string, approved: boolean): Promise<void>;
}
export type DecisionRequest =
	| {
			readonly kind: "replace" | "recreate" | "adopt";
			readonly document: string;
			readonly editor: string;
			readonly editorVersion: number | string;
			readonly target: Readonly<DiskSnapshot>;
	  }
	| {
			readonly kind: "close";
			readonly document: string;
			readonly name: string;
			readonly editor: string;
			readonly editorVersion: number | string;
			readonly target: Readonly<DiskSnapshot> | null;
			readonly allowSave: boolean;
	  };
export type DecisionAnswer =
	| "replace"
	| "another"
	| "cancel"
	| "create"
	| "disk"
	| "save"
	| "discard";
export interface WorkspaceDecisions {
	request(
		request: DecisionRequest,
		signal: AbortSignal,
	): Promise<DecisionAnswer>;
}
export interface WorkspaceDocument {
	readonly key: string;
	readonly name: string;
	readonly location: Readonly<{ id: number; path: string }> | null;
	readonly dirty: boolean;
	readonly conflict: Readonly<{
		state: string;
		message: string;
		targetPath: string;
		observed: Readonly<DiskSnapshot> | null;
		originalChanged: string | null;
		actions: Readonly<{ review: boolean; adopt: boolean; saveAs: boolean }>;
	}> | null;
	readonly notice: Readonly<{
		message: string;
		revision: number | string;
		channel: string;
	}> | null;
	readonly saveNotice: Readonly<{ message: string }> | null;
}
export interface WorkspaceSnapshot {
	readonly documents: readonly WorkspaceDocument[];
	readonly active: string | null;
	/** Changes on explicit selection, including selection of the current document. */
	readonly activation: number;
	readonly busy: boolean;
	readonly saveCapability: Readonly<{ save: boolean; reason: string }>;
	readonly appNotice: string;
	readonly folder: Readonly<{ root: string; files: readonly string[] }> | null;
	readonly recentTargets: readonly Readonly<{
		kind: "file" | "folder";
		path: string;
	}>[];
}
export interface WorkspaceController {
	readonly ready: Promise<void>;
	dispatch(
		command: WorkspaceCommand,
	): Promise<{ accepted: boolean; saved?: boolean; closed?: boolean }>;
	accept(snapshot: DiskSnapshot, isCurrent?: () => boolean): Promise<void>;
	refresh(): Promise<void>;
	requestQuit(request: string): Promise<void>;
	snapshot(): WorkspaceSnapshot;
	subscribe(listener: (snapshot: WorkspaceSnapshot) => void): () => void;
	notify(
		message: string,
		owner?: { document?: string; channel?: string; revision?: number | string },
	): void;
	idle(): Promise<void>;
	dispose(): void;
}

/** Workspace decisions have no dependency on a DOM realm or native singleton. */
export function createWorkspaceController({
	files,
	editors,
	decisions,
	host,
}: {
	files: WorkspaceFiles;
	editors: WorkspaceEditors;
	decisions: WorkspaceDecisions;
	host?: WorkspaceHost;
}): WorkspaceController {
	const records = new DocumentRecords();
	interface Entry {
		record: DocumentRecord;
		editor: WorkspaceEditor;
		notice: WorkspaceDocument["notice"];
		saveNotice: WorkspaceDocument["saveNotice"];
	}
	const entries = new WeakMap<DocumentRecord, Entry>();
	const opened = () => [...records].map((record) => entries.get(record)!);
	const entryFor = (key: string | undefined) => {
		const record = key && records.get(key);
		return record ? entries.get(record) : undefined;
	};
	const isOpen = (entry: Entry) =>
		records.get(entry.record.key) === entry.record;
	const lifetime = new AbortController();
	const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
	const pending = new Set<Promise<unknown>>();
	let disposed = false,
		busy = false,
		serial = 0,
		activation = 0,
		active: string | null = null,
		appNotice = "";
	let saveCapability = {
		save: false,
		reason: host
			? "Checking document saving support…"
			: "Use the desktop application to save files.",
	};
	let folder: WorkspaceSnapshot["folder"] = null;
	let recentTargets: WorkspaceSnapshot["recentTargets"] = [];
	let closingRequest: string | null = null,
		completedRequest = 0n;
	const refusingRequests = new Set<string>();
	const basename = (path: string) => path.split("/").pop()!;
	function track<T>(promise: Promise<T>): Promise<T> {
		pending.add(promise);
		void promise.then(
			() => pending.delete(promise),
			() => pending.delete(promise),
		);
		return promise;
	}
	function snapshot(): WorkspaceSnapshot {
		return Object.freeze({
			documents: Object.freeze(
				opened().map((entry) => {
					const { record, editor } = entry,
						{ session } = record;
					if (entry.notice?.revision !== editor.getRevision())
						entry.notice = null;
					const location = session.location,
						panel = session.panel();
					return Object.freeze({
						key: record.key,
						name: documentName(record),
						dirty: session.isDirty(),
						location:
							location &&
							Object.freeze({ id: location.id, path: location.path }),
						conflict:
							panel &&
							Object.freeze({
								...panel,
								observed:
									panel.observed && Object.freeze({ ...panel.observed }),
								actions: Object.freeze({
									review: !!panel.observed && saveCapability.save,
									adopt: !!panel.observed && panel.observed.source !== null,
									saveAs: saveCapability.save,
								}),
							}),
						notice: entry.notice && Object.freeze({ ...entry.notice }),
						saveNotice:
							entry.saveNotice && Object.freeze({ ...entry.saveNotice }),
					});
				}),
			),
			active,
			activation,
			busy,
			appNotice,
			saveCapability: Object.freeze({ ...saveCapability }),
			folder,
			recentTargets,
		});
	}
	function emit() {
		if (disposed) return;
		const state = snapshot();
		for (const listener of listeners) listener(state);
	}
	function notify(
		message: string,
		owner?: { document?: string; channel?: string; revision?: number | string },
	) {
		if (disposed) return;
		if (owner?.document) {
			const entry = entryFor(owner.document);
			if (!entry) return;
			const channel = owner.channel ?? "action";
			if (!message && entry.notice?.channel !== channel) return;
			entry.notice = message
				? {
						message,
						revision: owner.revision ?? entry.editor.getRevision(),
						channel,
					}
				: null;
		} else appNotice = message;
		emit();
	}
	const report = (error: unknown) => notify(String(error));
	function saveNotice(
		entry: Entry,
		message: string,
		resolved = false,
		revision = entry.editor.getRevision(),
	) {
		if (!isOpen(entry)) return;
		entry.saveNotice = resolved ? null : { message };
		if (resolved) notify(message, { document: entry.record.key, revision });
		else {
			entry.notice = null;
			emit();
		}
	}
	function syncLocation(entry: Entry) {
		if (disposed || !isOpen(entry)) return;
		const location = entry.record.session.location;
		if (location) {
			entry.editor.setLocation?.(
				location.path,
				basename(location.path),
				location.id,
			);
			entry.editor.markSaved?.(entry.record.session.savedSource);
		}
	}
	async function refreshRecent() {
		if (!host) return;
		const targets = await host.recent();
		if (disposed) return;
		recentTargets = Object.freeze(
			targets.map((target) => Object.freeze({ ...target })),
		);
		emit();
	}
	async function remember(path: string) {
		await host?.rememberDocument(path);
		await refreshRecent();
	}
	function openDocument(
		name: string,
		source: string,
		disk: DiskSnapshot | null,
	) {
		if (disposed) return;
		const existing =
			disk &&
			opened().find(
				({ record }) =>
					record.session.disk && sameDocument(record.session.disk, disk),
			);
		if (existing) {
			if (existing.record.session.rebindDisk(disk)) {
				syncLocation(existing);
				void track(remember(disk.path).catch(report));
			}
			active = existing.record.key;
			activation++;
			emit();
			return;
		}
		const key = `document-${++serial}`;
		const editor = editors.create(
			{ key, name, source, location: disk },
			{
				changed: emit,
				notice: (message, channel) =>
					notify(message, { document: key, ...(channel ? { channel } : {}) }),
			},
		);
		const record = {
			key,
			untitledName: name,
			session: new DocumentSession(editor, disk),
		};
		entries.set(record, { record, editor, notice: null, saveNotice: null });
		records.add(record);
		active = key;
		activation++;
		emit();
		if (disk) void track(remember(disk.path).catch(report));
	}
	const releaseUnused = () => records.releaseUnused((id) => files.release(id));
	async function accept(snapshot: DiskSnapshot, isCurrent = () => true) {
		const relinquish = records.retain(snapshot.id);
		try {
			if (disposed || !isCurrent()) return;
			if (snapshot.source === null)
				throw new Error(
					"This file is missing. Choose its new location or save the retained editor content elsewhere.",
				);
			if (
				!opened().some(
					({ record }) =>
						record.session.disk && sameDocument(record.session.disk, snapshot),
				)
			) {
				for (const entry of opened()) {
					const session = entry.record.session,
						previous = session.location;
					if (!previous?.identity || previous.identity !== snapshot.identity)
						continue;
					const current = await files.inspect(previous.id).catch(() => null);
					if (disposed || !isCurrent()) return;
					if (!isOpen(entry) || session.location?.id !== previous.id) continue;
					if (current?.source === null && session.rebindDisk(snapshot, true)) {
						syncLocation(entry);
						openDocument(basename(snapshot.path), snapshot.source, snapshot);
						return;
					}
				}
			}
			if (!disposed && isCurrent())
				openDocument(basename(snapshot.path), snapshot.source, snapshot);
		} finally {
			relinquish();
			await releaseUnused();
		}
	}
	const saveAs = createSaveAsController({
		documents: records,
		files,
		decisions: {
			async replace(request, signal) {
				const answer = await decisions.request(request, signal);
				return answer === "replace" || answer === "another" ? answer : "cancel";
			},
		},
	});
	function explainOpenTarget(entry: Entry, target: DiskSnapshot) {
		const other = records.otherTarget(entry.record.key, target);
		if (!other) return false;
		saveNotice(
			entry,
			`The target is already open as ${documentName(other)}. Both editor buffers are retained. Choose another file or close that tab explicitly.`,
		);
		return true;
	}
	async function saveEntry(
		entry: Entry,
		as = false,
		observed = false,
		confirmation?: OperationPlan,
	): Promise<boolean> {
		if (disposed || !isOpen(entry)) return false;
		if (!saveCapability.save) {
			notify(saveCapability.reason, {
				document: entry.record.key,
				channel: "capability",
			});
			return false;
		}
		const { session } = entry.record;
		const checkConfirmation = () => {
			if (confirmation && !session.holds(confirmation, "editor")) {
				saveNotice(
					entry,
					"The document changed after the decision was asked. Editor content is retained; close it again.",
				);
				return false;
			}
			return true;
		};
		let target = observed ? (session.panel()?.observed ?? null) : session.disk;
		if (as || !target) {
			const result = await saveAs.saveAs(entry.record.key, {
				signal: lifetime.signal,
				...(confirmation ? { confirmation } : {}),
			});
			if (disposed || !isOpen(entry)) return false;
			if (result.kind === "saved" && session.disk) {
				syncLocation(entry);
				await remember(session.disk.path).catch((error) =>
					report(
						`Saved; recent targets could not be updated: ${String(error)}`,
					),
				);
			}
			if (result.message)
				saveNotice(
					entry,
					result.message,
					result.kind === "saved",
					result.editorVersion ?? entry.editor.getRevision(),
				);
			for (const error of result.cleanupErrors ?? []) report(error);
			emit();
			return result.kind === "saved";
		}
		const remembered = target,
			scope = session.begin();
		let fresh: DiskSnapshot;
		try {
			fresh = await files.inspect(remembered.id);
		} catch (error) {
			session.observe(remembered, { error }, scope);
			saveNotice(
				entry,
				`Could not read ${remembered.path}: ${String(error)}. The save was not attempted. Editor content is retained.`,
			);
			return false;
		}
		if (disposed || !isOpen(entry) || !checkConfirmation()) return false;
		const clean = !session.isDirty();
		const observation = session.observe(remembered, { snapshot: fresh }, scope);
		target = fresh;
		if (!observed && observation === "reloaded") {
			syncLocation(entry);
			saveNotice(
				entry,
				"Reloaded the current disk version; there was nothing to save.",
				true,
			);
			emit();
			return true;
		}
		if (
			!observed &&
			clean &&
			fresh.source !== null &&
			session.acknowledges(fresh) &&
			fresh.source === entry.editor.getSource()
		) {
			syncLocation(entry);
			saveNotice(entry, "Already saved.", true);
			emit();
			return true;
		}
		if (explainOpenTarget(entry, target) || !checkConfirmation()) return false;
		const selected = target;
		const review =
			selected.source !== null &&
			selected.source !== entry.editor.getSource() &&
			(observed || !session.acknowledges(selected));
		const recreate = !review && selected.source === null;
		const plan = session.plan(recreate ? "recreate" : "save", selected);
		if (review || recreate) {
			const decision = await decisions.request(
				{
					kind: review ? "replace" : "recreate",
					document: entry.record.key,
					target: Object.freeze({ ...selected }),
					editor: plan.editor,
					editorVersion: plan.editorVersion,
				},
				lifetime.signal,
			);
			if (disposed || !isOpen(entry)) return false;
			if (review && decision === "another")
				return saveEntry(entry, true, false, confirmation);
			if (decision !== (review ? "replace" : "create")) return false;
		}
		const outcome = await session.save(plan, (request) =>
			files.save({
				id: request.target!.id,
				source: request.editor,
				expected: request.revision,
			}),
		);
		if (disposed || !isOpen(entry)) return false;
		if (outcome.stale) {
			saveNotice(
				entry,
				"The document changed while the review was open. Editor content is retained; review it again.",
			);
			emit();
			return false;
		}
		if (outcome.saved && session.disk) {
			syncLocation(entry);
			await remember(session.disk.path).catch((error) =>
				report(`Saved; recent targets could not be updated: ${String(error)}`),
			);
		}
		saveNotice(
			entry,
			outcome.message ||
				(outcome.saved
					? "Saved."
					: "The save was not accepted. Editor content is retained."),
			outcome.saved,
			plan.editorVersion,
		);
		emit();
		return outcome.saved;
	}
	async function useDiskVersion(entry: Entry) {
		const { session } = entry.record,
			observed = session.panel()?.observed;
		if (!observed || explainOpenTarget(entry, observed)) return;
		const plan = session.plan("adopt", observed);
		const choice = await decisions.request(
			{
				kind: "adopt",
				document: entry.record.key,
				target: Object.freeze({ ...observed }),
				editor: plan.editor,
				editorVersion: plan.editorVersion,
			},
			lifetime.signal,
		);
		if (choice !== "disk" || disposed || !isOpen(entry)) return;
		const scope = session.begin();
		let current: DiskSnapshot;
		try {
			current = await files.inspect(observed.id);
		} catch (error) {
			session.observe(observed, { error }, scope);
			saveNotice(
				entry,
				`Could not read the recovery target: ${String(error)}. Editor content is retained; review it again.`,
			);
			return;
		}
		if (disposed || !isOpen(entry)) return;
		session.observe(observed, { snapshot: current }, scope);
		if (explainOpenTarget(entry, current)) return;
		if (!session.adopt(plan)) {
			saveNotice(
				entry,
				session.holds(plan, "editor")
					? "The disk changed again. Review the new version."
					: "The editor changed during the read. Your new edits are retained; review again.",
			);
			return;
		}
		syncLocation(entry);
		const revision = entry.editor.getRevision();
		await remember(current.path).catch(report);
		saveNotice(
			entry,
			"Reloaded the current disk version.",
			!session.panel(),
			revision,
		);
		emit();
	}
	function remove(entry: Entry) {
		records.delete(entry.record.key);
		entry.record.session.dispose();
		entry.editor.dispose();
		if (active === entry.record.key) active = [...records].at(-1)?.key ?? null;
		emit();
	}
	async function closeEntries(selected: Entry[]) {
		const membership = [...records];
		return closeDocuments(
			selected.map((entry) => ({
				entry,
				isDirty: () => entry.record.session.isDirty(),
				prepareClose: async () => {
					await entry.record.session.prepareClose();
					await entry.record.session
						.checkExternal((id) => files.inspect(id))
						.catch(report);
					syncLocation(entry);
					emit();
				},
				closeVersion: () => entry.record.session.closeVersion(),
				closePlan: () => entry.record.session.plan("close", null),
			})),
			async ({ entry }) => {
				const { session } = entry.record;
				const decision = await decisions.request(
					{
						kind: "close",
						document: entry.record.key,
						name: documentName(entry.record),
						editor: entry.editor.getSource(),
						editorVersion: entry.editor.getRevision(),
						target: session.location && Object.freeze({ ...session.location }),
						allowSave: saveCapability.save,
					},
					lifetime.signal,
				);
				return decision === "save" || decision === "discard"
					? decision
					: "cancel";
			},
			({ entry }, plan) => saveEntry(entry, false, false, plan),
			({ entry }) => remove(entry),
			() =>
				!disposed &&
				records.size === membership.length &&
				membership.every((record) => records.get(record.key) === record),
		);
	}
	async function run(
		action: () => Promise<{ saved?: boolean; closed?: boolean } | undefined>,
	) {
		if (disposed || busy) return { accepted: false };
		busy = true;
		emit();
		try {
			return { accepted: true, ...(await action()) };
		} catch (error) {
			report(error);
			return { accepted: true };
		} finally {
			await releaseUnused().catch(report);
			busy = false;
			emit();
		}
	}
	async function dispatch(command: WorkspaceCommand) {
		if (
			disposed ||
			(busy && command.type !== "activate" && command.type !== "dismiss")
		)
			return { accepted: false };
		const entry =
			"key" in command
				? entryFor(command.key ?? active ?? undefined)
				: entryFor(active ?? undefined);
		if (command.type === "activate") {
			if (entry) {
				active = entry.record.key;
				activation++;
				emit();
			}
			return { accepted: !!entry };
		}
		if (command.type === "dismiss") {
			if (entry) entry.notice = null;
			appNotice = "";
			emit();
			return { accepted: true };
		}
		if (command.type === "cycle") {
			const all = [...records],
				index = all.findIndex((record) => record.key === active);
			if (all.length) {
				active =
					all[
						(index + (command.direction === "next" ? 1 : all.length - 1)) %
							all.length
					]!.key;
				activation++;
			}
			emit();
			return { accepted: true };
		}
		return run(async () => {
			switch (command.type) {
				case "new": {
					const names = new Set([...records].map(documentName));
					let number = 1;
					while (names.has(`Untitled ${number}`)) number++;
					openDocument(
						command.name ?? `Untitled ${number}`,
						command.source ?? "",
						null,
					);
					break;
				}
				case "open-file": {
					const selected = await files.chooseDocument();
					if (selected) await accept(selected);
					break;
				}
				case "open-path":
					await accept(
						await files.openPath(command.path, command.recent ?? false),
					);
					break;
				case "open-folder": {
					if (!host)
						throw new Error("Use the desktop application to choose a folder.");
					const root = command.path
						? await host.openRecentFolder(command.path)
						: await host.chooseFolder();
					if (!root || disposed) break;
					const paths = await host.listDocuments();
					if (disposed) break;
					folder = Object.freeze({ root, files: Object.freeze([...paths]) });
					emit();
					await host.rememberFolder(root);
					await refreshRecent();
					notify(`Opened ${root}. Save documents explicitly.`);
					break;
				}
				case "save":
					return {
						saved: entry
							? await saveEntry(
									entry,
									command.mode === "as",
									command.mode === "observed",
								)
							: false,
					};
				case "adopt":
					if (entry) await useDiskVersion(entry);
					break;
				case "close":
					return {
						closed: await closeEntries(
							command.keys
								? command.keys
										.map((key) => entryFor(key))
										.filter((item): item is Entry => !!item)
								: entry
									? [entry]
									: [],
						),
					};
			}
		});
	}
	async function refresh() {
		if (disposed || busy) return;
		for (const entry of opened()) {
			if (disposed || busy) break;
			try {
				await entry.record.session.checkExternal((id) => files.inspect(id));
				if (isOpen(entry)) syncLocation(entry);
			} catch (error) {
				report(
					`Could not check ${documentName(entry.record)}: ${String(error)}. Editor content is retained.`,
				);
			}
			emit();
		}
	}
	async function requestQuit(request: string) {
		if (
			disposed ||
			!host ||
			!/^[1-9][0-9]*$/.test(request) ||
			BigInt(request) <= completedRequest ||
			closingRequest === request ||
			refusingRequests.has(request)
		)
			return;
		const finish = async (approved: boolean) => {
			if (disposed) return;
			await host.finishQuit(request, approved);
			completedRequest =
				completedRequest > BigInt(request) ? completedRequest : BigInt(request);
		};
		if (busy || closingRequest !== null) {
			refusingRequests.add(request);
			try {
				await finish(false);
			} catch (error) {
				report(error);
			} finally {
				refusingRequests.delete(request);
			}
			return;
		}
		closingRequest = request;
		await track(
			run(async () => {
				let approved = false;
				try {
					approved = await closeEntries(opened());
				} finally {
					try {
						await finish(approved);
					} finally {
						closingRequest = null;
					}
				}
			}),
		);
	}
	const ready = Promise.all([
		(async () => {
			if (!host) return;
			try {
				const capability = await host.capabilities();
				if (
					typeof capability?.save !== "boolean" ||
					(!capability.save &&
						(typeof capability.reason !== "string" ||
							!capability.reason.trim()))
				)
					throw new Error("Invalid document saving capability");
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
			for (const entry of opened())
				if (entry.notice?.channel === "capability")
					entry.notice = saveCapability.save
						? null
						: { ...entry.notice, message: saveCapability.reason };
			emit();
		})(),
		refreshRecent().catch(report),
	]).then(() => {});
	return {
		ready,
		snapshot,
		notify,
		dispatch: (command) => track(dispatch(command)),
		accept: (value, isCurrent) => track(accept(value, isCurrent)),
		refresh: () => track(refresh()),
		requestQuit,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async idle() {
			while (pending.size) await Promise.allSettled([...pending]);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			lifetime.abort();
			listeners.clear();
			const reads = opened().map(({ record }) => record.session.prepareClose());
			for (const entry of opened()) {
				entry.record.session.dispose();
				entry.editor.dispose();
			}
			records.clear();
			active = null;
			void track(
				Promise.allSettled(reads)
					.then(() => {
						if (!busy) return releaseUnused();
					})
					.catch(report),
			);
		},
	};
}

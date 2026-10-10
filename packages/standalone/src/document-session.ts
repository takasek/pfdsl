export interface DiskSnapshot {
	id: number;
	path: string;
	source: string | null;
	revision: string | null;
	identity: string | null;
	binding: string;
}
export interface SaveResult {
	outcome:
		| "saved"
		| "conflict"
		| "failed-before-publication"
		| "published-but-unconfirmed";
	current?: DiskSnapshot | null;
	message?: string;
	publication?: "not-published" | "published" | "unknown";
	targetState?: "readable" | "missing" | "unreadable";
}
interface DocumentView {
	getSource(): string;
	setSource(source: string): void;
	getRevision?(): number | string;
}

/** Match selected capabilities, not display paths that can be rebound. */
export function sameDocument(
	previous: DiskSnapshot,
	current: DiskSnapshot,
): boolean {
	return Boolean(
		previous.binding === current.binding ||
			(previous.identity && previous.identity === current.identity),
	);
}

/** Keeps disk acknowledgment separate from the editor's current content. */
export class DocumentSession {
	view: DocumentView;
	disk: DiskSnapshot | null;
	observed: DiskSnapshot | null;
	savedSource: string;
	conflict: DiskSnapshot | null = null;
	pendingTarget: DiskSnapshot | null = null;
	sourceConflict: DiskSnapshot | null = null;
	message = "";
	saveFailure: SaveResult | null = null;
	private uncertain = false;
	private checkPromise: Promise<void> | null = null;
	private observationVersion = 0;
	private disposed = false;
	constructor(view: DocumentView, disk: DiskSnapshot | null) {
		this.view = view;
		this.disk = disk;
		this.observed = disk;
		this.savedSource = view.getSource();
	}
	isDirty() {
		return this.uncertain || this.view.getSource() !== this.savedSource;
	}
	private editorVersion() {
		return this.view.getRevision?.() ?? this.view.getSource();
	}
	closeVersion() {
		const state = (snapshot: DiskSnapshot | null) =>
			snapshot && [snapshot.id, snapshot.path, snapshot.revision];
		// Disk-only state changes can make a clean buffer the last surviving copy.
		return JSON.stringify([
			this.editorVersion(),
			this.isDirty(),
			this.observationVersion,
			state(this.disk),
			state(this.observed),
			state(this.conflict),
			state(this.pendingTarget),
			state(this.sourceConflict),
		]);
	}
	rebindDisk(current: DiskSnapshot) {
		const previous = this.disk;
		if (!previous || !sameDocument(previous, current)) return false;
		const changed = previous.revision !== current.revision;
		const dirty = this.isDirty();
		// Adopt the selected native capability without acknowledging unsaved text.
		this.disk = {
			...previous,
			id: current.id,
			path: current.path,
			binding: current.binding,
			identity: current.identity,
		};
		const oldPending = this.pendingTarget;
		const ownsSource = (snapshot: DiskSnapshot) =>
			snapshot.binding === previous.binding;
		const rebind = (snapshot: DiskSnapshot) => ({
			...snapshot,
			id: current.id,
			path: current.path,
			binding: current.binding,
		});
		if (oldPending && ownsSource(oldPending))
			this.pendingTarget = rebind(oldPending);
		const conflict = this.conflict;
		if (conflict && ownsSource(conflict)) this.conflict = rebind(conflict);
		if (this.pendingTarget && this.pendingTarget.id !== current.id) {
			this.sourceConflict = changed ? current : null;
			return true;
		}
		this.observed = current;
		if (changed && !dirty && current.source !== null) this.useDisk(current);
		else if (changed) {
			this.conflict = current;
			this.uncertain = true;
			this.message =
				"The selected location contains a changed disk version. Your editor content is retained.";
		}
		return true;
	}
	async save(
		write: (
			source: string,
			expected: DiskSnapshot | null,
		) => Promise<SaveResult>,
		target = this.disk,
	): Promise<boolean> {
		const source = this.view.getSource();
		let result: SaveResult;
		try {
			result = await write(source, target);
		} catch (error) {
			// An IPC failure does not establish whether native publication occurred.
			result = {
				outcome: "published-but-unconfirmed",
				publication: "unknown",
				targetState: "unreadable",
				message: `The save result could not be confirmed. Editor content is retained; inspect the selected target before retrying. ${String(error)}`,
			};
		}
		this.message = result.message ?? "";
		this.observed = result.current ?? null;
		if (result.outcome !== "saved" || !result.current) {
			this.uncertain = true;
			this.saveFailure = result;
			this.pendingTarget = result.current ?? target;
			this.conflict = result.current ?? null;
			return false;
		}
		this.disk = result.current;
		this.saveFailure = null;
		this.observed = result.current;
		this.savedSource = source;
		this.uncertain = false;
		this.conflict = null;
		this.pendingTarget = null;
		this.sourceConflict = null;
		return true;
	}
	checkExternal(read: (id: number) => Promise<DiskSnapshot>): Promise<void> {
		if (this.checkPromise) return this.checkPromise;
		if (!this.disk || this.disposed) return Promise.resolve();
		this.checkPromise = this.observeExternal(read).finally(() => {
			this.checkPromise = null;
		});
		return this.checkPromise;
	}
	async prepareClose() {
		// A started observation can make this buffer the last surviving readable copy.
		await this.checkPromise?.catch(() => {});
	}
	private async observeExternal(read: (id: number) => Promise<DiskSnapshot>) {
		if (!this.disk || this.disposed) return;
		const baseline = this.disk;
		const recovery = this.pendingTarget;
		const viewRevision = this.editorVersion();
		const dirty = this.isDirty();
		try {
			const current = await read(baseline.id);
			if (
				this.disposed ||
				this.disk !== baseline ||
				this.pendingTarget !== recovery
			)
				return;
			if (recovery && recovery.id !== baseline.id) {
				// A failed Save As does not transfer the active document's ownership.
				// Poll A separately while every recovery action continues to target B.
				this.sourceConflict =
					current.revision === baseline.revision ? null : current;
				const target = await read(recovery.id);
				if (
					this.disposed ||
					this.disk !== baseline ||
					this.pendingTarget !== recovery
				)
					return;
				if (
					target.revision !== this.observed?.revision ||
					target.path !== this.observed.path
				) {
					this.observed = target;
					this.pendingTarget = target;
					this.conflict = target;
				}
				return;
			}
			if (current.revision === this.disk.revision) {
				this.disk = current;
				this.observed = current;
				return;
			}
			if (
				current.revision === this.observed?.revision &&
				current.path === this.observed.path
			)
				return;
			this.observed = current;
			if (
				!dirty &&
				!this.isDirty() &&
				this.editorVersion() === viewRevision &&
				current.source !== null
			) {
				this.useDisk(current);
			} else {
				this.conflict = current;
				this.uncertain = true;
				this.message =
					current.source === null
						? "The file was deleted or moved. Your editor content is retained."
						: "The disk changed. Your editor content is retained.";
			}
		} catch (error) {
			if (
				!this.disposed &&
				this.disk === baseline &&
				this.pendingTarget === recovery
			) {
				this.uncertain = true;
				this.observationVersion++;
				this.message = `The disk version could not be read. Your editor content is retained. ${String(error)}`;
			}
			throw error;
		}
	}
	useDiskIfUnchanged(current: DiskSnapshot, confirmedVersion: number | string) {
		if (this.disposed || this.closeVersion() !== confirmedVersion) return false;
		this.useDisk(current);
		return true;
	}
	dispose() {
		this.disposed = true;
	}
	useDisk(current: DiskSnapshot) {
		if (current.source === null)
			throw new Error("A missing file cannot replace editor content.");
		this.view.setSource(current.source);
		this.disk = current;
		this.observed = current;
		this.savedSource = current.source;
		this.saveFailure = null;
		this.conflict = null;
		this.pendingTarget = null;
		this.sourceConflict = null;
		this.uncertain = false;
	}
}

interface Closable {
	isDirty(): boolean;
	prepareClose?(): Promise<void>;
	closeVersion?(): number | string;
}
/** Discard is a decision until every document has accepted the close. */
export async function closeDocuments<T extends Closable>(
	documents: T[],
	decide: (document: T) => Promise<"save" | "discard" | "cancel">,
	save: (document: T) => Promise<boolean>,
	dispose: (document: T) => void,
	validate: () => boolean = () => true,
): Promise<boolean> {
	const versions = new Map<
		T,
		{ version: number | string | undefined; dirty: boolean }
	>();
	for (const document of documents) {
		await document.prepareClose?.();
		if (document.isDirty()) {
			const requestedVersion = document.closeVersion?.();
			const decision = await decide(document);
			if (decision === "cancel") return false;
			// The answer applies to the document state shown when the decision began.
			if (document.closeVersion?.() !== requestedVersion || !document.isDirty())
				return false;
			if (
				decision === "save" &&
				(!(await save(document)) || document.isDirty())
			)
				return false;
		}
		versions.set(document, {
			version: document.closeVersion?.(),
			dirty: document.isDirty(),
		});
	}
	if (
		documents.some(
			(document) =>
				document.closeVersion?.() !== versions.get(document)?.version ||
				document.isDirty() !== versions.get(document)?.dirty,
		)
	)
		return false;
	if (!validate()) return false;
	for (const document of documents) dispose(document);
	return true;
}

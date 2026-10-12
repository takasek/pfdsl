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
	previousMissing = false,
): boolean {
	return Boolean(
		previous.binding === current.binding ||
			(previousMissing &&
				previous.identity &&
				previous.identity === current.identity),
	);
}

/**
 * Metadata-only changes and same-content replacements are not document changes.
 * The raw disk text is compared; savedSource is normalized by the editor.
 */
export function sameDiskContent(
	previous: DiskSnapshot,
	current: DiskSnapshot,
): boolean {
	return (
		previous.revision === current.revision ||
		(current.source !== null && current.source === previous.source)
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
	// A repeated unreadable observation of one target is the state the user confirmed;
	// another target becoming unreadable, or any target recovering, is not.
	private unreadable = new Set<number>();
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
			snapshot && [snapshot.id, snapshot.path, snapshot.source];
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
	/**
	 * Adopts a fresh inspection of a Save target and returns whether its content
	 * differs from the version this session last acknowledged or observed there.
	 * The document's own file is judged against its acknowledged disk version.
	 * While a Save As recovery targets another file, the original only reports a
	 * change as a source conflict and the recovery target keeps the panel.
	 */
	recordTarget(fresh: DiskSnapshot): boolean {
		const owner = this.disk;
		const recovery = this.pendingTarget;
		let changed: boolean;
		if (owner && owner.id === fresh.id) {
			changed = !sameDiskContent(owner, fresh);
			if (recovery && recovery.id !== owner.id) {
				this.sourceConflict = changed ? fresh : null;
				return changed;
			}
			if (changed) {
				this.observed = fresh;
				this.flagExternalChange(fresh);
			} else this.adoptUnchanged(fresh);
		} else {
			const known =
				this.observed?.id === fresh.id
					? this.observed
					: recovery?.id === fresh.id
						? recovery
						: null;
			changed = !known || !sameDiskContent(known, fresh);
			this.observed = fresh;
			// An unchanged target keeps the failure that explains the panel.
			if (changed) this.flagExternalChange(fresh);
		}
		if (recovery?.id === fresh.id) this.pendingTarget = fresh;
		return changed;
	}
	/**
	 * A clean editor has nothing to save: it follows the disk instead of replacing it.
	 * Returns null when a save is still needed.
	 */
	followDiskIfClean(fresh: DiskSnapshot): "reloaded" | "unchanged" | null {
		const owner = this.disk;
		if (!owner || fresh.id !== owner.id || fresh.source === null) return null;
		// The poll reloads only an editor that shows no unsaved state; so does Save.
		if (this.isDirty() || this.saveFailure || this.pendingTarget) return null;
		if (!sameDiskContent(owner, fresh)) {
			this.useDisk(fresh);
			return "reloaded";
		}
		// Normalized line endings still make a manual save write the editor text.
		if (fresh.source !== this.view.getSource()) return null;
		this.adoptUnchanged(fresh);
		return "unchanged";
	}
	private adoptUnchanged(current: DiskSnapshot) {
		this.disk = current;
		this.observed = current;
		// isDirty() still reports unsaved text through the content comparison.
		if (!this.saveFailure && !this.pendingTarget) {
			this.uncertain = false;
			this.conflict = null;
			this.sourceConflict = null;
			this.message = "";
		}
	}
	private flagExternalChange(current: DiskSnapshot, message?: string) {
		this.conflict = current;
		this.uncertain = true;
		this.message =
			message ??
			(current.source === null
				? "The file was deleted or moved. Your editor content is retained."
				: "The disk changed. Your editor content is retained.");
	}
	rebindDisk(current: DiskSnapshot, previousMissing = false) {
		const previous = this.disk;
		if (!previous || !sameDocument(previous, current, previousMissing))
			return false;
		const changed = !sameDiskContent(previous, current);
		const dirty = this.isDirty();
		// Adopt the selected native capability without acknowledging unsaved text.
		this.disk = {
			...previous,
			id: current.id,
			path: current.path,
			binding: current.binding,
			identity: current.identity,
			...(changed ? {} : { revision: current.revision }),
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
		else if (changed)
			this.flagExternalChange(
				current,
				"The selected location contains a changed disk version. Your editor content is retained.",
			);
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
		if ((!this.disk && !this.pendingTarget) || this.disposed)
			return Promise.resolve();
		this.checkPromise = this.observeExternal(read).finally(() => {
			this.checkPromise = null;
		});
		return this.checkPromise;
	}
	private markReadable(id: number) {
		if (this.unreadable.delete(id)) this.observationVersion++;
	}
	private markUnreadable(id: number) {
		if (this.unreadable.has(id)) return;
		this.unreadable.add(id);
		this.observationVersion++;
	}
	async prepareClose() {
		// A started observation can make this buffer the last surviving readable copy.
		await this.checkPromise?.catch(() => {});
	}
	/**
	 * A failed Save As does not transfer the document's ownership. Both the original
	 * (when it exists) and the recovery target are read, each independent of the
	 * other's failure, because the final close check needs every unresolved target.
	 */
	private async observeRecovery(
		read: (id: number) => Promise<DiskSnapshot>,
		baseline: DiskSnapshot | null,
		recovery: DiskSnapshot,
	) {
		const [original, target] = await Promise.allSettled([
			baseline ? read(baseline.id) : Promise.resolve(null),
			read(recovery.id),
		]);
		if (
			this.disposed ||
			this.disk !== baseline ||
			this.pendingTarget !== recovery
		)
			return;
		if (baseline)
			if (original.status === "fulfilled") this.markReadable(baseline.id);
			else this.markUnreadable(baseline.id);
		if (target.status === "fulfilled") this.markReadable(recovery.id);
		else this.markUnreadable(recovery.id);
		if (original.status === "fulfilled" && baseline && original.value)
			this.sourceConflict = sameDiskContent(baseline, original.value)
				? null
				: original.value;
		if (target.status === "fulfilled") {
			const seen = target.value;
			const known = this.observed?.id === seen.id ? this.observed : recovery;
			const changed = !sameDiskContent(known, seen) || known.path !== seen.path;
			if (
				this.observed?.id !== seen.id ||
				changed ||
				known.revision !== seen.revision
			) {
				this.observed = seen;
				this.pendingTarget = seen;
			}
			if (changed) this.conflict = seen;
		}
		const failure = [original, target].find(
			(result) => result.status === "rejected",
		);
		if (failure?.status === "rejected") {
			this.uncertain = true;
			this.message = `The disk version could not be read. Your editor content is retained. ${String(failure.reason)}`;
			throw failure.reason;
		}
	}
	private async observeExternal(read: (id: number) => Promise<DiskSnapshot>) {
		if (this.disposed) return;
		const recovery = this.pendingTarget;
		if (recovery && recovery.id !== this.disk?.id)
			return this.observeRecovery(read, this.disk, recovery);
		if (!this.disk) return;
		const baseline = this.disk;
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
			this.markReadable(baseline.id);
			if (sameDiskContent(this.disk, current)) {
				this.adoptUnchanged(current);
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
				this.flagExternalChange(current);
			}
		} catch (error) {
			if (
				!this.disposed &&
				this.disk === baseline &&
				this.pendingTarget === recovery
			) {
				this.uncertain = true;
				this.markUnreadable(baseline.id);
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
		// Monaco normalizes mixed line endings; acknowledge the applied editor value.
		this.savedSource = this.view.getSource();
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
	// Later native prompts suspend polling; inspect every target again before disposal.
	for (const document of documents) await document.prepareClose?.();
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

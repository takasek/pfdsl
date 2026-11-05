import {
	type DiskSnapshot,
	type DocumentSession,
	sameDocument,
} from "./document-session.js";

/** The editor and session remain the sole owners of document text and save state. */
export interface DocumentRecord {
	readonly key: string;
	readonly untitledName: string;
	readonly session: DocumentSession;
}

export function documentName(record: DocumentRecord): string {
	return record.session.location?.path.split("/").pop() ?? record.untitledName;
}

/** One membership and native-handle owner shared by the host and document operations. */
export class DocumentRecords implements Iterable<DocumentRecord> {
	private readonly records = new Map<string, DocumentRecord>();
	private readonly handles = new Set<number>();
	private readonly retained = new Map<number, number>();
	private readonly releasing = new Map<number, Promise<void>>();
	get size() {
		return this.records.size;
	}
	[Symbol.iterator]() {
		return this.records.values();
	}
	get(key: string) {
		return this.records.get(key);
	}
	add(record: DocumentRecord) {
		if (this.records.has(record.key))
			throw new Error(`Document already exists: ${record.key}`);
		this.records.set(record.key, record);
	}
	delete(key: string) {
		return this.records.delete(key);
	}
	clear() {
		this.records.clear();
	}
	otherTarget(key: string, target: DiskSnapshot) {
		return [...this.records.values()].find(
			(record) =>
				record.key !== key &&
				record.session.disk &&
				sameDocument(record.session.disk, target),
		);
	}
	uses(id: number) {
		return [...this.records.values()].some((record) =>
			record.session.usesDocument(id),
		);
	}
	track(id: number) {
		this.handles.add(id);
	}
	/** Own a capability until the acquiring operation finishes or adopts it. */
	retain(id: number) {
		this.track(id);
		this.retained.set(id, (this.retained.get(id) ?? 0) + 1);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			const remaining = this.retained.get(id)! - 1;
			if (remaining) this.retained.set(id, remaining);
			else this.retained.delete(id);
		};
	}
	private owned(id: number) {
		return this.retained.has(id) || this.uses(id);
	}
	async releaseUnused(release: (id: number) => Promise<void>) {
		for (const id of this.handles) {
			// A document may adopt a capability while an earlier release is pending.
			if (this.owned(id)) continue;
			let pending = this.releasing.get(id);
			if (!pending) {
				pending = Promise.resolve()
					.then(async () => {
						if (this.owned(id)) return;
						await release(id);
						this.handles.delete(id);
					})
					.finally(() => {
						this.releasing.delete(id);
					});
				this.releasing.set(id, pending);
			}
			await pending;
		}
	}
}

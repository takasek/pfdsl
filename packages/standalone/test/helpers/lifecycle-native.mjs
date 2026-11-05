export const TEXT = { disk: "disk v1\n", edited: "edited by the user\n" };

export class FakeNative {
	constructor() {
		this.ino = 1000;
		this.clock = 1;
		this.docs = new Map();
	}
	add(id, name, source) {
		const doc = {
			id,
			path: `/A/${name}`,
			binding: `dir:${name}`,
			file: { source, ino: ++this.ino, mtime: ++this.clock },
			unreadable: false,
			writes: 0,
			history: [],
		};
		this.docs.set(id, doc);
		return doc;
	}
	/** The selected directory moved: the same file now has another path. */
	move(doc, path) {
		doc.history.push(doc.path);
		doc.path = path;
	}
	/**
	 * A second capability for the same leaf (the folder was selected again): same
	 * binding and file, new id.
	 */
	reselect(doc, id) {
		const alias = {
			id,
			path: doc.path,
			binding: doc.binding,
			history: [],
			get file() {
				return doc.file;
			},
			set file(value) {
				doc.file = value;
			},
			get unreadable() {
				return doc.unreadable;
			},
			set unreadable(value) {
				doc.unreadable = value;
			},
			get writes() {
				return doc.writes;
			},
			set writes(value) {
				doc.writes = value;
			},
		};
		this.docs.set(id, alias);
		return alias;
	}
	/** Another leaf name for the same file (a hard link): same content and inode. */
	link(doc, id, name) {
		const alias = {
			id,
			path: `/A/${name}`,
			binding: `dir:${name}`,
			file: doc.file,
			unreadable: false,
			writes: 0,
			history: [],
		};
		this.docs.set(id, alias);
		return alias;
	}
	snapshot(doc) {
		if (doc.unreadable) throw new Error("Permission denied (os error 13)");
		const base = { id: doc.id, path: doc.path, binding: doc.binding };
		if (!doc.file)
			return { ...base, source: null, revision: null, identity: null };
		const identity = `1:${doc.file.ino}`;
		return {
			...base,
			source: doc.file.source,
			revision: `${identity}:${doc.file.mtime}:${doc.file.source}`,
			identity,
		};
	}
	save(doc, source, expected) {
		const result = (outcome, current, message) => ({
			outcome,
			current,
			message,
			publication: "not-published",
			targetState: current
				? current.source === null
					? "missing"
					: "readable"
				: "unreadable",
		});
		let current;
		try {
			current = this.snapshot(doc);
		} catch (error) {
			return result("failed-before-publication", null, String(error));
		}
		// expected null means "create": it succeeds only while the target is still absent.
		if (current.revision !== (expected ?? null))
			return result(
				"conflict",
				current,
				"The disk changed. Review it before replacing this version.",
			);
		if (current.source === source)
			return result("saved", current, "Already saved.");
		doc.file = { source, ino: ++this.ino, mtime: ++this.clock };
		doc.writes++;
		return {
			...result("saved", this.snapshot(doc), "Saved."),
			publication: "published",
		};
	}
}

export const fsOf = (native, doc) => {
	try {
		return native.snapshot(doc);
	} catch {
		return { unreadable: true };
	}
};

/**
 * Holds one inspection of an armed target until `release`, which answers with
 * the file as it is at that moment, like a read that finishes late.
 */
export class InspectGate {
	constructor(native) {
		this.native = native;
		this.ids = new Set();
		this.held = null;
		this.waiters = [];
	}
	arm(...ids) {
		this.ids = new Set(ids);
	}
	hold(id) {
		if (!this.ids.has(id) || this.held) return undefined;
		return new Promise((resolve, reject) => {
			this.held = { id, resolve, reject };
			for (const ready of this.waiters.splice(0)) ready();
		});
	}
	/** Wait for an armed inspection to enter the native boundary, without flushing tasks. */
	waitUntilHeld() {
		if (this.held) return Promise.resolve();
		if (!this.ids.size)
			throw new Error("Arm an inspection before waiting for it.");
		return new Promise((resolve) => this.waiters.push(resolve));
	}
	get isHeld() {
		return Boolean(this.held);
	}
	release() {
		const held = this.held;
		if (!held) return false;
		this.held = null;
		this.ids = new Set();
		try {
			held.resolve(this.native.snapshot(this.native.docs.get(held.id)));
		} catch (error) {
			held.reject(error);
		}
		return true;
	}
}

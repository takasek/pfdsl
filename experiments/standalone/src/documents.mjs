export class Documents {
	constructor() {
		this.tabs = new Map();
		this.activePath = null;
		this.nextRevision = 0;
	}
	get active() {
		return this.tabs.get(this.activePath) ?? null;
	}
	open(path, text) {
		if (!this.tabs.has(path))
			this.tabs.set(path, {
				path,
				text,
				savedText: text,
				revision: this.nextRevision++,
				render: null,
				conflict: false,
				saving: false,
				get dirty() {
					return this.text !== this.savedText;
				},
			});
		this.select(path);
		return this.active;
	}
	select(path) {
		if (!this.tabs.has(path)) throw new Error("Unknown document");
		this.activePath = path;
	}
	edit(path, text) {
		const doc = this.tabs.get(path);
		if (!doc || doc.text === text) return;
		doc.text = text;
		doc.revision = this.nextRevision++;
		doc.render = null;
	}
	rendered(path, revision, result) {
		const doc = this.tabs.get(path);
		if (!doc || doc.revision !== revision) return false;
		doc.render = result;
		return true;
	}
	async save(path, write) {
		const doc = this.tabs.get(path);
		if (!doc || doc.saving)
			throw new Error("Document is unavailable or saving");
		const text = doc.text;
		doc.saving = true;
		try {
			await write(path, text, doc.savedText);
			doc.savedText = text;
			doc.conflict = false;
		} finally {
			doc.saving = false;
		}
	}
	snapshot(path) {
		const doc = this.tabs.get(path);
		return {
			document: doc,
			revision: doc?.revision,
			savedText: doc?.savedText,
		};
	}
	refresh(path, diskText, snapshot) {
		const doc = this.tabs.get(path);
		if (
			snapshot &&
			(doc !== snapshot.document ||
				doc?.revision !== snapshot.revision ||
				doc?.savedText !== snapshot.savedText)
		)
			return "stale";
		if (!doc || doc.saving || diskText === doc.savedText) return "unchanged";
		if (doc.dirty) {
			doc.conflict = true;
			return "conflict";
		}
		this.edit(path, diskText);
		doc.savedText = diskText;
		doc.conflict = false;
		return "reloaded";
	}
	close(path, discard = false) {
		const doc = this.tabs.get(path);
		if (!doc || doc.saving || (doc.dirty && !discard)) return false;
		this.tabs.delete(path);
		if (this.activePath === path)
			this.activePath = [...this.tabs.keys()].at(-1) ?? null;
		return true;
	}
}

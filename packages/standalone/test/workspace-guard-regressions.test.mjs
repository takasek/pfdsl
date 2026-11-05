import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: [
		new URL("../src/workspace-controller.ts", import.meta.url).pathname,
	],
	bundle: true,
	write: false,
	format: "esm",
	platform: "node",
});
const { createWorkspaceController } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function waitFor(promise, description) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Timed out waiting for ${description}`)),
					5_000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

const disk = (id) => ({
	id,
	path: `/work/${id}.pfdsl`,
	source: `disk ${id}`,
	revision: `revision:${id}`,
	binding: `file:${id}`,
	identity: `inode:${id}`,
});

function workspace({ inspect, decide, save, targetId = 2 } = {}) {
	const live = new Map([1, 2, 3].map((id) => [id, disk(id)]));
	const buffers = new Map();
	const reads = [],
		decisions = [],
		writes = [],
		releases = [];
	const controller = createWorkspaceController({
		files: {
			chooseDocument: async () => null,
			openPath: async () => ({ ...live.get(1) }),
			chooseSaveTarget: async () => ({ ...live.get(targetId) }),
			inspect: async (id) => {
				reads.push(id);
				return inspect ? inspect(id) : { ...live.get(id) };
			},
			save: async (request) => {
				writes.push(request);
				if (save) return save(request);
				const current = {
					...live.get(request.id),
					source: request.source,
					revision: `written:${writes.length}`,
				};
				live.set(request.id, current);
				return { outcome: "saved", current };
			},
			release: async (id) => {
				releases.push(id);
				live.delete(id);
			},
		},
		editors: {
			create(initial, events) {
				let source = initial.source,
					revision = 0;
				const buffer = {
					location: initial.location && {
						id: initial.location.id,
						path: initial.location.path,
					},
					getSource: () => source,
					getRevision: () => revision,
					setSource(value) {
						source = value;
						revision++;
						events.changed();
					},
					setLocation(path, _name, id) {
						buffer.location = { id, path };
					},
					dispose() {},
				};
				buffers.set(initial.key, buffer);
				return buffer;
			},
		},
		decisions: {
			request: async (request) => {
				decisions.push(request);
				return decide ? decide(request) : "replace";
			},
		},
		host: {
			capabilities: async () => ({ save: true, reason: null }),
			recent: async () => [],
			rememberDocument: async () => {},
			chooseFolder: async () => null,
			openRecentFolder: async () => "/work",
			listDocuments: async () => [],
			rememberFolder: async () => {},
			finishQuit: async () => {},
		},
	});
	return {
		controller,
		live,
		buffers,
		reads,
		decisions,
		writes,
		releases,
		async open(id) {
			await controller.ready;
			await controller.accept({ ...live.get(id) });
			return controller.snapshot().active;
		},
		document(key) {
			return controller.snapshot().documents.find((item) => item.key === key);
		},
		async dispose() {
			controller.dispose();
			await waitFor(controller.idle(), "workspace disposal");
		},
	};
}

async function failSaveAs(subject) {
	const key = await subject.open(1);
	subject.buffers.get(key).setSource("edited original");
	assert.deepEqual(
		await subject.controller.dispatch({ type: "save", key, mode: "as" }),
		{ accepted: true, saved: false },
	);
	assert.equal(subject.document(key).conflict.observed.id, 2);
	assert.deepEqual(subject.document(key).location, {
		id: 1,
		path: disk(1).path,
	});
	return key;
}

const failedSave = () => ({
	outcome: "failed-before-publication",
	current: disk(2),
	publication: "not-published",
	targetState: "readable",
	message: "The write failed.",
});

test("invalidated reference cannot rebind an edited document after its old path disappears", {
	timeout: 10_000,
}, async () => {
	const inspecting = deferred(),
		finishInspect = deferred();
	let current = true;
	const subject = workspace({
		inspect: (id) => {
			assert.equal(id, 1);
			inspecting.resolve();
			return finishInspect.promise;
		},
	});
	try {
		const key = await subject.open(1);
		const buffer = subject.buffers.get(key);
		buffer.setSource("retained original edits");
		const accepting = subject.controller.accept(
			{ ...disk(2), identity: disk(1).identity },
			() => current,
		);
		await waitFor(inspecting.promise, "the previous path inspection");
		current = false;
		finishInspect.resolve({
			...disk(1),
			source: null,
			revision: null,
			identity: null,
		});
		await waitFor(accepting, "invalidated reference acceptance");
		assert.deepEqual(
			subject.controller.snapshot().documents.map((doc) => doc.key),
			[key],
		);
		assert.deepEqual(subject.document(key).location, {
			id: 1,
			path: disk(1).path,
		});
		assert.deepEqual(buffer.location, { id: 1, path: disk(1).path });
		assert.equal(buffer.getSource(), "retained original edits");
		assert.equal(subject.document(key).dirty, true);
		assert.deepEqual(subject.releases, [2]);
		assert.equal(
			subject.live.has(1),
			true,
			"the original capability remains owned",
		);
	} finally {
		finishInspect.resolve(disk(1));
		await subject.dispose();
	}
});

test("refresh stops before the next document when Save As becomes busy during a read", {
	timeout: 10_000,
}, async () => {
	const inspecting = deferred(),
		finishInspect = deferred(),
		asked = deferred(),
		answer = deferred();
	let firstRead = true;
	const subject = workspace({
		targetId: 3,
		inspect: (id) => {
			if (id === 1 && firstRead) {
				firstRead = false;
				inspecting.resolve();
				return finishInspect.promise;
			}
			return { ...subject.live.get(id) };
		},
		decide: (request) => {
			asked.resolve(request);
			return answer.promise;
		},
	});
	try {
		const original = await subject.open(1);
		const other = await subject.open(2);
		subject.buffers.get(original).setSource("retained original edits");
		subject.live.set(2, {
			...disk(2),
			source: "external second version",
			revision: "new:2",
		});
		const refreshing = subject.controller.refresh();
		await waitFor(inspecting.promise, "the first refresh read");
		const saving = subject.controller.dispatch({
			type: "save",
			key: original,
			mode: "as",
		});
		assert.equal(
			(await waitFor(asked.promise, "Save As confirmation")).target.id,
			3,
		);
		assert.equal(subject.controller.snapshot().busy, true);
		await waitFor(subject.controller.refresh(), "a new refresh while busy");
		assert.deepEqual(
			subject.reads,
			[1],
			"a new refresh cannot add reads while busy",
		);
		finishInspect.resolve(disk(1));
		await waitFor(refreshing, "the refresh already in progress");
		assert.deepEqual(
			subject.reads,
			[1],
			"the in-flight refresh cannot advance to the second document",
		);
		assert.equal(subject.buffers.get(other).getSource(), "disk 2");
		assert.equal(subject.document(other).conflict, null);
		answer.resolve("cancel");
		assert.deepEqual(await waitFor(saving, "cancelled Save As"), {
			accepted: true,
			saved: false,
		});
		await waitFor(
			subject.controller.refresh(),
			"refresh after Save As finishes",
		);
		assert.deepEqual(subject.reads, [1, 1, 2]);
		assert.equal(
			subject.buffers.get(other).getSource(),
			"external second version",
		);
		assert.equal(
			subject.buffers.get(original).getSource(),
			"retained original edits",
		);
	} finally {
		finishInspect.resolve(disk(1));
		answer.resolve("cancel");
		await subject.dispose();
	}
});

test("disk adoption retains both buffers when its recovery target opens during inspection", {
	timeout: 10_000,
}, async () => {
	const inspecting = deferred(),
		finishInspect = deferred();
	const subject = workspace({
		save: failedSave,
		decide: (request) => (request.kind === "adopt" ? "disk" : "replace"),
		inspect: (id) => {
			assert.equal(id, 2);
			inspecting.resolve();
			return finishInspect.promise;
		},
	});
	try {
		const original = await failSaveAs(subject);
		const recovery = subject.document(original).conflict;
		const adopting = subject.controller.dispatch({
			type: "adopt",
			key: original,
		});
		await waitFor(inspecting.promise, "the recovery target inspection");
		assert.equal(subject.controller.snapshot().busy, true);
		// Public reference acceptance may finish while a command is busy; UI Open is blocked.
		const other = await subject.open(2);
		const sibling = subject.document(other);
		assert.notEqual(other, original);
		finishInspect.resolve(disk(2));
		await waitFor(adopting, "disk adoption after the target opened");
		assert.equal(subject.controller.snapshot().documents.length, 2);
		assert.equal(subject.buffers.get(original).getSource(), "edited original");
		assert.deepEqual(subject.document(original).location, {
			id: 1,
			path: disk(1).path,
		});
		assert.deepEqual(subject.document(original).conflict, recovery);
		assert.equal(subject.document(original).dirty, true);
		assert.match(subject.document(original).saveNotice.message, /already open/);
		assert.equal(subject.buffers.get(other).getSource(), "disk 2");
		assert.deepEqual(subject.document(other), sibling);
		assert.equal(
			subject.writes.length,
			1,
			"only the failed Save As attempted a write",
		);
	} finally {
		finishInspect.resolve(disk(2));
		await subject.dispose();
	}
});

test("saving the observed recovery target refuses a sibling tab before confirmation or write", {
	timeout: 10_000,
}, async () => {
	const subject = workspace({ save: failedSave });
	try {
		const original = await failSaveAs(subject);
		const recovery = subject.document(original).conflict;
		const other = await subject.open(2);
		subject.buffers.get(other).setSource("independent sibling edits");
		const sibling = subject.document(other);
		assert.equal(subject.decisions.length, 1);
		assert.equal(subject.writes.length, 1);
		assert.deepEqual(
			await subject.controller.dispatch({
				type: "save",
				key: original,
				mode: "observed",
			}),
			{ accepted: true, saved: false },
		);
		assert.equal(
			subject.decisions.length,
			1,
			"the open sibling blocks a second confirmation",
		);
		assert.equal(
			subject.writes.length,
			1,
			"the open sibling blocks another write",
		);
		assert.equal(subject.buffers.get(original).getSource(), "edited original");
		assert.deepEqual(subject.document(original).location, {
			id: 1,
			path: disk(1).path,
		});
		assert.deepEqual(subject.document(original).conflict, recovery);
		assert.match(subject.document(original).saveNotice.message, /already open/);
		assert.equal(
			subject.buffers.get(other).getSource(),
			"independent sibling edits",
		);
		assert.deepEqual(subject.document(other), sibling);
		assert.equal(subject.live.get(2).source, "disk 2");
	} finally {
		await subject.dispose();
	}
});

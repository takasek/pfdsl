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
const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
async function waitFor(promise, description) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(`Timed out after 5000 ms waiting for ${description}`),
						),
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

function handleWorkspace({
	release = async () => {},
	decide = async () => "replace",
} = {}) {
	const live = new Map([1, 2, 3, 4].map((id) => [id, disk(id)])),
		buffers = new Map(),
		releases = [],
		remembered = [];
	const controller = createWorkspaceController({
		files: {
			chooseDocument: async () => null,
			openPath: async (path) => ({ ...disk(1), path }),
			chooseSaveTarget: async () => live.get(2),
			inspect: async (id) => ({ ...live.get(id) }),
			save: async (request) => {
				const target = live.get(request.id);
				assert.ok(target, "the save capability is still live");
				target.source = request.source;
				return { outcome: "saved", current: { ...target } };
			},
			release: async (id) => {
				await release(id);
				assert.equal(live.delete(id), true, `release ${id} only once`);
				releases.push(id);
			},
		},
		editors: {
			create(initial, events) {
				let source = initial.source,
					revision = 0;
				const buffer = {
					location: initial.location,
					saved: initial.source,
					getSource: () => source,
					getRevision: () => revision,
					setSource(value) {
						source = value;
						revision++;
						events.changed();
					},
					setLocation(path, _name, id) {
						buffer.location = { path, id };
					},
					markSaved(value) {
						buffer.saved = value;
					},
					dispose() {},
				};
				buffers.set(initial.key, buffer);
				return buffer;
			},
		},
		decisions: { request: decide },
		host: {
			capabilities: async () => ({ save: true, reason: null }),
			recent: async () => [],
			rememberDocument: async (path) => {
				remembered.push(path);
			},
			chooseFolder: async () => null,
			openRecentFolder: async () => "/work",
			listDocuments: async () => [],
			rememberFolder: async () => {},
			finishQuit: async () => {},
		},
	});
	return { controller, live, buffers, releases, remembered };
}

test("repeated reference rebinds release each old capability without a foreground command", async () => {
	const subject = handleWorkspace(),
		{ controller } = subject;
	try {
		await controller.ready;
		await controller.accept(disk(1));
		for (const id of [3, 4]) {
			await controller.accept({ ...disk(1), id });
			await waitFor(controller.idle(), "old capabilities to be released");
			assert.equal(controller.snapshot().documents.length, 1);
			assert.equal(controller.snapshot().documents[0].location.id, id);
			assert.deepEqual(subject.releases, id === 3 ? [1] : [1, 3]);
		}
	} finally {
		controller.dispose();
		await waitFor(controller.idle(), "workspace disposal");
	}
});

test("Save As commits location and saved notice even when old-handle cleanup fails once", async () => {
	let attempts = 0;
	const subject = handleWorkspace({
			release: async (id) => {
				if (id === 1 && ++attempts === 1)
					throw new Error("temporary release failure");
			},
		}),
		{ controller } = subject;
	try {
		await controller.ready;
		await controller.accept(disk(1));
		const { key } = controller.snapshot().documents[0],
			buffer = subject.buffers.get(key);
		buffer.setSource("saved body");
		assert.deepEqual(
			await controller.dispatch({ type: "save", key, mode: "as" }),
			{ accepted: true, saved: true },
		);
		assert.deepEqual(buffer.location, { path: "/work/2.pfdsl", id: 2 });
		assert.equal(buffer.saved, "saved body");
		assert.equal(controller.snapshot().documents[0].notice.message, "Saved.");
		assert.match(controller.snapshot().appNotice, /temporary release failure/);
		assert.ok(subject.remembered.includes("/work/2.pfdsl"));
		assert.deepEqual(subject.releases, [1]);
		assert.equal(attempts, 2, "the command cleanup retries the failed release");
	} finally {
		controller.dispose();
		await waitFor(controller.idle(), "workspace disposal");
	}
});

test("a sweep already awaiting release cannot consume a later Save As target", async () => {
	const held = deferred(),
		finishRelease = deferred(),
		requested = deferred(),
		answer = deferred();
	const subject = handleWorkspace({
			release: async (id) => {
				if (id === 3) {
					held.resolve();
					await finishRelease.promise;
				}
			},
			decide: (request) => {
				requested.resolve(request);
				return answer.promise;
			},
		}),
		{ controller } = subject;
	try {
		await controller.ready;
		await controller.accept(disk(1));
		const { key } = controller.snapshot().documents[0];
		subject.buffers.get(key).setSource("retained body");
		const accepting = controller.accept(disk(3), () => false);
		await waitFor(
			held.promise,
			"release of invalidated snapshot 3 before Save As",
		);
		const saving = controller.dispatch({ type: "save", key, mode: "as" });
		assert.equal(
			(await waitFor(requested.promise, "Save As confirmation for target 2"))
				.target.id,
			2,
		);
		finishRelease.resolve();
		await waitFor(accepting, "the held accept cleanup to finish");
		assert.equal(subject.live.has(2), true);
		answer.resolve("replace");
		assert.deepEqual(
			await waitFor(saving, "Save As to finish after confirmation"),
			{
				accepted: true,
				saved: true,
			},
		);
	} finally {
		finishRelease.resolve();
		answer.resolve("cancel");
		controller.dispose();
		await waitFor(
			controller.idle(),
			"workspace disposal after releasing held work",
		);
	}
});

test("workspace binds a pending save and notice to its initiating document while activation remains available", async () => {
	const answer = deferred(),
		requested = deferred(),
		buffers = new Map(),
		writes = [],
		releases = [];
	const controller = createWorkspaceController({
		files: {
			chooseDocument: async () => null,
			openPath: async () => disk(1),
			chooseSaveTarget: async () => disk(3),
			inspect: async (id) => disk(id),
			save: async (request) => {
				writes.push(request);
				return {
					outcome: "saved",
					current: { ...disk(request.id), source: request.source },
				};
			},
			release: async (id) => {
				releases.push(id);
			},
		},
		editors: {
			create(initial, events) {
				let source = initial.source,
					revision = 0;
				const buffer = {
					getSource: () => source,
					getRevision: () => revision,
					setSource(value) {
						source = value;
						revision++;
						events.changed();
					},
					dispose() {},
				};
				buffers.set(initial.key, buffer);
				return buffer;
			},
		},
		decisions: {
			request(request) {
				requested.resolve(request);
				return answer.promise;
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
	try {
		await controller.ready;
		await controller.accept(disk(1));
		await controller.accept(disk(2));
		const [first, second] = controller.snapshot().documents;
		buffers.get(first.key).setSource("first edited");
		const saving = controller.dispatch({
			type: "save",
			key: first.key,
			mode: "as",
		});
		const review = await waitFor(
			requested.promise,
			"Save As confirmation for target 3",
		);
		assert.equal(review.document, first.key);
		assert.equal(review.editor, "first edited");
		assert.deepEqual(
			await waitFor(
				controller.dispatch({ type: "new" }),
				"new-document rejection while Save As awaits confirmation",
			),
			{ accepted: false },
		);
		assert.equal(
			(
				await waitFor(
					controller.dispatch({ type: "activate", key: second.key }),
					"document activation while Save As awaits confirmation",
				)
			).accepted,
			true,
		);
		answer.resolve("replace");
		assert.deepEqual(
			await waitFor(saving, "Save As to finish after confirmation"),
			{
				accepted: true,
				saved: true,
			},
		);
		const snapshot = controller.snapshot();
		assert.equal(snapshot.active, second.key);
		assert.deepEqual(writes, [
			{ id: 3, source: "first edited", expected: "revision:3" },
		]);
		assert.equal(snapshot.documents[0].notice.message, "Saved.");
		assert.equal(snapshot.documents[1].notice, null);
		assert.equal("session" in snapshot.documents[0], false);
	} finally {
		answer.resolve("cancel");
		controller.dispose();
		await waitFor(
			controller.idle(),
			"workspace disposal after answering Save As",
		);
	}
	assert.deepEqual(releases.sort(), [1, 2, 3]);
});

for (const incoming of ["adopted", "invalidated"])
	test(`accepting an ${incoming} snapshot preserves a Save As target awaiting confirmation`, async () => {
		const answer = deferred(),
			requested = deferred(),
			buffers = new Map(),
			live = new Map([1, 2, 3].map((id) => [id, disk(id)])),
			releases = [];
		const controller = createWorkspaceController({
			files: {
				chooseDocument: async () => null,
				openPath: async () => disk(1),
				chooseSaveTarget: async () => disk(2),
				inspect: async (id) => ({ ...live.get(id) }),
				save: async (request) => {
					const target = live.get(request.id);
					if (!target) throw new Error("Unknown document");
					assert.equal(request.expected, target.revision);
					target.source = request.source;
					return { outcome: "saved", current: { ...target } };
				},
				release: async (id) => {
					assert.equal(live.delete(id), true, `release ${id} only once`);
					releases.push(id);
				},
			},
			editors: {
				create(initial, events) {
					let source = initial.source,
						revision = 0;
					const buffer = {
						getSource: () => source,
						getRevision: () => revision,
						setSource(value) {
							source = value;
							revision++;
							events.changed();
						},
						dispose() {},
					};
					buffers.set(initial.key, buffer);
					return buffer;
				},
			},
			decisions: {
				request(request) {
					requested.resolve(request);
					return answer.promise;
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
		try {
			await controller.ready;
			await controller.accept(disk(1));
			const original = controller.snapshot().documents[0];
			buffers.get(original.key).setSource("retained editor");
			const saving = controller.dispatch({
				type: "save",
				key: original.key,
				mode: "as",
			});
			assert.equal(
				(await waitFor(requested.promise, "Save As confirmation for target 2"))
					.target.id,
				2,
			);
			await waitFor(
				controller.accept(disk(3), () => incoming === "adopted"),
				`${incoming} snapshot acceptance while Save As awaits confirmation`,
			);
			assert.equal(
				live.has(2),
				true,
				"the pending target is still owned by Save As",
			);
			assert.deepEqual(releases, incoming === "adopted" ? [] : [3]);
			answer.resolve("replace");
			assert.deepEqual(
				await waitFor(saving, "Save As to finish after confirmation"),
				{
					accepted: true,
					saved: true,
				},
			);
			assert.equal(live.get(2).source, "retained editor");
			assert.equal(
				controller
					.snapshot()
					.documents.find((item) => item.key === original.key).location.id,
				2,
			);
		} finally {
			answer.resolve("cancel");
			controller.dispose();
			await waitFor(
				controller.idle(),
				"workspace disposal after answering Save As",
			);
		}
		assert.deepEqual(releases.sort(), [1, 2, 3]);
	});

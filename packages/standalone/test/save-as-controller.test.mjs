import assert from "node:assert/strict";
import { after, test } from "node:test";
import { runSaveAsCase, SAVE_AS_CASES } from "./helpers/save-as-contract.mjs";
import { createSaveAsControllerAdapter } from "./helpers/save-as-controller-adapter.mjs";

const adapter = await createSaveAsControllerAdapter();
after(() => adapter.close());
for (const name of SAVE_AS_CASES)
	test(`Save As controller | ${name}`, async () => {
		await runSaveAsCase(name, adapter.createSubject);
	});

const disk = (id, source = `disk ${id}`) => ({
	id,
	path: `/work/${id}.pfdsl`,
	binding: `file:${id}`,
	identity: `inode:${id}`,
	source,
	revision: source === null ? null : `revision:${id}`,
});
function operation(initial = disk(1)) {
	let source = initial?.source ?? "",
		revision = 0,
		chosen;
	const view = {
		getSource: () => source,
		getRevision: () => revision,
		setSource(value) {
			source = value;
			revision++;
		},
	};
	const record = {
		key: "document-1",
		untitledName: "Untitled 1",
		session: new adapter.DocumentSession(view, initial),
	};
	const documents = new adapter.DocumentRecords(),
		signal = new AbortController().signal;
	const writes = [],
		releases = [],
		reviews = [];
	documents.add(record);
	if (initial) documents.track(initial.id);
	const files = {
		async chooseSaveTarget() {
			chosen = disk(2);
			return chosen;
		},
		async save(request) {
			writes.push(request);
			return {
				outcome: "saved",
				current: { ...chosen, source: request.source },
			};
		},
		async release(id) {
			releases.push(id);
		},
	};
	const decisions = {
		async replace(request) {
			reviews.push(request);
			return "replace";
		},
	};
	const controller = adapter.createSaveAsController({
		documents,
		files,
		decisions,
	});
	return {
		record,
		documents,
		files,
		decisions,
		writes,
		releases,
		reviews,
		view,
		signal,
		choose(target) {
			files.chooseSaveTarget = async () => {
				chosen = target;
				return target;
			};
		},
		save: (confirmation) =>
			controller.saveAs(record.key, {
				signal,
				...(confirmation ? { confirmation } : {}),
			}),
	};
}

for (const source of [null, "local"])
	test(`Save As chosen ${source === null ? "missing" : "identical"} target saves without an additional decision`, async () => {
		const subject = operation(null);
		subject.view.setSource("local");
		subject.choose(disk(2, source));
		const result = await subject.save();
		assert.equal(result.kind, "saved");
		assert.equal(subject.reviews.length, 0);
		assert.deepEqual(subject.writes, [
			{
				id: 2,
				source: "local",
				expected: source === null ? null : "revision:2",
			},
		]);
		assert.equal(subject.record.session.location.path, "/work/2.pfdsl");
	});

test("untitled close confirmation is checked after the chooser and before a replacement request", async () => {
	const subject = operation(null);
	subject.view.setSource("local");
	const confirmation = subject.record.session.plan("close", null);
	subject.files.chooseSaveTarget = async () => {
		subject.view.setSource("later");
		return disk(2);
	};
	const result = await subject.save(confirmation);
	assert.equal(result.kind, "stale");
	assert.equal(subject.reviews.length, 0);
	assert.deepEqual(subject.writes, []);
	assert.deepEqual(subject.releases, [2]);
	assert.equal(subject.view.getSource(), "later");
});

test("choosing another file stays in one operation and releases the unused earlier target", async () => {
	const subject = operation();
	subject.view.setSource("local");
	subject.decisions.replace = async (request) => {
		subject.reviews.push(request);
		assert.deepEqual(Object.keys(request).sort(), [
			"document",
			"editor",
			"editorVersion",
			"kind",
			"target",
		]);
		assert.equal(Object.isFrozen(request.target), true);
		subject.choose(disk(3, null));
		return "another";
	};
	const result = await subject.save();
	assert.equal(result.kind, "saved");
	assert.equal(subject.reviews.length, 1);
	assert.deepEqual(subject.writes, [
		{ id: 3, source: "local", expected: null },
	]);
	assert.deepEqual(subject.releases, [1, 2]);
	assert.equal(subject.record.session.location.id, 3);
});

test("a target owned by another document is blocked and only the unused chooser capability is released", async () => {
	const subject = operation();
	subject.view.setSource("local");
	const otherDisk = { ...disk(2), id: 99 };
	const other = {
		key: "document-2",
		untitledName: "Other",
		session: new adapter.DocumentSession(
			{ getSource: () => "other", setSource() {} },
			otherDisk,
		),
	};
	subject.documents.add(other);
	subject.documents.track(99);
	const result = await subject.save();
	assert.equal(result.kind, "blocked");
	assert.match(result.message, /already open/);
	assert.equal(subject.reviews.length, 0);
	assert.deepEqual(subject.writes, []);
	assert.deepEqual(subject.releases, [2]);
	assert.equal(subject.documents.get(other.key), other);
});

test("rebinding during review keeps the stable record key and invalidates its earlier save plan", async () => {
	const subject = operation();
	subject.view.setSource("local");
	subject.decisions.replace = async () => {
		const rebound = { ...disk(1), id: 3, path: "/moved/renamed.pfdsl" };
		assert.equal(subject.record.session.rebindDisk(rebound), true);
		subject.documents.track(3);
		return "replace";
	};
	const result = await subject.save();
	assert.equal(result.kind, "stale");
	assert.deepEqual(subject.writes, []);
	assert.equal(subject.documents.get("document-1"), subject.record);
	assert.equal(subject.record.session.location.path, "/moved/renamed.pfdsl");
	assert.deepEqual(subject.releases, [1, 2]);
});

test("overlapping unused-handle sweeps wait for one release and permit retry after a failed release", async () => {
	const documents = new adapter.DocumentRecords(),
		calls = [];
	documents.track(7);
	let complete;
	const release = (id) => {
		calls.push(id);
		return new Promise((resolve) => {
			complete = resolve;
		});
	};
	const first = documents.releaseUnused(release),
		second = documents.releaseUnused(release);
	await Promise.resolve();
	assert.deepEqual(calls, [7]);
	complete();
	await Promise.all([first, second]);
	await documents.releaseUnused(release);
	assert.deepEqual(calls, [7]);
	documents.track(8);
	await assert.rejects(
		documents.releaseUnused(async () => {
			throw new Error("release failed");
		}),
		/release failed/,
	);
	await documents.releaseUnused(async (id) => {
		calls.push(id);
	});
	assert.deepEqual(calls, [7, 8]);
});

test("Save As retains the operation error when unused-target cleanup also fails", async () => {
	const subject = operation(),
		failure = new Error("decision failed");
	subject.view.setSource("local");
	subject.decisions.replace = async () => {
		throw failure;
	};
	subject.files.release = async () => {
		throw new Error("release failed");
	};
	await assert.rejects(subject.save(), (error) => {
		assert.equal(error.cause, failure);
		assert.equal(error.errors[0], failure);
		assert.match(String(error.errors[1]), /release failed/);
		return true;
	});
	assert.deepEqual(subject.writes, []);
	assert.equal(subject.view.getSource(), "local");
	await subject.documents.releaseUnused(async (id) => {
		subject.releases.push(id);
	});
	assert.deepEqual(subject.releases, [2]);
});

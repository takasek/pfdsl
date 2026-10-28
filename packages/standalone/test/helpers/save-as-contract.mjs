import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

export const SAVE_AS_TEXT = {
	original: "original A\n",
	target: "original B\n",
	local: "local edits\n",
	later: "later edits\n",
};

export const SAVE_AS_CASES = [
	"overwrite",
	"edit-during-review",
	"undo-during-review",
	"cancel-review",
	"cancel-chooser",
	"reply-lost-before",
	"reply-lost-after",
	"dispose-during-review",
	"late-choice-after-dispose",
];

const deferred = () => {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

/**
 * The factory opens A and supplies edit, saveAs, dispose, idle, snapshot and events.
 * onReview(review, subject) returns replace/cancel; choose(snapshot) may be delayed.
 * saveFault loses the native reply before/after publication. An optional cleanup
 * disposes adapter resources. Assertions use only editor, displayed review, native
 * request, file content and release observations, never private session state.
 */
export async function runSaveAsCase(name, createSubject) {
	assert.ok(SAVE_AS_CASES.includes(name), `Unknown Save As case: ${name}`);
	const options = {};
	const choiceStarted = deferred();
	const choiceAnswer = deferred();
	if (name === "cancel-chooser") options.choose = () => null;
	if (name.startsWith("reply-lost-"))
		options.saveFault = name.endsWith("before") ? "before" : "after";
	options.onReview = (_review, subject) => {
		if (name === "edit-during-review" || name === "undo-during-review") {
			subject.edit(SAVE_AS_TEXT.later);
			if (name === "undo-during-review") subject.edit(SAVE_AS_TEXT.local);
		}
		if (name === "dispose-during-review") subject.dispose();
		return name === "cancel-review" ? "cancel" : "replace";
	};
	if (name === "late-choice-after-dispose")
		options.choose = async (snapshot) => {
			choiceStarted.resolve();
			await choiceAnswer.promise;
			return snapshot;
		};
	const started = performance.now();
	const subject = await createSubject(options);
	const setupMs = performance.now() - started;
	const checks = [];
	const equal = (id, actual, expected) => {
		assert.deepEqual(actual, expected, `${name}: ${id}`);
		checks.push(id);
	};
	try {
		const before = subject.snapshot();
		subject.edit(SAVE_AS_TEXT.local);
		const saving = subject.saveAs();
		if (name === "late-choice-after-dispose") {
			await choiceStarted.promise;
			subject.dispose();
			choiceAnswer.resolve();
		}
		await saving;
		await subject.idle();
		const after = subject.snapshot();
		const events = subject.events;
		const reviews = events.filter((item) => item.kind === "review");
		const saves = events.filter((item) => item.kind === "save");
		const released = (id) =>
			events.filter((item) => item.kind === "release" && item.id === id).length;
		const disposed = name.includes("dispose");
		const noReview =
			name === "cancel-chooser" || name === "late-choice-after-dispose";
		equal("review.count", reviews.length, noReview ? 0 : 1);
		if (!noReview)
			equal("review.content-and-target", reviews[0], {
				kind: "review",
				title: "Review the target",
				editor: SAVE_AS_TEXT.local,
				disk: before.target.source,
				id: before.target.id,
				path: before.target.path,
				revision: before.target.revision,
			});
		const submitted = name === "overwrite" || name.startsWith("reply-lost-");
		equal("save.count", saves.length, submitted ? 1 : 0);
		if (submitted)
			equal("save.matches-confirmed-version", saves[0], {
				kind: "save",
				id: before.target.id,
				source: SAVE_AS_TEXT.local,
				expected: before.target.revision,
			});
		const published = name === "overwrite" || name === "reply-lost-after";
		equal(
			"file.original-unchanged",
			after.original.source,
			SAVE_AS_TEXT.original,
		);
		equal(
			"file.target-content",
			after.target.source,
			published ? SAVE_AS_TEXT.local : SAVE_AS_TEXT.target,
		);
		equal("file.target-write-count", after.target.writes, published ? 1 : 0);
		equal(
			"editor.content",
			after.editor,
			name === "edit-during-review" ? SAVE_AS_TEXT.later : SAVE_AS_TEXT.local,
		);
		equal("editor.open", after.open, !disposed);
		if (!disposed) {
			equal("editor.dirty", after.dirty, name !== "overwrite");
			equal(
				"editor.location",
				after.location,
				name === "overwrite" ? before.target.path : before.original.path,
			);
			equal(
				"recovery.target",
				after.recoveryPath,
				name.startsWith("reply-lost-") ? before.target.path : null,
			);
		}
		equal(
			"handle.original-retained-until-unowned",
			released(before.original.id),
			name === "overwrite" || disposed ? 1 : 0,
		);
		const targetReleased =
			disposed ||
			["edit-during-review", "undo-during-review", "cancel-review"].includes(
				name,
			);
		equal(
			"handle.target-retained-until-unowned",
			released(before.target.id),
			targetReleased ? 1 : 0,
		);
		subject.dispose();
		subject.dispose();
		await subject.idle();
		equal("handle.original-released-once", released(before.original.id), 1);
		equal(
			"handle.target-released-once",
			released(before.target.id),
			name === "cancel-chooser" ? 0 : 1,
		);
		return {
			name,
			setupMs,
			totalMs: performance.now() - started,
			checks,
			before,
			after,
			events: structuredClone(events),
		};
	} finally {
		choiceAnswer.resolve();
		subject.dispose();
		await subject.idle();
		await subject.cleanup?.();
	}
}

export async function runSaveAsContract(createSubject) {
	const results = [];
	for (const name of SAVE_AS_CASES)
		results.push(await runSaveAsCase(name, createSubject));
	return results;
}

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { SAVE_AS_TEXT } from "./save-as-contract.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
export const SAVE_AS_CONTROLLER_FAULTS = {
	"skip-review": [
		"save-as-controller.ts",
		"if (review) {",
		"if (false) {",
		"overwrite",
	],
	"skip-plan-validation": [
		"document-session.ts",
		'if (!this.holds(plan)) return { saved: false, stale: true, message: "" };',
		"",
		"undo-during-review",
	],
	"wrong-body": [
		"save-as-controller.ts",
		"source: request.editor,",
		'source: "wrong body",',
		"overwrite",
	],
	"wrong-target": [
		"save-as-controller.ts",
		"id: request.target!.id,",
		"id: 1,",
		"overwrite",
	],
	"wrong-revision": [
		"save-as-controller.ts",
		"expected: request.revision,",
		'expected: "wrong revision",',
		"overwrite",
	],
	"leak-late-choice": [
		"save-as-controller.ts",
		"retained.push(documents.retain(target.id));",
		"if (!signal.aborted) retained.push(documents.retain(target.id));",
		"late-choice-after-dispose",
	],
};

/** Only the controller, records and existing session are loaded; no browser realm is required. */
export async function createSaveAsControllerAdapter({
	sourceRoot = root,
	fault,
} = {}) {
	const source = join(sourceRoot, "packages/standalone/src");
	const temporary = mkdtempSync(
		join(root, "packages/standalone/node_modules/.save-as-controller-"),
	);
	const mutation = fault && SAVE_AS_CONTROLLER_FAULTS[fault];
	assert.ok(!fault || mutation, `Unknown Save As fault: ${fault}`);
	let matches = 0;
	try {
		await build({
			entryPoints: {
				controller: join(source, "save-as-controller.ts"),
				records: join(source, "document-records.ts"),
				session: join(source, "document-session.ts"),
			},
			outdir: temporary,
			bundle: true,
			splitting: true,
			format: "esm",
			platform: "node",
			outExtension: { ".js": ".mjs" },
			plugins: mutation
				? [
						{
							name: "save-as-fault",
							setup(builder) {
								builder.onLoad({ filter: /\.ts$/ }, (args) => {
									if (args.path !== join(source, mutation[0])) return;
									const text = readFileSync(args.path, "utf8");
									matches = text.split(mutation[1]).length - 1;
									assert.equal(matches, 1, `${fault}: unique source location`);
									return {
										contents: text.replace(mutation[1], () => mutation[2]),
										loader: "ts",
									};
								});
							},
						},
					]
				: [],
		});
		if (mutation)
			assert.equal(matches, 1, `${fault}: production source was loaded`);
	} catch (error) {
		rmSync(temporary, { recursive: true, force: true });
		throw error;
	}
	const { createSaveAsController } = await import(
		pathToFileURL(join(temporary, "controller.mjs")).href
	);
	const { DocumentRecords } = await import(
		pathToFileURL(join(temporary, "records.mjs")).href
	);
	const { DocumentSession } = await import(
		pathToFileURL(join(temporary, "session.mjs")).href
	);
	return {
		close: () => rmSync(temporary, { recursive: true, force: true }),
		createSaveAsController,
		DocumentRecords,
		DocumentSession,
		async createSubject(options = {}) {
			const original = {
				id: 1,
				path: "/A/a.pfdsl",
				source: SAVE_AS_TEXT.original,
				revision: "A:1",
				identity: "A",
				binding: "dir:a.pfdsl",
				writes: 0,
			};
			const target = {
				id: 2,
				path: "/A/b.pfdsl",
				source: SAVE_AS_TEXT.target,
				revision: "B:1",
				identity: "B",
				binding: "dir:b.pfdsl",
				writes: 0,
			};
			const filesById = new Map([
					[1, original],
					[2, target],
				]),
				events = [],
				documents = new DocumentRecords(),
				lifetime = new AbortController();
			let text = original.source,
				version = 0,
				current = Promise.resolve(),
				cleanup = Promise.resolve(),
				disposed = false,
				subject;
			const view = {
				getSource: () => text,
				getRevision: () => version,
				setSource(value) {
					text = value;
					version++;
				},
			};
			const record = {
				key: "document-1",
				untitledName: "Untitled 1",
				session: new DocumentSession(view, { ...original }),
			};
			documents.add(record);
			documents.track(original.id);
			const files = {
				async chooseSaveTarget() {
					return options.choose ? options.choose({ ...target }) : { ...target };
				},
				async save(request) {
					events.push({ kind: "save", ...request });
					if (options.saveFault === "before")
						throw new Error("native reply lost");
					const file = filesById.get(request.id);
					let result;
					if (file.revision !== request.expected)
						result = {
							outcome: "conflict",
							current: { ...file },
							publication: "not-published",
							targetState: "readable",
						};
					else {
						const changed = file.source !== request.source;
						if (changed) {
							file.source = request.source;
							file.writes++;
							file.revision = `${file.id}:${file.writes + 1}`;
						}
						result = {
							outcome: "saved",
							current: { ...file },
							publication: changed ? "published" : "not-published",
							targetState: "readable",
						};
					}
					if (options.saveFault === "after")
						throw new Error("native reply lost");
					return result;
				},
				async release(id) {
					events.push({ kind: "release", id });
				},
			};
			const controller = createSaveAsController({
				documents,
				files,
				decisions: {
					async replace(request) {
						const review = {
							kind: "review",
							title: "Review the target",
							editor: request.editor,
							disk: request.target.source,
							id: request.target.id,
							path: request.target.path,
							revision: request.target.revision,
						};
						events.push(review);
						return options.onReview?.(review, subject) ?? "replace";
					},
				},
			});
			subject = {
				events,
				edit: (value) => view.setSource(value),
				saveAs() {
					current = controller.saveAs(record.key, { signal: lifetime.signal });
					return current;
				},
				dispose() {
					if (disposed) return;
					disposed = true;
					lifetime.abort();
					record.session.dispose();
					documents.delete(record.key);
					cleanup = documents.releaseUnused(files.release);
				},
				async idle() {
					await current;
					await cleanup;
				},
				snapshot() {
					return {
						editor: text,
						open: documents.get(record.key) === record,
						dirty: record.session.isDirty(),
						location: record.session.location?.path ?? null,
						recoveryPath: record.session.panel()?.targetPath ?? null,
						original: { ...original },
						target: { ...target },
					};
				},
			};
			return subject;
		},
	};
}

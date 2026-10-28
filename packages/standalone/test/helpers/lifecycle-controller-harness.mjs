import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
	createLifecycleEvidence,
	createNativeRecorder,
} from "./lifecycle-evidence.mjs";
import { fsOf } from "./lifecycle-native.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const titles = {
	replace: "Review the target",
	recreate: "Recreate missing file",
	adopt: "Discard editor changes",
};
const labels = {
	replace: "Replace Observed Version",
	create: "Create File",
	disk: "Use Disk Version",
	cancel: "Keep Editing",
	another: "Choose Another File",
};

/** Drives the production controller through files, decisions and editor buffers. */
export async function createHarness(label, { sourceRoot = root } = {}) {
	const temporary = mkdtempSync(
		join(root, `packages/standalone/node_modules/.${label}-controller-`),
	);
	const output = join(temporary, "controller.mjs");
	await build({
		entryPoints: [
			join(sourceRoot, "packages/standalone/src/workspace-controller.ts"),
		],
		outfile: output,
		bundle: true,
		platform: "node",
		format: "esm",
		packages: "external",
	});
	after(() => rmSync(temporary, { recursive: true, force: true }));
	const { createWorkspaceController } = await import(
		pathToFileURL(output).href
	);
	return {
		async startHost(native, watched, handlers = {}) {
			const evidence = createLifecycleEvidence(native);
			const { log, ledger, tick, learn, approve } = evidence;
			const views = new Map();
			const adoptions = new Map();
			const polls = new Set();
			let selected,
				selection,
				operationOwner,
				closing = false;
			const leaks = [];
			const recorder = createNativeRecorder(
				native,
				evidence,
				handlers,
				() => operationOwner,
			);
			const nativeCall = (name, body) => {
				if (closing && name !== "release_document") leaks.push(name);
				return body();
			};
			const controller = createWorkspaceController({
				files: {
					async chooseDocument() {
						selection = native.snapshot(selected);
						learn(selection);
						return selection;
					},
					async openPath(path) {
						const snapshot = native.snapshot(
							[...native.docs.values()].find((doc) => doc.path === path),
						);
						learn(snapshot);
						return snapshot;
					},
					chooseSaveTarget: (name) =>
						nativeCall("choose_save_target", () => recorder.choose(name)),
					inspect: (id) =>
						nativeCall("inspect_document", () => recorder.inspect(id)),
					save: (request) =>
						nativeCall("save_document", () => recorder.save(request)),
					release: async (id) => {
						log.push({ kind: "release", id, seq: tick() });
					},
				},
				editors: {
					create(initial, events) {
						const normalize = handlers.normalize ?? ((text) => text);
						let text = normalize(initial.source),
							revision = 0;
						const tab = {
							key: initial.key,
							name: initial.name,
							location: initial.location?.path,
							nativeId: initial.location?.id,
							setSourceCalls: 0,
							getSource: () => text,
							getRevision: () => revision,
							type(value) {
								text = value;
								revision++;
								log.push({ kind: "type", tab, text, seq: tick() });
								events.changed();
							},
							setSource(value) {
								text = normalize(value);
								revision++;
								tab.setSourceCalls++;
								const id = adoptions.get(tab)?.id ?? tab.nativeId;
								adoptions.delete(tab);
								log.push({ kind: "reload", tab, text: value, id, seq: tick() });
								if (id !== undefined) approve(id, text, "reload", tab);
								events.changed();
							},
							setLocation(path, name, id) {
								tab.location = path;
								tab.name = name;
								tab.nativeId = id;
							},
							markSaved() {},
							dispose() {
								log.push({ kind: "dispose", tab, seq: tick() });
							},
						};
						views.set(tab.key, tab);
						if (initial.location)
							approve(initial.location.id, text, "open", tab);
						return tab;
					},
				},
				decisions: {
					async request(request) {
						const tab = views.get(request.document);
						operationOwner = tab;
						if (request.kind === "close") {
							const entry = {
								kind: "confirm",
								tab,
								seq: tick(),
								name: request.name,
								allowSave: request.allowSave,
								textAtRequest: request.editor,
								decision: undefined,
								decidedSeq: undefined,
								fsById: Object.fromEntries(
									[...native.docs].map(([id, doc]) => [id, fsOf(native, doc)]),
								),
							};
							log.push(entry);
							entry.decision = await handlers.confirm(request.name);
							entry.decidedSeq = tick();
							return entry.decision;
						}
						const target = request.target;
						const entry = {
							kind: "dialog",
							tab,
							seq: tick(),
							title: titles[request.kind],
							target: target.id,
							editor: request.editor,
							disk: target.source,
							shownEditor: request.editor,
							builtFrom: [...ledger.received, ...ledger.offered]
								.filter((item) => item.id === target.id)
								.sort((first, second) => first.seq - second.seq)
								.at(-1),
							fs: fsOf(native, watched),
							fsById: Object.fromEntries(
								[...native.docs].map(([id, doc]) => [id, fsOf(native, doc)]),
							),
							choice: undefined,
							editorAtClick: undefined,
						};
						log.push(entry);
						handlers.onDecision?.(entry);
						const defaultAnswer =
							request.kind === "replace"
								? "replace"
								: request.kind === "recreate"
									? "create"
									: "cancel";
						const answer = await (handlers.decide?.(request, entry) ??
							defaultAnswer);
						entry.choice = labels[answer];
						entry.editorAtClick = tab.getSource();
						entry.clickSeq = tick();
						if (["replace", "create", "disk"].includes(answer))
							approve(
								target.id,
								request.kind === "recreate" ? null : target.source,
								"approval",
								tab,
							);
						if (answer === "disk") adoptions.set(tab, target);
						return answer;
					},
				},
				host: {
					capabilities: async () =>
						handlers.capabilities?.() ?? { save: true, reason: null },
					recent: async () => [],
					rememberDocument: async () => handlers.remember?.(),
					chooseFolder: async () => null,
					openRecentFolder: async (path) => path,
					listDocuments: async () => [],
					rememberFolder: async () => {},
					finishQuit: async (_request, approved) => {
						log.push({ kind: "exit", approved, seq: tick() });
					},
				},
			});
			await controller.ready;
			const stateOf = (tab) =>
				controller.snapshot().documents.find((doc) => doc.key === tab?.key);
			const activeTab = () => views.get(controller.snapshot().active);
			const dispatch = async (command, tab = activeTab()) => {
				operationOwner = tab;
				try {
					return await controller.dispatch(command);
				} finally {
					adoptions.clear();
				}
			};
			const startPoll = () => {
				const pending = controller.refresh();
				polls.add(pending);
				void pending.then(
					() => polls.delete(pending),
					() => polls.delete(pending),
				);
				return pending;
			};
			const idle = async () => {
				await controller.idle();
				await Promise.allSettled([...polls]);
			};
			return {
				log,
				ledger,
				tick,
				activeTab,
				isOpen: (tab) => Boolean(stateOf(tab)),
				isDirty: (tab) => stateOf(tab)?.dirty ?? false,
				nameOf: (tab) => stateOf(tab)?.name ?? tab.name,
				async open(target) {
					const before = new Set(views.values());
					selected = target;
					selection = undefined;
					await dispatch({ type: "open-file" });
					const tab = activeTab();
					if (
						before.has(tab) &&
						selection?.source !== null &&
						tab.location === selection.path
					) {
						const accepted = ledger.acks.findLast(
							(ack) => ack.tab === tab && ack.content !== undefined,
						);
						if (accepted && accepted.id !== target.id)
							approve(target.id, accepted.content, "rebind", tab);
					}
					return tab;
				},
				async newDocument() {
					await dispatch({ type: "new" });
					return activeTab();
				},
				activate: (tab) => dispatch({ type: "activate", key: tab.key }, tab),
				save: (tab = activeTab()) =>
					dispatch({ type: "save", key: tab.key }, tab),
				saveAs: (tab = activeTab()) =>
					dispatch({ type: "save", key: tab.key, mode: "as" }, tab),
				review: (tab = activeTab()) =>
					dispatch({ type: "save", key: tab.key, mode: "observed" }, tab),
				useDisk: (tab = activeTab()) =>
					dispatch({ type: "adopt", key: tab.key }, tab),
				close: (tab) => dispatch({ type: "close", keys: [tab.key] }, tab),
				quit: (request) => controller.requestQuit(String(request)),
				poll: startPoll,
				startPoll,
				idle,
				status() {
					const state = controller.snapshot(),
						active = stateOf(activeTab());
					return [
						...state.documents.map((doc) => doc.saveNotice?.message),
						active?.notice?.message,
						state.appNotice,
					]
						.filter(Boolean)
						.join("\n");
				},
				conflict() {
					const state = stateOf(activeTab()),
						panel = state?.conflict;
					const saved = ledger.saves.findLast(
						(item) => item.tab === activeTab(),
					);
					return {
						present: Boolean(panel),
						targetId: panel?.observed?.id ?? saved?.id ?? state?.location?.id,
						recoveryPath: panel?.targetPath,
						preview: panel?.observed?.source ?? null,
						originalAlsoChanged: Boolean(panel?.originalChanged),
						actions: {
							review: panel?.actions.review ?? false,
							useDisk: panel?.actions.adopt ?? false,
							saveAs: panel?.actions.saveAs ?? false,
						},
					};
				},
				dispose() {
					closing = true;
					controller.dispose();
				},
				async finish() {
					await idle();
					closing = true;
					controller.dispose();
					await controller.idle();
					return leaks;
				},
			};
		},
	};
}

const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");

// Enabled only in a smoke-built extension. No production source is edited.
function makeTrace(api, capacity = 128) {
	const events = [];
	let dropped = 0,
		sequence = 0,
		nextRequest = 1;
	const safe = (action) => {
		try {
			return action();
		} catch {
			return undefined;
		}
	};
	const documentState = (doc) => ({
		uri: doc.uri?.toString(),
		dirty: doc.isDirty,
		closed: doc.isClosed,
		version: doc.version,
	});
	const tabs = () =>
		api.window.tabGroups.all.slice(0, 8).map((group) => ({
			column: group.viewColumn,
			active: group.isActive,
			tabs: group.tabs.slice(0, 8).map((tab) => ({
				label: tab.label?.slice(0, 160),
				dirty: tab.isDirty,
				active: tab.isActive,
				uri: tab.input?.uri?.toString(),
			})),
		}));
	const record = (kind, data) =>
		safe(() => {
			if (events.length === capacity) {
				events.shift();
				dropped++;
			}
			events.push({ sequence: ++sequence, time: Date.now(), kind, data });
		});
	const state = () =>
		safe(() => ({
			groups: tabs(),
			active: api.window.activeTextEditor
				? documentState(api.window.activeTextEditor.document)
				: null,
			visible: api.window.visibleTextEditors.slice(0, 8).map((editor) => ({
				...documentState(editor.document),
				column: editor.viewColumn,
			})),
		}));
	return {
		record,
		state,
		snapshot: () => ({ events: events.slice(), dropped, state: state() }),
		show: (site, ...args) => {
			const request = nextRequest++;
			record("show.request", {
				request,
				site,
				source: safe(() => documentState(args[0])),
				options: args[1],
				state: state(),
			});
			let result;
			try {
				result = api.window.showTextDocument(...args);
			} catch (error) {
				record("show.throw", { request });
				throw error;
			}
			// Return the original thenable; observers never become the returned chain.
			safe(() =>
				result.then(
					(editor) => {
						safe(() =>
							record("show.resolved", {
								request,
								column: editor.viewColumn,
								source: documentState(editor.document),
								state: state(),
							}),
						);
					},
					() => record("show.rejected", { request }),
				),
			);
			return result;
		},
	};
}

const trace = makeTrace(vscode);
const subscriptions = [];
try {
	for (const [owner, name, kind] of [
		[vscode.window.tabGroups, "onDidChangeTabs", "tabs"],
		[vscode.window.tabGroups, "onDidChangeTabGroups", "groups"],
		[vscode.workspace, "onDidOpenTextDocument", "document.open"],
		[vscode.workspace, "onDidCloseTextDocument", "document.close"],
		[vscode.workspace, "onDidSaveTextDocument", "document.save"],
		[vscode.window, "onDidChangeActiveTextEditor", "editor.active"],
		[vscode.window, "onDidChangeVisibleTextEditors", "editors.visible"],
	]) {
		subscriptions.push(
			owner[name]((event) => {
				try {
					const changed = {};
					for (const field of ["opened", "closed", "changed"]) {
						if (Array.isArray(event?.[field]))
							changed[field] = event[field].slice(0, 8).map((tab) => ({
								label: tab.label?.slice(0, 160),
								uri: tab.input?.uri?.toString(),
								dirty: tab.isDirty,
								column: tab.group?.viewColumn ?? tab.viewColumn,
							}));
					}
					trace.record(kind, { ...changed, state: trace.state() });
				} catch {
					trace.record("event.failed", { kind });
				}
			}),
		);
	}
	const directory = process.env.PFDSL_SMOKE_TRACE_DIRECTORY;
	if (directory) {
		let writing = false,
			pending = false;
		const watcher = fs.watch(directory, (_event, filename) => {
			if (filename !== "capture.request") return;
			pending = true;
			if (writing) return;
			writing = true;
			(async () => {
				do {
					pending = false;
					const request = await fs.promises.readFile(
						path.join(directory, "capture.request"),
						"utf8",
					);
					const payload = JSON.stringify({ request, ...trace.snapshot() });
					const temp = path.join(directory, "capture.tmp");
					await fs.promises.writeFile(temp, payload);
					await fs.promises.rename(temp, path.join(directory, "capture.json"));
				} while (pending);
			})()
				.catch(() => trace.record("capture.failed", {}))
				.finally(() => {
					writing = false;
				});
		});
		watcher.unref();
	}
} catch {
	trace.record("trace.setup.failed", {});
}

module.exports = {
	makeTrace,
	traceShowTextDocument: (...args) => trace.show(...args),
};

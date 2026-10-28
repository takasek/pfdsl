import {
	CheckMenuItem,
	Menu,
	MenuItem,
	PredefinedMenuItem,
	Submenu,
} from "@tauri-apps/api/menu";

export interface MenuState {
	busy: boolean;
	document: boolean;
	save: boolean;
	folder: boolean;
	sidebar: boolean;
	diagram: boolean;
	definition: boolean;
}
export interface RecentTarget {
	kind: "file" | "folder";
	path: string;
}

function commandEnabled(id: string, state: MenuState): boolean {
	if (state.busy) return false;
	if (["new", "open-file", "open", "close-window"].includes(id)) return true;
	if (id === "sidebar") return state.folder;
	if (!state.document) return false;
	if (["save", "save-as"].includes(id)) return state.save;
	if (id === "create-definition") return state.definition;
	if (
		[
			"fit-graph",
			"actual-size",
			"zoom-in",
			"zoom-out",
			"node-actions-toggle",
		].includes(id)
	)
		return state.diagram;
	return true;
}

/** Native and visible entry points dispatch to the same host commands. */
export async function installNativeMenu(
	command: (id: string) => void,
	openRecent: (target: RecentTarget) => void,
	report: (error: unknown) => void,
	signal?: AbortSignal,
) {
	let disposed = false;
	const resources = new Set<{ close(): Promise<void> }>();
	const closed = new WeakSet<object>();
	const close = async (item: { close(): Promise<void> }) => {
		resources.delete(item);
		if (closed.has(item)) return;
		closed.add(item);
		await item.close().catch(report);
	};
	const release = async () => {
		const owned = [...resources];
		await Promise.all(owned.map(close));
	};
	const dispose = () => {
		disposed = true;
		signal?.removeEventListener("abort", dispose);
		void release();
	};
	signal?.addEventListener("abort", dispose, { once: true });
	async function own<T extends { close(): Promise<void> }>(
		promise: Promise<T>,
	): Promise<T> {
		const item = await promise;
		if (disposed || signal?.aborted) {
			await close(item);
			throw new Error("Application disposed");
		}
		resources.add(item);
		return item;
	}
	try {
		const items = new Map<string, MenuItem | CheckMenuItem>();
		const create = async (id: string, text: string, accelerator?: string) => {
			const item = await own(
				MenuItem.new({
					id,
					text,
					enabled: false,
					...(accelerator ? { accelerator } : {}),
					action: () => {
						if (!disposed) command(id);
					},
				}),
			);
			items.set(id, item);
			return item;
		};
		const separator = () => own(PredefinedMenuItem.new({ item: "Separator" }));
		const recent = await own(Submenu.new({ text: "Recent", items: [] }));
		const sidebar = await own(
			CheckMenuItem.new({
				id: "sidebar",
				text: "Show Sidebar",
				checked: false,
				enabled: false,
				action: () => {
					if (!disposed) command("sidebar");
				},
			}),
		);
		items.set("sidebar", sidebar);
		const windowMenu = await own(
			Submenu.new({
				text: "Window",
				items: [
					await own(PredefinedMenuItem.new({ item: "Minimize" })),
					await own(PredefinedMenuItem.new({ item: "Maximize" })),
					await separator(),
					await create("previous-tab", "Show Previous Tab (Ctrl+Shift+Tab)"),
					await create("next-tab", "Show Next Tab (Ctrl+Tab)"),
					await own(PredefinedMenuItem.new({ item: "BringAllToFront" })),
				],
			}),
		);
		const help = await own(
			Submenu.new({
				text: "Help",
				items: [await create("preview-help-toggle", "Diagram Help")],
			}),
		);
		const menu = await own(
			Menu.new({
				items: [
					await own(
						Submenu.new({
							text: "PFDSL",
							items: [
								await own(
									PredefinedMenuItem.new({
										item: { About: { name: "PFDSL" } },
									}),
								),
								await separator(),
								await own(PredefinedMenuItem.new({ item: "Services" })),
								await separator(),
								await own(PredefinedMenuItem.new({ item: "Hide" })),
								await own(PredefinedMenuItem.new({ item: "HideOthers" })),
								await own(PredefinedMenuItem.new({ item: "ShowAll" })),
								await separator(),
								await own(PredefinedMenuItem.new({ item: "Quit" })),
							],
						}),
					),
					await own(
						Submenu.new({
							text: "File",
							items: [
								await create("new", "New", "CmdOrCtrl+N"),
								await create("open-file", "Open…", "CmdOrCtrl+O"),
								await create("open", "Open Folder…"),
								recent,
								await separator(),
								await create("close-tab", "Close Tab", "CmdOrCtrl+W"),
								await create(
									"close-window",
									"Close Window",
									"CmdOrCtrl+Shift+W",
								),
								await separator(),
								await create("save", "Save", "CmdOrCtrl+S"),
								await create("save-as", "Save As…", "CmdOrCtrl+Shift+S"),
							],
						}),
					),
					await own(
						Submenu.new({
							text: "Edit",
							items: [
								await create("undo", "Undo", "CmdOrCtrl+Z"),
								await create("redo", "Redo", "CmdOrCtrl+Shift+Z"),
								await separator(),
								await own(PredefinedMenuItem.new({ item: "Cut" })),
								await own(PredefinedMenuItem.new({ item: "Copy" })),
								await own(PredefinedMenuItem.new({ item: "Paste" })),
								await create("delete", "Delete"),
								await own(PredefinedMenuItem.new({ item: "SelectAll" })),
								await separator(),
								await create("find", "Find", "CmdOrCtrl+F"),
								await own(
									Submenu.new({
										text: "Format",
										items: [
											await create("format", "Format flows"),
											await create("format-flat", "Format flat"),
										],
									}),
								),
								await create("create-definition", "Create Definition"),
							],
						}),
					),
					await own(
						Submenu.new({
							text: "View",
							items: [
								sidebar,
								await separator(),
								await create("fit-graph", "Fit"),
								await create("actual-size", "Actual Size (100%)"),
								await create("zoom-in", "Zoom In"),
								await create("zoom-out", "Zoom Out"),
								await separator(),
								await create("font-increase", "Increase Text Size"),
								await create("font-decrease", "Decrease Text Size"),
								await create("normalize", "Normalized edges"),
								await create("node-actions-toggle", "Connections"),
							],
						}),
					),
					windowMenu,
					help,
				],
			}),
		);
		if (disposed || signal?.aborted) throw new Error("Application disposed");
		await menu.setAsAppMenu();
		if (disposed || signal?.aborted) throw new Error("Application disposed");
		if (navigator.platform.startsWith("Mac")) {
			await windowMenu.setAsWindowsMenuForNSApp();
			if (disposed) throw new Error("Application disposed");
			await help.setAsHelpMenuForNSApp();
		}
		let queue = Promise.resolve();
		const enqueue = (work: () => Promise<void>) => {
			queue = queue
				.then(() => {
					if (!disposed) return work();
				})
				.catch(report);
		};
		let pendingState: MenuState | undefined;
		let appliedState: MenuState | undefined;
		let updating = false;
		function updatePendingState() {
			if (updating) return;
			updating = true;
			enqueue(async () => {
				try {
					while (pendingState && !disposed) {
						const state = pendingState;
						pendingState = undefined;
						const previous = appliedState;
						// A failed partial update must not leave a trusted property cache.
						appliedState = undefined;
						for (const [id, item] of items) {
							if (disposed) return;
							const enabled = commandEnabled(id, state);
							if (!previous || commandEnabled(id, previous) !== enabled)
								await item.setEnabled(enabled);
						}
						if (disposed) return;
						if (!previous || previous.busy !== state.busy)
							await recent.setEnabled(!state.busy);
						if (disposed) return;
						if (!previous || previous.sidebar !== state.sidebar) {
							await sidebar.setChecked(state.sidebar);
							if (disposed) return;
							await sidebar.setText(
								state.sidebar ? "Hide Sidebar" : "Show Sidebar",
							);
						}
						appliedState = state;
					}
				} finally {
					updating = false;
					if (pendingState) updatePendingState();
				}
			});
		}
		return {
			dispose,
			update(state: MenuState) {
				if (disposed) return;
				pendingState = { ...state };
				updatePendingState();
			},
			recent(targets: RecentTarget[]) {
				if (disposed) return;
				enqueue(async () => {
					// Tauri returns fresh resource handles from items(), including after disposal.
					const previous = await recent.items();
					for (const item of previous) resources.add(item);
					if (disposed) {
						await release();
						return;
					}
					for (const item of previous) {
						if (disposed) return;
						await recent.remove(item);
						if (disposed) return;
						await close(item);
					}
					for (const [index, target] of targets.entries()) {
						if (disposed) return;
						const item = await own(
							MenuItem.new({
								id: `recent-${index}`,
								text: `${target.kind === "folder" ? "Folder: " : ""}${target.path}`,
								action: () => {
									if (!disposed) openRecent(target);
								},
							}),
						);
						if (disposed) return;
						await recent.append(item);
					}
				});
			},
		};
	} catch (error) {
		dispose();
		throw error;
	}
}

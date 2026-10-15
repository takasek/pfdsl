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
) {
	const items = new Map<string, MenuItem | CheckMenuItem>();
	const create = async (id: string, text: string, accelerator?: string) => {
		const item = await MenuItem.new({
			id,
			text,
			enabled: false,
			...(accelerator ? { accelerator } : {}),
			action: () => command(id),
		});
		items.set(id, item);
		return item;
	};
	const separator = () => PredefinedMenuItem.new({ item: "Separator" });
	const recent = await Submenu.new({ text: "Recent", items: [] });
	const sidebar = await CheckMenuItem.new({
		id: "sidebar",
		text: "Show Sidebar",
		checked: false,
		enabled: false,
		action: () => command("sidebar"),
	});
	items.set("sidebar", sidebar);
	const windowMenu = await Submenu.new({
		text: "Window",
		items: [
			await PredefinedMenuItem.new({ item: "Minimize" }),
			await PredefinedMenuItem.new({ item: "Maximize" }),
			await separator(),
			await create("previous-tab", "Show Previous Tab", "Ctrl+Shift+Tab"),
			await create("next-tab", "Show Next Tab", "Ctrl+Tab"),
			await PredefinedMenuItem.new({ item: "BringAllToFront" }),
		],
	});
	const help = await Submenu.new({
		text: "Help",
		items: [await create("preview-help-toggle", "Diagram Help")],
	});
	const menu = await Menu.new({
		items: [
			await Submenu.new({
				text: "PFDSL",
				items: [
					await PredefinedMenuItem.new({ item: { About: { name: "PFDSL" } } }),
					await separator(),
					await PredefinedMenuItem.new({ item: "Services" }),
					await separator(),
					await PredefinedMenuItem.new({ item: "Hide" }),
					await PredefinedMenuItem.new({ item: "HideOthers" }),
					await PredefinedMenuItem.new({ item: "ShowAll" }),
					await separator(),
					await PredefinedMenuItem.new({ item: "Quit" }),
				],
			}),
			await Submenu.new({
				text: "File",
				items: [
					await create("new", "New", "CmdOrCtrl+N"),
					await create("open-file", "Open…", "CmdOrCtrl+O"),
					await create("open", "Open Folder…"),
					recent,
					await separator(),
					await create("close-tab", "Close Tab", "CmdOrCtrl+W"),
					await create("close-window", "Close Window", "CmdOrCtrl+Shift+W"),
					await separator(),
					await create("save", "Save", "CmdOrCtrl+S"),
					await create("save-as", "Save As…", "CmdOrCtrl+Shift+S"),
				],
			}),
			await Submenu.new({
				text: "Edit",
				items: [
					await create("undo", "Undo", "CmdOrCtrl+Z"),
					await create("redo", "Redo", "CmdOrCtrl+Shift+Z"),
					await separator(),
					await PredefinedMenuItem.new({ item: "Cut" }),
					await PredefinedMenuItem.new({ item: "Copy" }),
					await PredefinedMenuItem.new({ item: "Paste" }),
					await create("delete", "Delete"),
					await PredefinedMenuItem.new({ item: "SelectAll" }),
					await separator(),
					await create("find", "Find", "CmdOrCtrl+F"),
					await Submenu.new({
						text: "Format",
						items: [
							await create("format", "Format flows"),
							await create("format-flat", "Format flat"),
						],
					}),
					await create("create-definition", "Create Definition"),
				],
			}),
			await Submenu.new({
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
			windowMenu,
			help,
		],
	});
	await menu.setAsAppMenu();
	if (navigator.platform.startsWith("Mac")) {
		await windowMenu.setAsWindowsMenuForNSApp();
		await help.setAsHelpMenuForNSApp();
	}
	let queue = Promise.resolve();
	const enqueue = (work: () => Promise<void>) => {
		queue = queue.then(work).catch(report);
	};
	return {
		update(state: MenuState) {
			enqueue(async () => {
				for (const [id, item] of items) {
					await item.setEnabled(commandEnabled(id, state));
				}
				await recent.setEnabled(!state.busy);
				await sidebar.setChecked(state.sidebar);
				await sidebar.setText(state.sidebar ? "Hide Sidebar" : "Show Sidebar");
			});
		},
		recent(targets: RecentTarget[]) {
			enqueue(async () => {
				for (const item of await recent.items()) {
					await recent.remove(item);
					await item.close();
				}
				for (const [index, target] of targets.entries())
					await recent.append(
						await MenuItem.new({
							id: `recent-${index}`,
							text: `${target.kind === "folder" ? "Folder: " : ""}${target.path}`,
							action: () => openRecent(target),
						}),
					);
			});
		},
	};
}

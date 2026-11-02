/** Native menu boundary fake. Production menu behavior has its own component tests. */
export function createTestMenu(command, openRecent = () => {}) {
	const ids = [
		"new",
		"open-file",
		"open",
		"clear-recent",
		"close-window",
		"close-tab",
		"save",
		"save-as",
		"sidebar",
		"format",
		"format-flat",
		"normalize",
		"previous-tab",
		"next-tab",
		"create-definition",
		"find",
		"undo",
		"redo",
		"delete",
		"preview-help-toggle",
		"fit-graph",
		"actual-size",
		"zoom-in",
		"zoom-out",
		"node-actions-toggle",
		"font-increase",
		"font-decrease",
	];
	const items = ids.map((id) => ({
		id,
		enabled: false,
		action: () => command(id),
	}));
	let disposed = false;
	let recentCount = 0;
	let busy = false;
	return {
		items,
		update(state) {
			if (disposed) return;
			busy = state.busy;
			for (const item of items) {
				item.enabled =
					!state.busy &&
					(item.id === "clear-recent"
						? recentCount > 0
						: ["new", "open-file", "open", "close-window"].includes(item.id) ||
							(item.id === "sidebar"
								? state.folder
								: state.document &&
									(!["save", "save-as"].includes(item.id) || state.save)));
			}
		},
		recent(targets) {
			if (disposed) return;
			recentCount = targets.length;
			items.find((item) => item.id === "clear-recent").enabled =
				!busy && recentCount > 0;
			for (const [index, target] of targets.entries())
				items.push({
					id: `recent-${index}`,
					enabled: true,
					action: () => openRecent(target),
				});
		},
		dispose() {
			disposed = true;
			for (const item of items) item.enabled = false;
		},
	};
}

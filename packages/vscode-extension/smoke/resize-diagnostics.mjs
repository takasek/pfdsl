// These callbacks run in the webview through Locator.evaluate, so keep them self-contained.
// Distinguish a menu left open, focus leaving before resize dismissal, and document focus loss.
export function installEdgeResizeDiagnostics(edge) {
	const document = edge.ownerDocument;
	const view = document.defaultView;
	const menu = document.querySelector(".connection-menu");
	const startedAt = view.performance.now();
	const events = [];
	let droppedEvents = 0;
	const describe = (element) =>
		element?.tagName
			? {
					tag: element.tagName,
					id: element.id.slice(0, 100),
					class: String(element.className).slice(0, 160),
					role: element.getAttribute("role"),
				}
			: null;
	const snapshot = (currentEdge = edge) => ({
		edgeFocused: document.activeElement === currentEdge,
		menuHidden: menu?.hidden ?? null,
		documentFocused: document.hasFocus(),
		activeElement: describe(document.activeElement),
		focusInMenu: menu?.contains(document.activeElement) ?? false,
		edgeConnected: edge.isConnected,
		sameEdge: currentEdge === edge,
		viewport: { width: view.innerWidth, height: view.innerHeight },
	});
	const record = (type, details = {}) => {
		if (events.length === 80) {
			events.shift();
			droppedEvents++;
		}
		events.push({
			atMs: view.performance.now() - startedAt,
			type,
			...details,
			...snapshot(),
		});
	};
	const onEvent = (event) =>
		record(event.type, {
			target: describe(event.target),
			relatedTarget: describe(event.relatedTarget),
		});
	const observer = new view.MutationObserver((mutations) => {
		// Delivery is asynchronous; oldValue describes the mutation, snapshots describe delivery time.
		for (const mutation of mutations) {
			record("menu-hidden", { oldValue: mutation.oldValue });
		}
	});
	if (menu)
		observer.observe(menu, {
			attributes: true,
			attributeFilter: ["hidden"],
			attributeOldValue: true,
		});
	for (const type of ["focusin", "focusout"])
		document.addEventListener(type, onEvent, true);
	for (const type of ["focus", "blur", "resize"])
		view.addEventListener(type, onEvent, true);
	document.__pfdslEdgeResizeDiagnostics = {
		read(currentEdge) {
			const state = snapshot(currentEdge);
			return {
				...state,
				ready: state.edgeFocused && state.menuHidden && state.documentFocused,
				events: events.slice(),
				droppedEvents,
			};
		},
		dispose() {
			observer.disconnect();
			for (const type of ["focusin", "focusout"])
				document.removeEventListener(type, onEvent, true);
			for (const type of ["focus", "blur", "resize"])
				view.removeEventListener(type, onEvent, true);
		},
	};
	record("installed");
}

export function readEdgeResizeDiagnostics(edge) {
	return edge.ownerDocument.__pfdslEdgeResizeDiagnostics.read(edge);
}

export function removeEdgeResizeDiagnostics(edge) {
	const document = edge.ownerDocument;
	document.__pfdslEdgeResizeDiagnostics?.dispose();
	delete document.__pfdslEdgeResizeDiagnostics;
}

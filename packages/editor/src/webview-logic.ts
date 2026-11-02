/**
 * The arithmetic behind the preview's pan, zoom and minimap.
 *
 * webview.ts runs in the webview's own document and reads live DOM geometry,
 * so it stayed outside the tested surface — and with it went every formula
 * that decides where the graph ends up (#611). Nothing here touches the DOM:
 * callers read the rects and hand over numbers.
 */

/** How the graph currently sits in the viewport. */
export interface ViewTransform {
	scale: number;
	panX: number;
	panY: number;
}

/** A rectangle in the coordinates its reader used, matching DOMRect's fields. */
export interface RectLike {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Apple HIG's 10 pt macOS minimum text size, taken as 10 CSS px: https://developer.apple.com/design/human-interface-guidelines/typography */
export const MINIMUM_READABLE_FONT_SIZE_PX = 10;

/** On-screen text size for an SVG font size; undefined when the measurements cannot be used. */
export function screenFontSize(
	fontSize: number,
	svgWidth: number,
	viewBoxWidth: number,
	scale: number,
): number | undefined {
	if (
		![fontSize, svgWidth, viewBoxWidth, scale].every(Number.isFinite) ||
		fontSize < 0 ||
		svgWidth <= 0 ||
		viewBoxWidth <= 0 ||
		scale <= 0
	)
		return undefined;
	const size = (fontSize * svgWidth * scale) / viewBoxWidth;
	return Number.isFinite(size) ? size : undefined;
}

/** An unknown size counts as readable, so the view is not moved on a guess. */
export function fontSizeBelowMinimum(size: number | undefined): boolean {
	return size !== undefined && size < MINIMUM_READABLE_FONT_SIZE_PX;
}

/** Whether the whole graph lies inside the viewport; both rects come from getBoundingClientRect. */
export function graphFitsViewport(
	graph: RectLike,
	viewport: RectLike,
): boolean {
	if (
		![
			graph.left,
			graph.top,
			graph.width,
			graph.height,
			viewport.left,
			viewport.top,
			viewport.width,
			viewport.height,
		].every(Number.isFinite) ||
		graph.width < 0 ||
		graph.height < 0 ||
		viewport.width <= 0 ||
		viewport.height <= 0
	)
		return false;
	return (
		graph.left >= viewport.left &&
		graph.top >= viewport.top &&
		graph.left + graph.width <= viewport.left + viewport.width &&
		graph.top + graph.height <= viewport.top + viewport.height
	);
}

/** Bounds on zoom: below the floor a graph is unreadable, above the ceiling it is unusable. */
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;

/** One wheel notch, as a multiplier on the current scale. */
export const ZOOM_STEP = 1.1;

/**
 * Zoom about a point, keeping whatever is under the cursor under the cursor.
 * `deltaY` follows the wheel event's sign: negative scrolls zoom in.
 * The pan is computed from the effective factor, so at the scale limits the
 * graph stops growing but does not drift.
 */
export function zoomAt(
	view: ViewTransform,
	pointerX: number,
	pointerY: number,
	deltaY: number,
	minimumScale = MIN_SCALE,
): ViewTransform {
	const nextScale = Math.max(
		minimumScale,
		Math.min(MAX_SCALE, view.scale * (deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)),
	);
	const factor = nextScale / view.scale;
	return {
		panX: pointerX - (pointerX - view.panX) * factor,
		panY: pointerY - (pointerY - view.panY) * factor,
		scale: nextScale,
	};
}

export function clampScale(scale: number): number {
	return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

/** The pan that centres a graph of the given size in the given viewport. */
export function centerPan(
	viewport: { width: number; height: number },
	graph: { width: number; height: number },
	scale: number,
): { panX: number; panY: number } {
	return {
		panX: (viewport.width - graph.width * scale) / 2,
		panY: (viewport.height - graph.height * scale) / 2,
	};
}

/** Fit the complete graph, without enlarging small diagrams or imposing the wheel zoom floor. */
export function fitGraph(
	viewport: { width: number; height: number },
	graph: { width: number; height: number },
): ViewTransform | undefined {
	if (
		viewport.width <= 0 ||
		viewport.height <= 0 ||
		graph.width <= 0 ||
		graph.height <= 0
	)
		return undefined;
	const scale = Math.min(
		1,
		Math.max(1, viewport.width - 32) / graph.width,
		Math.max(1, viewport.height - 32) / graph.height,
	);
	return { scale, ...centerPan(viewport, graph, scale) };
}

/**
 * The pan that brings a node to the centre of the viewport. Both rects come
 * from getBoundingClientRect, so the node's position is already scaled and the
 * shift is added to the current pan rather than replacing it.
 */
export function panToCenterNode(
	view: ViewTransform,
	nodeRect: RectLike,
	viewportRect: RectLike,
	viewport: { width: number; height: number },
): { panX: number; panY: number } {
	return {
		panX:
			view.panX +
			viewport.width / 2 -
			(nodeRect.left + nodeRect.width / 2 - viewportRect.left),
		panY:
			view.panY +
			viewport.height / 2 -
			(nodeRect.top + nodeRect.height / 2 - viewportRect.top),
	};
}

/** Fit one node at up to natural size, using bounds measured at the old transform. */
export function focusNodeView(
	view: ViewTransform,
	nodeRect: RectLike,
	viewportRect: RectLike,
	viewport: { width: number; height: number },
): ViewTransform | undefined {
	const fitted = fitGraph(viewport, {
		width: nodeRect.width / view.scale,
		height: nodeRect.height / view.scale,
	});
	if (!fitted) return undefined;
	const centerX =
		(nodeRect.left + nodeRect.width / 2 - viewportRect.left - view.panX) /
		view.scale;
	const centerY =
		(nodeRect.top + nodeRect.height / 2 - viewportRect.top - view.panY) /
		view.scale;
	return {
		scale: fitted.scale,
		panX: viewport.width / 2 - centerX * fitted.scale,
		panY: viewport.height / 2 - centerY * fitted.scale,
	};
}

/** The scale that fits a graph inside the minimap box without distorting it. */
export function minimapScale(
	graph: { width: number; height: number },
	box: { width: number; height: number },
): number {
	return Math.min(box.width / graph.width, box.height / graph.height);
}

/** Where the minimap's viewport indicator goes, in minimap pixels. */
export function minimapViewport(
	view: ViewTransform,
	viewport: { width: number; height: number },
	mmScale: number,
): { left: number; top: number; width: number; height: number } {
	return {
		left: (-view.panX / view.scale) * mmScale,
		top: (-view.panY / view.scale) * mmScale,
		width: (viewport.width / view.scale) * mmScale,
		height: (viewport.height / view.scale) * mmScale,
	};
}

/**
 * The pan that centres the viewport on a point clicked in the minimap.
 * `minimapRect` is captured when the drag starts, so dragging keeps working
 * once the pointer leaves the minimap.
 */
export function panFromMinimapPoint(
	clientX: number,
	clientY: number,
	minimapRect: RectLike,
	mmScale: number,
	scale: number,
	viewport: { width: number; height: number },
): { panX: number; panY: number } {
	const graphX = (clientX - minimapRect.left) / mmScale;
	const graphY = (clientY - minimapRect.top) / mmScale;
	return {
		panX: viewport.width / 2 - graphX * scale,
		panY: viewport.height / 2 - graphY * scale,
	};
}

/**
 * Whether a drag should end because no button is down any more. A mouseup
 * delivered outside the webview never arrives, so the next mousemove is the
 * first chance to notice — without this the graph keeps following the pointer,
 * and a click that lands afterwards reads as a deliberate one.
 */
export function shouldReleaseDrag(
	buttons: number,
	dragging: { graph: boolean; minimap: boolean },
): boolean {
	return buttons === 0 && (dragging.graph || dragging.minimap);
}

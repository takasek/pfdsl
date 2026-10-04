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

/** Bounds on zoom: below the floor a graph is unreadable, above the ceiling it is unusable. */
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;

/** One wheel notch, as a multiplier on the current scale. */
export const ZOOM_STEP = 1.1;

/**
 * Zoom about a point, keeping whatever is under the cursor under the cursor.
 * `deltaY` follows the wheel event's sign: negative scrolls zoom in.
 * The pan is computed from the unclamped factor, so at the scale limits the
 * graph stops growing but does not drift.
 */
export function zoomAt(
	view: ViewTransform,
	pointerX: number,
	pointerY: number,
	deltaY: number,
): ViewTransform {
	const factor = deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
	return {
		panX: pointerX - (pointerX - view.panX) * factor,
		panY: pointerY - (pointerY - view.panY) * factor,
		scale: clampScale(view.scale * factor),
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

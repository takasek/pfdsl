import { describe, expect, it } from "vitest";
import {
	centerPan,
	clampScale,
	fitGraph,
	MAX_SCALE,
	MIN_SCALE,
	minimapScale,
	minimapViewport,
	panFromMinimapPoint,
	panToCenterNode,
	shouldReleaseDrag,
	ZOOM_STEP,
	zoomAt,
} from "./webview-logic.js";

const view = (scale = 1, panX = 0, panY = 0) => ({ scale, panX, panY });

describe("fitGraph", () => {
	it("fits a wide graph with a margin without magnifying a small graph", () => {
		expect(
			fitGraph({ width: 400, height: 300 }, { width: 1600, height: 800 }),
		).toEqual(view(0.23, 16, 58));
		expect(
			fitGraph({ width: 400, height: 300 }, { width: 100, height: 100 }),
		).toEqual(view(1, 150, 100));
		expect(
			fitGraph({ width: 300, height: 400 }, { width: 800, height: 1600 }),
		).toEqual(view(0.23, 58, 16));
	});
	it.each([
		[0, 300, 100, 100],
		[400, 0, 100, 100],
		[400, 300, 0, 100],
		[400, 300, 100, 0],
	])("waits for positive dimensions (%s, %s, %s, %s)", (vw, vh, gw, gh) => {
		expect(
			fitGraph({ width: vw, height: vh }, { width: gw, height: gh }),
		).toBeUndefined();
	});
	it("also fits narrow viewports and very large diagrams", () => {
		expect(
			fitGraph({ width: 20, height: 20 }, { width: 100, height: 100 })!.scale,
		).toBe(0.01);
		expect(
			fitGraph({ width: 400, height: 300 }, { width: 40000, height: 1000 })!
				.scale,
		).toBe(0.0092);
	});
	it("lets zoom retain a Fit scale below the ordinary zoom floor", () => {
		expect(zoomAt(view(0.0092), 10, 20, -1, 0.0092).scale).toBeCloseTo(0.01012);
		expect(zoomAt(view(0.0092), 10, 20, 1, 0.0092).scale).toBe(0.0092);
		expect(zoomAt(view(0.0092, 16, 145.4), 390, 150, 1, 0.0092)).toEqual(
			view(0.0092, 16, 145.4),
		);
	});
});

describe("zoomAt", () => {
	it("scrolling up zooms in by one step", () => {
		expect(zoomAt(view(), 0, 0, -1).scale).toBeCloseTo(ZOOM_STEP, 10);
	});

	it("scrolling down zooms out by the same step, so a notch each way returns to where it started", () => {
		const inOut = zoomAt(zoomAt(view(), 30, 40, -1), 30, 40, 1);
		expect(inOut.scale).toBeCloseTo(1, 10);
		expect(inOut.panX).toBeCloseTo(0, 10);
		expect(inOut.panY).toBeCloseTo(0, 10);
	});

	it("keeps the point under the cursor fixed while zooming", () => {
		const before = view(1, -50, -20);
		const [px, py] = [120, 90];
		// Graph coordinate under the pointer, before and after.
		const graphBefore = [
			(px - before.panX) / before.scale,
			(py - before.panY) / before.scale,
		];
		const after = zoomAt(before, px, py, -1);
		const graphAfter = [
			(px - after.panX) / after.scale,
			(py - after.panY) / after.scale,
		];
		expect(graphAfter[0]).toBeCloseTo(graphBefore[0]!, 10);
		expect(graphAfter[1]).toBeCloseTo(graphBefore[1]!, 10);
	});

	it("stops at the ceiling instead of scaling without bound", () => {
		expect(zoomAt(view(MAX_SCALE), 0, 0, -1).scale).toBe(MAX_SCALE);
	});

	it("stops at the floor instead of collapsing the graph", () => {
		expect(zoomAt(view(MIN_SCALE), 0, 0, 1).scale).toBe(MIN_SCALE);
	});

	it("keeps the view stable at the ceiling and floor", () => {
		expect(zoomAt(view(MAX_SCALE, 10, 10), 100, 100, -1)).toEqual(
			view(MAX_SCALE, 10, 10),
		);
		expect(zoomAt(view(MIN_SCALE, 10, 10), 100, 100, 1)).toEqual(
			view(MIN_SCALE, 10, 10),
		);
	});
});

describe("clampScale", () => {
	it.each([
		[0.001, MIN_SCALE],
		[MIN_SCALE, MIN_SCALE],
		[1, 1],
		[MAX_SCALE, MAX_SCALE],
		[1000, MAX_SCALE],
	])("clamps %o to %o", (input, expected) => {
		expect(clampScale(input)).toBe(expected);
	});
});

describe("centerPan", () => {
	it("centres a graph smaller than the viewport", () => {
		expect(
			centerPan({ width: 800, height: 600 }, { width: 400, height: 200 }, 1),
		).toEqual({ panX: 200, panY: 200 });
	});

	it("takes the scale into account, so a zoomed graph is still centred", () => {
		expect(
			centerPan({ width: 800, height: 600 }, { width: 400, height: 200 }, 2),
		).toEqual({ panX: 0, panY: 100 });
	});

	it("pans negative when the graph is larger than the viewport, showing its middle", () => {
		const { panX } = centerPan(
			{ width: 800, height: 600 },
			{ width: 1600, height: 200 },
			1,
		);
		expect(panX).toBe(-400);
	});
});

describe("panToCenterNode", () => {
	const viewport = { width: 800, height: 600 };
	const viewportRect = { left: 0, top: 0, width: 800, height: 600 };

	it("shifts a node's centre onto the viewport's centre", () => {
		const nodeRect = { left: 100, top: 100, width: 40, height: 20 };
		expect(panToCenterNode(view(), nodeRect, viewportRect, viewport)).toEqual({
			panX: 400 - 120,
			panY: 300 - 110,
		});
	});

	it("adds to the current pan rather than replacing it, since the rect is already panned", () => {
		const nodeRect = { left: 100, top: 100, width: 40, height: 20 };
		const shifted = panToCenterNode(
			view(1, 250, -30),
			nodeRect,
			viewportRect,
			viewport,
		);
		expect(shifted).toEqual({ panX: 250 + 280, panY: -30 + 190 });
	});

	it("measures the node against the viewport's own origin, not the window's", () => {
		const nodeRect = { left: 300, top: 200, width: 40, height: 20 };
		const offsetViewport = { left: 200, top: 100, width: 800, height: 600 };
		expect(panToCenterNode(view(), nodeRect, offsetViewport, viewport)).toEqual(
			{ panX: 400 - 120, panY: 300 - 110 },
		);
	});

	it("leaves an already-centred node where it is", () => {
		const nodeRect = { left: 380, top: 290, width: 40, height: 20 };
		expect(panToCenterNode(view(), nodeRect, viewportRect, viewport)).toEqual({
			panX: 0,
			panY: 0,
		});
	});
});

describe("minimapScale", () => {
	it("fits by width when the graph is wide", () => {
		expect(
			minimapScale({ width: 1600, height: 600 }, { width: 160, height: 120 }),
		).toBeCloseTo(0.1, 10);
	});

	it("fits by height when the graph is tall", () => {
		expect(
			minimapScale({ width: 600, height: 1200 }, { width: 160, height: 120 }),
		).toBeCloseTo(0.1, 10);
	});

	it("does not enlarge beyond the box for a graph smaller than it", () => {
		const scale = minimapScale(
			{ width: 80, height: 40 },
			{ width: 160, height: 120 },
		);
		expect(scale * 80).toBeLessThanOrEqual(160);
		expect(scale * 40).toBeLessThanOrEqual(120);
	});
});

describe("minimapViewport", () => {
	it("covers the whole minimap when the graph exactly fills the viewport", () => {
		const rect = minimapViewport(view(), { width: 800, height: 600 }, 0.1);
		expect(rect.left).toBeCloseTo(0, 10);
		expect(rect.top).toBeCloseTo(0, 10);
		expect(rect.width).toBeCloseTo(80, 10);
		expect(rect.height).toBeCloseTo(60, 10);
	});

	it("moves the indicator opposite the pan, since panning right shows what is left", () => {
		const rect = minimapViewport(
			view(1, -200, -100),
			{
				width: 800,
				height: 600,
			},
			0.1,
		);
		expect(rect.left).toBeCloseTo(20, 10);
		expect(rect.top).toBeCloseTo(10, 10);
	});

	it("shrinks the indicator as the graph is zoomed in, since less of it is visible", () => {
		const out = minimapViewport(view(1), { width: 800, height: 600 }, 0.1);
		const zoomed = minimapViewport(view(2), { width: 800, height: 600 }, 0.1);
		expect(zoomed.width).toBeCloseTo(out.width / 2, 10);
		expect(zoomed.height).toBeCloseTo(out.height / 2, 10);
	});
});

describe("panFromMinimapPoint", () => {
	const minimapRect = { left: 10, top: 20, width: 160, height: 120 };
	const viewport = { width: 800, height: 600 };

	it("centres the viewport on the graph point the click maps to", () => {
		// 30px into a minimap at 0.1 → graph x 300; centred at scale 1 → 400-300.
		const pan = panFromMinimapPoint(40, 50, minimapRect, 0.1, 1, viewport);
		expect(pan).toEqual({ panX: 400 - 300, panY: 300 - 300 });
	});

	it("scales the target point, so the same click lands differently when zoomed", () => {
		const pan = panFromMinimapPoint(40, 50, minimapRect, 0.1, 2, viewport);
		expect(pan).toEqual({ panX: 400 - 600, panY: 300 - 600 });
	});

	it("uses the rect it is given, which the caller captured when the drag began", () => {
		const moved = { left: 60, top: 20, width: 160, height: 120 };
		const pan = panFromMinimapPoint(40, 50, moved, 0.1, 1, viewport);
		expect(pan.panX).toBe(400 - (40 - 60) / 0.1);
	});
});

describe("shouldReleaseDrag", () => {
	it("releases a graph drag once no button is held", () => {
		expect(shouldReleaseDrag(0, { graph: true, minimap: false })).toBe(true);
	});

	it("releases a minimap drag the same way", () => {
		expect(shouldReleaseDrag(0, { graph: false, minimap: true })).toBe(true);
	});

	it("keeps dragging while a button is still down", () => {
		expect(shouldReleaseDrag(1, { graph: true, minimap: false })).toBe(false);
	});

	it("has nothing to release when no drag is in progress", () => {
		expect(shouldReleaseDrag(0, { graph: false, minimap: false })).toBe(false);
	});
});

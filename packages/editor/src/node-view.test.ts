import { expect, it } from "vitest";
import { focusNodeView, zoomAt } from "./webview-logic.js";

it("centers a scaled and panned node at natural size within the actual graph viewport", () => {
	expect(
		focusNodeView(
			{ scale: 0.25, panX: -30, panY: 20 },
			{ left: 120, top: 95, width: 50, height: 25 },
			{ left: 100, top: 50, width: 400, height: 300 },
			{ width: 400, height: 300 },
		),
	).toEqual({ scale: 1, panX: -100, panY: 0 });
});

it("fits giant nodes below the wheel floor and allows continuous zoom afterward", () => {
	const view = focusNodeView(
		{ scale: 1, panX: 0, panY: 0 },
		{ left: 0, top: 0, width: 10000, height: 1000 },
		{ left: 0, top: 0, width: 200, height: 100 },
		{ width: 200, height: 100 },
	)!;
	expect(view).toEqual({ scale: 0.0168, panX: 16, panY: 41.6 });
	expect(zoomAt(view, 100, 50, -1, view.scale).scale).toBeCloseTo(0.01848);
});

it.each([
	[0, 100],
	[100, 0],
])("does not schedule an operation for hidden viewport %s by %s", (width, height) => {
	expect(
		focusNodeView(
			{ scale: 1, panX: 2, panY: 3 },
			{ left: 0, top: 0, width: 100, height: 100 },
			{ left: 0, top: 0, width, height },
			{ width, height },
		),
	).toBeUndefined();
});

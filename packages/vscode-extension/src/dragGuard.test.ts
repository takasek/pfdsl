import { describe, expect, it } from "vitest";
import { DragGuard } from "./dragGuard";

describe("DragGuard", () => {
	it("is not dragged for a clean click without movement", () => {
		const g = new DragGuard();
		g.onMouseDown(100, 100, 1);
		expect(g.dragged).toBe(false);
	});

	it("ignores tiny jitter under the threshold", () => {
		const g = new DragGuard(5);
		g.onMouseDown(100, 100, 1);
		g.onMouseMove(103, 102);
		expect(g.dragged).toBe(false);
	});

	it("is dragged once movement exceeds the threshold", () => {
		const g = new DragGuard(5);
		g.onMouseDown(100, 100, 1);
		g.onMouseMove(120, 100);
		expect(g.dragged).toBe(true);
	});

	it("remembers a drag from the first click through the double-click", () => {
		const g = new DragGuard(5);
		// first click: pans the canvas
		g.onMouseDown(100, 100, 1);
		g.onMouseMove(140, 100);
		// second click of the double-click: detail >= 2 must NOT reset the flag
		g.onMouseDown(140, 100, 2);
		expect(g.dragged).toBe(true);
	});

	it("resets movement when a new click sequence starts", () => {
		const g = new DragGuard(5);
		g.onMouseDown(100, 100, 1);
		g.onMouseMove(140, 100);
		expect(g.dragged).toBe(true);
		// a brand new gesture (detail === 1) clears the previous drag
		g.onMouseDown(200, 200, 1);
		expect(g.dragged).toBe(false);
	});

	it("measures movement relative to the latest mousedown", () => {
		const g = new DragGuard(5);
		g.onMouseDown(100, 100, 1);
		g.onMouseMove(102, 100); // under threshold from down point
		// second click starts at a far point; small move from there stays clean
		g.onMouseDown(300, 300, 2);
		g.onMouseMove(302, 301);
		expect(g.dragged).toBe(false);
	});
});

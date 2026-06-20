/**
 * Tracks pointer movement across a (possibly double-) click sequence so the
 * webview can tell a deliberate click from a pan/drag gesture.
 *
 * A double-click is two clicks within the OS double-click time. Each click may
 * itself involve dragging the canvas. We only want to treat the gesture as a
 * "click" (and trigger the node link) when neither click moved past a small
 * threshold. The `detail` field of `mousedown` (1 for the first click, >=2 for
 * subsequent ones) lets us reset movement only when a fresh sequence begins.
 */
export class DragGuard {
	private moved = false;
	private downX = 0;
	private downY = 0;

	constructor(private readonly threshold = 5) {}

	onMouseDown(x: number, y: number, detail: number): void {
		this.downX = x;
		this.downY = y;
		if (detail <= 1) this.moved = false;
	}

	onMouseMove(x: number, y: number): void {
		if (Math.hypot(x - this.downX, y - this.downY) > this.threshold) {
			this.moved = true;
		}
	}

	get dragged(): boolean {
		return this.moved;
	}
}

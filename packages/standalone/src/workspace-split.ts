/** A divider changes geometry only; editor/preview instances retain their state. */
export function createWorkspaceSplit(
	container: HTMLElement,
	changed: () => void,
) {
	const document = container.ownerDocument;
	const window = document.defaultView!;
	const abort = new window.AbortController();
	const divider = document.createElement("div");
	divider.className = "workspace-divider";
	divider.tabIndex = 0;
	divider.setAttribute("role", "separator");
	divider.setAttribute("aria-label", "Source and diagram widths");
	divider.setAttribute("aria-orientation", "vertical");
	divider.setAttribute("aria-valuemin", "10");
	divider.setAttribute("aria-valuemax", "90");
	let width = 50;
	let pointer: number | undefined;
	/** The percentages both panes' minimum widths (style.css) leave the divider. */
	function range(): [number, number] {
		const style = window.getComputedStyle(document.documentElement);
		const minimum = (name: string) =>
			Number.parseFloat(style.getPropertyValue(name)) || 0;
		const available = container.getBoundingClientRect().width - 6;
		const editor = minimum("--editor-min-width");
		const preview = minimum("--preview-min-width");
		if (!(available > 0 && available >= editor + preview)) return [10, 90];
		return [
			Math.max(10, (editor / available) * 100),
			Math.min(90, 100 - (preview / available) * 100),
		];
	}
	function set(value: number) {
		const [low, high] = range();
		width = Math.max(low, Math.min(high, value));
		container.style.setProperty("--source-width", `${width}%`);
		container.style.setProperty("--source-ratio", String(width / 100));
		divider.setAttribute("aria-valuemin", String(Math.round(low)));
		divider.setAttribute("aria-valuemax", String(Math.round(high)));
		divider.setAttribute("aria-valuenow", String(Math.round(width)));
		changed();
	}
	set(50);
	// The host narrows with the window and the sidebar; keep the value in range.
	if (typeof window.ResizeObserver === "function") {
		const observer = new window.ResizeObserver(() => set(width));
		observer.observe(container);
		abort.signal.addEventListener("abort", () => observer.disconnect());
	} else
		window.addEventListener("resize", () => set(width), {
			signal: abort.signal,
		});
	divider.addEventListener(
		"keydown",
		(event) => {
			const step = event.shiftKey ? 1 : 5;
			const value = {
				ArrowLeft: width - step,
				ArrowRight: width + step,
				Home: 0,
				End: 100,
			}[event.key];
			if (value === undefined) return;
			event.preventDefault();
			set(value);
		},
		{ signal: abort.signal },
	);
	divider.addEventListener(
		"pointerdown",
		(event) => {
			if (event.button !== 0) return;
			pointer = event.pointerId;
			divider.setPointerCapture?.(pointer);
			event.preventDefault();
			divider.focus();
		},
		{ signal: abort.signal },
	);
	window.addEventListener(
		"pointermove",
		(event) => {
			if (pointer !== event.pointerId) return;
			const rect = container.getBoundingClientRect();
			if (rect.width > 6)
				set(((event.clientX - rect.left - 3) / (rect.width - 6)) * 100);
		},
		{ signal: abort.signal },
	);
	for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
		window.addEventListener(
			name,
			() => {
				pointer = undefined;
			},
			{ signal: abort.signal },
		);
	}
	return {
		divider,
		dispose() {
			abort.abort();
			pointer = undefined;
			divider.remove();
		},
	};
}

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
	function set(value: number) {
		width = Math.max(10, Math.min(90, value));
		container.style.setProperty("--source-width", `${width}%`);
		container.style.setProperty("--source-ratio", String(width / 100));
		divider.setAttribute("aria-valuenow", String(Math.round(width)));
		changed();
	}
	set(50);
	divider.addEventListener(
		"keydown",
		(event) => {
			const step = event.shiftKey ? 1 : 5;
			const value = {
				ArrowLeft: width - step,
				ArrowRight: width + step,
				Home: 10,
				End: 90,
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

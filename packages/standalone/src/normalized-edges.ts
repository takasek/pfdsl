/** A tab-private, nonmodal inspection surface. Text never becomes markup. */
export function createNormalizedEdgesPanel(parent: HTMLElement) {
	const panel = document.createElement("section");
	panel.className = "normalized-edges";
	panel.setAttribute("aria-label", "Normalized edges");
	panel.hidden = true;
	const heading = document.createElement("strong");
	heading.textContent = "Normalized edges";
	const close = document.createElement("button");
	close.type = "button";
	close.textContent = "Close";
	const output = document.createElement("pre");
	output.tabIndex = 0;
	output.setAttribute("aria-label", "Normalized edge text");
	const message = document.createElement("p");
	message.setAttribute("role", "status");
	let origin: HTMLElement | null = null;
	function clear() {
		panel.hidden = true;
		output.textContent = "";
		message.textContent = "";
		origin = null;
	}
	function dismiss() {
		const restore = origin;
		clear();
		if (restore?.isConnected) restore.focus();
	}
	close.onclick = dismiss;
	panel.onkeydown = (event) => {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		dismiss();
	};
	panel.append(heading, close, message, output);
	parent.append(panel);
	return {
		clear,
		show(text: string | null) {
			// Reinvocation while output has focus retains the original return target.
			if (!panel.contains(document.activeElement))
				origin = document.activeElement as HTMLElement | null;
			output.textContent = text ?? "";
			output.hidden = text === null;
			message.textContent =
				text === null
					? "Fix errors before normalizing."
					: text === ""
						? "No normalized edges."
						: "Normalized edges displayed.";
			panel.hidden = false;
			if (text === null) close.focus();
			else output.focus();
		},
	};
}

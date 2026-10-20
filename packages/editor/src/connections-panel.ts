import { analyzeSource, type NormalizedEdge } from "@pfdsl/core";
import type {
	MessageFromWebview,
	MessageToWebview,
	PreviewEditMessage,
} from "./messages.js";
import {
	applyPreviewEdit,
	connectorError,
	type PreviewEditRequest,
} from "./preview-edit.js";

type Editing = Extract<MessageToWebview, { type: "render" }>["editing"];
interface Side {
	left: boolean;
	section: HTMLDivElement;
	list: HTMLDivElement;
	controls: HTMLDivElement;
	input: HTMLInputElement;
	create: HTMLButtonElement;
	candidates: HTMLDivElement;
	reason: HTMLSpanElement;
}
type Popup =
	| { type: "candidates"; side: Side; active?: HTMLButtonElement }
	| { type: "edge"; trigger: HTMLButtonElement; edge: NormalizedEdge };
let serial = 0;

export function mountConnections(
	container: HTMLElement,
	host: {
		postMessage(request: MessageFromWebview): void;
		navigate(id: string): void;
		close(): void;
		onOpenChange(open: boolean): void;
	},
) {
	const document = container.ownerDocument;
	const panel = container.querySelector<HTMLElement>("#node-actions")!;
	const title = panel.querySelector<HTMLElement>("#node-actions-title")!;
	const error = panel.querySelector<HTMLElement>("#node-actions-error")!;
	const definition =
		panel.querySelector<HTMLButtonElement>("#create-definition")!;
	const layout = panel.querySelector<HTMLElement>(".connections-grid")!;
	const menu = panel.querySelector<HTMLElement>(".connection-menu")!;
	let editing: Editing;
	let model: ReturnType<typeof analyzeSource> | undefined;
	let center: string | undefined;
	let popup: Popup | undefined;
	let applyingFocus = false;
	let pending:
		| {
				request: PreviewEditMessage & { requestId: string };
				side?: Side;
				value?: string;
		  }
		| undefined;
	const token = ++serial;
	let requestSerial = 0;
	function button(text: string, label: string, action: () => void) {
		const element = document.createElement("button");
		element.type = "button";
		element.textContent = text;
		element.setAttribute("aria-label", label);
		element.onclick = action;
		return element;
	}
	function moveFocus(target: HTMLElement) {
		// Restoring a control must not reopen its candidate popup.
		applyingFocus = true;
		try {
			target.focus();
		} finally {
			applyingFocus = false;
		}
	}
	function setPopup(next: Popup | undefined, target?: HTMLElement) {
		if (popup?.type === "candidates")
			popup.active?.setAttribute("aria-selected", "false");
		popup = next;
		for (const side of sides) {
			const open = next?.type === "candidates" && next.side === side;
			side.candidates.hidden = !open;
			side.input.setAttribute("aria-expanded", String(open));
			side.input.removeAttribute("aria-activedescendant");
		}
		if (next?.type === "candidates" && next.active) {
			next.active.setAttribute("aria-selected", "true");
			next.side.input.setAttribute("aria-activedescendant", next.active.id);
		}
		menu.hidden = next?.type !== "edge";
		if (target) moveFocus(target);
	}
	function dismissPopup() {
		const previous = popup;
		const target =
			previous?.type === "edge" && menu.contains(document.activeElement)
				? previous.trigger
				: undefined;
		setPopup(undefined, target);
	}
	function connector(left: boolean) {
		const kind = editing?.nodes.find((n) => n.id === center)?.kind;
		return (kind === "process") === left ? (">>" as const) : ("->" as const);
	}
	function requestFor(
		side: Side,
		otherId: string,
		create: boolean,
	): Extract<PreviewEditRequest, { type: "addConnector" }> {
		return {
			type: "addConnector",
			nodeId: center!,
			source: editing!.source,
			connector: connector(side.left),
			otherId,
			create,
		};
	}
	function submit(request: PreviewEditRequest, side?: Side) {
		if (!editing || pending) return;
		const result = applyPreviewEdit(editing.source, request);
		if (!result.ok) {
			error.textContent = result.message;
			return;
		}
		const message = { ...request, requestId: `${token}:${++requestSerial}` };
		pending = {
			request: message,
			...(side ? { side, value: side.input.value } : {}),
		};
		error.textContent = "";
		const target =
			side?.input ?? (popup?.type === "edge" ? sides[0]!.input : undefined);
		setPopup(undefined, target);
		refreshInputs();
		host.postMessage(message);
	}
	function caption(id: string) {
		if (!editing) return id;
		const kind = model?.nodeKinds.get(id);
		const label =
			kind === "artifact" || kind === "process"
				? model?.frontmatter?.[kind]?.[id]?.label
				: undefined;
		return typeof label === "string" && label !== id ? `${id} — ${label}` : id;
	}
	function populate(side: Side) {
		side.candidates.replaceChildren();
		if (!editing || !center || !model) return;
		const kind = editing.nodes.find((n) => n.id === center)?.kind;
		const query = side.input.value.toLocaleLowerCase();
		for (const node of editing.nodes) {
			if (
				node.kind === kind ||
				!caption(node.id).toLocaleLowerCase().includes(query)
			)
				continue;
			let request = requestFor(side, node.id, false);
			let reason = connectorError(model, request);
			if (reason && request.connector === ">>") {
				const feedback = { ...request, connector: ">>?" as const };
				if (!connectorError(model, feedback)) {
					request = feedback;
					reason = undefined;
				}
			}
			const feedback = request.connector === ">>?";
			const candidate = button(
				`${caption(node.id)}${feedback ? " — feedback" : ""}`,
				`Connect ${caption(node.id)}${feedback ? " as feedback" : ""}`,
				() => submit(request, side),
			);
			candidate.dataset.candidate = node.id;
			candidate.id = `${side.candidates.id}-option-${side.candidates.childElementCount}`;
			candidate.tabIndex = -1;
			candidate.setAttribute("role", "option");
			candidate.setAttribute("aria-selected", "false");
			candidate.onpointerdown = (event) => event.preventDefault();
			candidate.disabled = !!pending || !!reason;
			if (reason) {
				candidate.title = reason;
				candidate.textContent += ` — ${reason}`;
			}
			side.candidates.append(candidate);
		}
	}
	function showCandidates(side: Side) {
		populate(side);
		setPopup({ type: "candidates", side });
	}
	function refreshInputs() {
		for (const side of sides) {
			const result =
				editing && center
					? applyPreviewEdit(
							editing.source,
							requestFor(side, side.input.value, true),
						)
					: undefined;
			const reason = result && !result.ok ? result.message : undefined;
			side.create.disabled = !!pending || !result?.ok;
			side.create.title = reason ?? "Create and connect a new node";
			side.reason.textContent = side.input.value ? (reason ?? "") : "";
		}
	}
	function createSide(left: boolean): Side {
		const section = document.createElement("div");
		section.dataset.side = left ? "left" : "right";
		section.className = "connections-side";
		section.setAttribute("role", "group");
		section.setAttribute(
			"aria-label",
			left
				? "Connections into the center node"
				: "Connections out of the center node",
		);
		const list = document.createElement("div");
		list.className = "connections-list";
		const controls = document.createElement("div");
		controls.className = "connections-input";
		const candidates = document.createElement("div");
		candidates.className = "connection-candidates";
		candidates.hidden = true;
		candidates.id = `connections-${token}-${left ? "left" : "right"}`;
		candidates.setAttribute("role", "listbox");
		const input = document.createElement("input");
		input.placeholder = "Connect a node…";
		input.autocomplete = "off";
		input.setAttribute("role", "combobox");
		input.setAttribute("aria-autocomplete", "list");
		input.setAttribute(
			"aria-label",
			left
				? "Connect a node into the center"
				: "Connect a node from the center",
		);
		input.setAttribute("aria-controls", candidates.id);
		input.setAttribute("aria-expanded", "false");
		const reason = document.createElement("span");
		reason.className = "connection-reason";
		reason.id = `${candidates.id}-reason`;
		input.setAttribute("aria-describedby", reason.id);
		const create = button("+", "Create and connect a new node", () =>
			submit(requestFor(side, input.value, true), side),
		);
		create.dataset.create = "";
		create.setAttribute("aria-describedby", reason.id);
		const side = {
			left,
			section,
			list,
			controls,
			input,
			create,
			candidates,
			reason,
		};
		input.oninput = () => {
			error.textContent = "";
			refreshInputs();
			showCandidates(side);
		};
		input.onfocus = () => {
			if (!applyingFocus) showCandidates(side);
		};
		input.onkeydown = (event) => {
			if (event.isComposing) return;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				if (popup?.type !== "candidates" || popup.side !== side)
					showCandidates(side);
				const options = [
					...candidates.querySelectorAll<HTMLButtonElement>(
						"button:not(:disabled)",
					),
				];
				const active = popup?.type === "candidates" ? popup.active : undefined;
				const index = active ? options.indexOf(active) : -1;
				const next =
					options[
						index < 0
							? event.key === "ArrowDown"
								? 0
								: options.length - 1
							: (index + (event.key === "ArrowDown" ? 1 : options.length - 1)) %
								options.length
					];
				setPopup({
					type: "candidates",
					side,
					...(next ? { active: next } : {}),
				});
				next?.scrollIntoView?.({ block: "nearest" });
			}
			if (event.key === "Enter") {
				event.preventDefault();
				if (popup?.type === "candidates" && popup.side === side)
					popup.active?.click();
			}
		};
		section.addEventListener("focusout", (event) => {
			if (
				popup?.type === "candidates" &&
				popup.side === side &&
				!section.contains(event.relatedTarget as Node)
			)
				setPopup(undefined);
		});
		controls.append(...(left ? [input, create] : [create, input]));
		section.append(list, controls, candidates, reason);
		return side;
	}
	const sides = [createSide(true), createSide(false)];
	const centerLabel = document.createElement("strong");
	centerLabel.className = "connections-center";
	layout.append(sides[0]!.section, centerLabel, sides[1]!.section);
	panel.onkeydown = (event) => {
		if (event.isComposing || event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		if (popup) dismissPopup();
		else host.close();
	};
	function showEdge(edge: NormalizedEdge, trigger: HTMLButtonElement) {
		setPopup(undefined);
		const remove = populateEdge(edge);
		setPopup({ type: "edge", trigger, edge }, remove);
	}
	function populateEdge(edge: NormalizedEdge) {
		menu.replaceChildren();
		const request = (
			type: "deleteConnector" | "toggleFeedback",
		): PreviewEditRequest => ({
			type,
			nodeId: center!,
			source: editing!.source,
			...edge,
		});
		const remove = button("Delete", "Delete this connection", () =>
			submit(request("deleteConnector")),
		);
		remove.dataset.deleteEdge = "";
		const toggle = button(
			edge.kind === "feedback" ? "Remove feedback" : "Make feedback",
			"Toggle feedback",
			() => submit(request("toggleFeedback")),
		);
		toggle.dataset.toggleFeedback = "";
		const result = applyPreviewEdit(editing!.source, request("toggleFeedback"));
		toggle.disabled = !!pending || !result.ok;
		if (!result.ok) toggle.title = result.message;
		const reason = document.createElement("span");
		reason.textContent = result.ok ? "" : result.message;
		menu.append(remove, toggle, reason);
		remove.disabled = !!pending;
		return remove;
	}
	function render(focused: Element | null = null) {
		if (!center || !editing || !model) return;
		const replacedFocus =
			menu.contains(focused) ||
			sides.some(
				(side) =>
					side.list.contains(focused) || side.candidates.contains(focused),
			);
		title.textContent = `Connections — ${caption(center)}`;
		centerLabel.textContent = caption(center);
		definition.textContent = editing.nodes.find((n) => n.id === center)?.defined
			? "Go to definition"
			: "Create definition";
		for (const side of sides) {
			side.list.replaceChildren();
			for (const edge of model.edges) {
				const from = edge.kind === "output" ? edge.process : edge.artifact;
				const to = edge.kind === "output" ? edge.artifact : edge.process;
				if ((side.left ? to : from) !== center) continue;
				const id = side.left ? from : to;
				const row = document.createElement("div");
				row.className = "connection-row";
				const neighbor = button(caption(id), `Go to ${caption(id)}`, () => {
					host.navigate(id);
					open(id);
				});
				neighbor.dataset.neighbor = id;
				const line = button(
					edge.kind === "feedback" ? "⇢" : "→",
					`${edge.kind} connection from ${from} to ${to}`,
					() => showEdge(edge, line),
				);
				line.dataset.edge = "";
				line.oncontextmenu = (event) => {
					event.preventDefault();
					showEdge(edge, line);
				};
				row.append(...(side.left ? [neighbor, line] : [line, neighbor]));
				side.list.append(row);
			}
		}
		refreshInputs();
		if (replacedFocus || (focused === definition && definition.hidden))
			moveFocus(sides[0]!.input);
	}
	function open(id: string, preserveFocus = false) {
		if (!editing?.nodes.some((n) => n.id === id)) return;
		if (center !== id) {
			for (const side of sides) side.input.value = "";
			// Navigation abandons input feedback, not the edit already sent to the host.
			if (pending) delete pending.side;
			setPopup(undefined);
			error.textContent = "";
		}
		center = id;
		panel.hidden = false;
		host.onOpenChange(true);
		render();
		if (preserveFocus) return;
		if (
			editing.nodes.find((n) => n.id === id)?.defined ||
			definition.disabled
		) {
			showCandidates(sides[0]!);
			moveFocus(sides[0]!.input);
		} else setPopup(undefined, definition);
	}
	definition.onclick = () => {
		if (editing && center) {
			if (editing.nodes.find((n) => n.id === center)?.defined) {
				host.postMessage({ type: "nodeClick", nodeId: center });
				return;
			}
			submit({
				type: "createDefinition",
				nodeId: center,
				source: editing.source,
			});
		}
	};
	panel.querySelector<HTMLButtonElement>("#node-actions-close")!.onclick = () =>
		host.close();
	return {
		open,
		isOpen: () => center !== undefined,
		close() {
			center = undefined;
			if (pending) delete pending.side;
			setPopup(undefined);
			panel.hidden = true;
			host.onOpenChange(false);
		},
		resize() {
			dismissPopup();
		},
		update(data: Editing) {
			const focused = document.activeElement;
			if (data?.source !== editing?.source)
				model = data ? analyzeSource(data.source) : undefined;
			editing = data;
			setPopup(undefined);
			if (!data?.nodes.some((n) => n.id === center)) {
				this.close();
				return;
			}
			render(focused);
		},
		result(message: Extract<MessageToWebview, { type: "editResult" }>) {
			// A reply updates data; the user may already be working elsewhere.
			if (!pending || message.request.requestId !== pending.request.requestId)
				return;
			const { side, value } = pending;
			pending = undefined;
			if (message.ok) {
				if (side && side.input.value === value) side.input.value = "";
				error.textContent = "";
			} else
				error.textContent = message.message ?? "The edit could not be applied.";
			refreshInputs();
			if (popup?.type === "candidates") showCandidates(popup.side);
			else if (popup?.type === "edge") populateEdge(popup.edge);
		},
	};
}

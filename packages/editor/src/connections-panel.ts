import { analyzeSource, type NormalizedEdge } from "@pfdsl/core";
import type { MessageToWebview } from "./messages.js";
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
let serial = 0;

export function mountConnections(
	container: HTMLElement,
	host: {
		postMessage(request: PreviewEditRequest): void;
		navigate(id: string): void;
		close(): void;
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
	let pending:
		| { request: PreviewEditRequest; side?: Side; value?: string }
		| undefined;
	const token = ++serial;
	function button(text: string, label: string, action: () => void) {
		const element = document.createElement("button");
		element.type = "button";
		element.textContent = text;
		element.setAttribute("aria-label", label);
		element.onclick = action;
		return element;
	}
	function hideCandidates() {
		for (const side of sides) {
			side.candidates.hidden = true;
			side.input.setAttribute("aria-expanded", "false");
		}
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
		pending = { request, ...(side ? { side, value: side.input.value } : {}) };
		error.textContent = "";
		hideCandidates();
		menu.hidden = true;
		refreshInputs();
		host.postMessage(request);
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
	function populate(side: Side, show = false) {
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
			const request = requestFor(side, node.id, false);
			const reason = connectorError(model, request);
			const candidate = button(
				caption(node.id),
				`Connect ${caption(node.id)}`,
				() => submit(request, side),
			);
			candidate.dataset.candidate = node.id;
			candidate.setAttribute("role", "option");
			candidate.disabled = !!pending || !!reason;
			if (reason) {
				candidate.title = reason;
				candidate.textContent += ` — ${reason}`;
			}
			side.candidates.append(candidate);
		}
		if (show) {
			hideCandidates();
			side.candidates.hidden = false;
			side.input.setAttribute("aria-expanded", "true");
		}
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
			populate(side, true);
		};
		input.onfocus = () => populate(side, true);
		input.onkeydown = (event) => {
			if (event.isComposing) return;
			if (event.key === "Escape") {
				event.stopPropagation();
				hideCandidates();
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				populate(side, true);
				candidates
					.querySelector<HTMLButtonElement>("button:not(:disabled)")
					?.focus();
			}
			if (event.key === "Enter") event.preventDefault();
		};
		candidates.onkeydown = (event) => {
			const options = [
				...candidates.querySelectorAll<HTMLButtonElement>(
					"button:not(:disabled)",
				),
			];
			const index = options.indexOf(
				document.activeElement as HTMLButtonElement,
			);
			if (event.key === "Escape") {
				event.stopPropagation();
				hideCandidates();
				input.focus();
				hideCandidates();
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				options[
					(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) %
						options.length
				]?.focus();
			}
		};
		section.addEventListener("focusout", (event) => {
			if (!section.contains(event.relatedTarget as Node)) hideCandidates();
		});
		controls.append(...(left ? [input, create] : [create, input]));
		section.append(list, controls, candidates, reason);
		return side;
	}
	const sides = [createSide(true), createSide(false)];
	const centerLabel = document.createElement("strong");
	centerLabel.className = "connections-center";
	layout.append(sides[0]!.section, centerLabel, sides[1]!.section);
	function showEdge(edge: NormalizedEdge, trigger: HTMLButtonElement) {
		menu.replaceChildren();
		hideCandidates();
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
		menu.hidden = false;
		remove.disabled = !!pending;
		remove.focus();
		menu.onkeydown = (event) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				menu.hidden = true;
				trigger.focus();
			}
		};
	}
	function render() {
		if (!center || !editing || !model) return;
		title.textContent = `Connections — ${caption(center)}`;
		centerLabel.textContent = caption(center);
		definition.hidden =
			editing.nodes.find((n) => n.id === center)?.defined ?? true;
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
	}
	function open(id: string) {
		if (!editing?.nodes.some((n) => n.id === id)) return;
		if (center !== id) {
			for (const side of sides) side.input.value = "";
			pending = undefined;
			menu.hidden = true;
			hideCandidates();
			error.textContent = "";
		}
		center = id;
		panel.hidden = false;
		render();
	}
	definition.onclick = () => {
		if (editing && center)
			submit({
				type: "createDefinition",
				nodeId: center,
				source: editing.source,
			});
	};
	panel.querySelector<HTMLButtonElement>("#node-actions-close")!.onclick = () =>
		host.close();
	return {
		open,
		close() {
			center = undefined;
			pending = undefined;
			menu.hidden = true;
			hideCandidates();
			panel.hidden = true;
		},
		resize() {
			hideCandidates();
			menu.hidden = true;
		},
		update(data: Editing) {
			if (data?.source !== editing?.source)
				model = data ? analyzeSource(data.source) : undefined;
			editing = data;
			hideCandidates();
			menu.hidden = true;
			if (!data?.nodes.some((n) => n.id === center)) {
				this.close();
				return;
			}
			render();
		},
		result(message: Extract<MessageToWebview, { type: "editResult" }>) {
			if (
				!pending ||
				JSON.stringify(message.request) !== JSON.stringify(pending.request)
			)
				return;
			const { side, value } = pending;
			pending = undefined;
			if (message.ok) {
				if (side && side.input.value === value) side.input.value = "";
				error.textContent = "";
			} else
				error.textContent = message.message ?? "The edit could not be applied.";
			refreshInputs();
			side?.input.focus();
			hideCandidates();
		},
	};
}

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { analyzeSnapshot, prepareDocument } from "./document.js";
import { mountPreview } from "./preview.js";
import * as previewEdits from "./preview-edit.js";

const dispose: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of dispose.splice(0)) cleanup();
	vi.restoreAllMocks();
});
async function setup(
	source = "---\nartifact:\n  free: {label: Searchable result}\n---\na >> p -> b\n",
) {
	vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
	const container = document.createElement("div");
	document.body.append(container);
	const postMessage = vi.fn();
	const preview = mountPreview(container, {
		postMessage,
		renderDot: async () =>
			'<svg width="200" height="100"><g class="node"><title>a</title></g><g class="node"><title>p</title></g><g class="node"><title>b</title></g></svg>',
	});
	dispose.push(() => {
		preview.dispose();
		container.remove();
	});
	await preview.receive(
		prepareDocument(analyzeSnapshot(source), null, () => null).message,
	);
	container
		.querySelector('[data-node-id="p"]')!
		.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
		);
	return { container, postMessage, preview, source };
}

it.each([
	{ center: "p", side: "left", other: "b" },
	{ center: "b", side: "right", other: "p" },
])("offers explicit feedback for a backward loop from $center", async ({
	center,
	side,
	other,
}) => {
	const s = await setup();
	if (center !== "p")
		s.container
			.querySelector<HTMLButtonElement>(`[data-neighbor="${center}"]`)!
			.click();
	const input = s.container.querySelector<HTMLInputElement>(
		`[data-side="${side}"] input`,
	)!;
	input.focus();
	const candidate = s.container.querySelector<HTMLButtonElement>(
		`[data-side="${side}"] [data-candidate="${other}"]`,
	)!;
	expect(candidate.disabled).toBe(false);
	expect(candidate.textContent).toContain("feedback");
	candidate.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	expect(request).toMatchObject({
		type: "addConnector",
		nodeId: center,
		otherId: other,
		connector: ">>?",
		create: false,
	});
	const result = previewEdits.applyPreviewEdit(s.source, request);
	expect(result.ok).toBe(true);
	if (result.ok) expect(result.source).toContain("b >>? p");
});

it.each([
	"Enter",
	" ",
	"ContextMenu",
])("focuses a panel control after opening Connections with %s", async (key) => {
	const s = await setup();
	s.container.querySelector<HTMLButtonElement>("#node-actions-close")!.click();
	const node = s.container.querySelector<SVGGElement>('[data-node-id="p"]')!;
	node.focus();
	node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
	const panel = s.container.querySelector<HTMLElement>("#node-actions")!;
	expect(panel.hidden).toBe(false);
	expect(panel.contains(document.activeElement)).toBe(true);
});

it("disables creation when a parsed metadata alias cannot retain the new definition", async () => {
	const s = await setup(
		"---\nshared: &empty {}\nartifact: *empty\n---\na >> p -> b\n",
	);
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.value = "fresh";
	input.dispatchEvent(new Event("input"));
	const create = s.container.querySelector<HTMLButtonElement>(
		'[data-side="right"] [data-create]',
	)!;
	expect(create.disabled).toBe(true);
	expect(create.title).toContain("definition could not be inserted safely");
});

function expectPanelFocus(container: HTMLElement) {
	const focused = document.activeElement!;
	expect(container.querySelector("#node-actions")!.contains(focused)).toBe(
		true,
	);
	expect(focused.isConnected).toBe(true);
	expect(focused.closest("[hidden]")).toBeNull();
}

it("keeps keyboard focus in Connections through consecutive neighbor moves", async () => {
	const s = await setup("x >> r -> a >> p -> b\n");
	for (const id of ["a", "r", "a", "p"]) {
		const neighbor = s.container.querySelector<HTMLButtonElement>(
			`[data-neighbor="${id}"]`,
		)!;
		neighbor.focus();
		neighbor.click();
		expect(s.container.querySelector("#node-actions-title")!.textContent).toBe(
			`Connections — ${id}`,
		);
		expectPanelFocus(s.container);
	}
});

it.each(
	[
		{ source: "a >> p -> b\n", action: "delete-edge" },
		{ source: "a >> p -> b\n", action: "toggle-feedback" },
		{ source: "a >>? p -> b\n", action: "toggle-feedback" },
	].flatMap((operation) =>
		[true, false].flatMap((ok) =>
			[true, false].map((renderFirst) => ({ ...operation, ok, renderFirst })),
		),
	),
)("restores visible focus for $action (ok=$ok, renderFirst=$renderFirst, source=$source)", async ({
	source,
	action,
	ok,
	renderFirst,
}) => {
	const s = await setup(source);
	s.container
		.querySelector<HTMLButtonElement>('[data-side="left"] [data-edge]')!
		.click();
	const control = s.container.querySelector<HTMLButtonElement>(
		`[data-${action}]`,
	)!;
	control.focus();
	control.click();
	expectPanelFocus(s.container);
	const request = s.postMessage.mock.calls.at(-1)![0];
	const edit = previewEdits.applyPreviewEdit(source, request);
	expect(edit.ok).toBe(true);
	const updated = ok && edit.ok ? edit.source : source;
	const redraw = () =>
		s.preview.receive(
			prepareDocument(analyzeSnapshot(updated), null, () => null).message,
		);
	if (renderFirst) await redraw();
	await s.preview.receive({
		type: "editResult",
		request,
		ok,
		...(ok ? {} : { message: "The revision changed" }),
	});
	if (!renderFirst) await redraw();
	expectPanelFocus(s.container);
	expect(
		s.container.querySelector<HTMLElement>(".connection-menu")!.hidden,
	).toBe(true);
});

it("keeps visible panel focus after deleting the last connection", async () => {
	const s = await setup("a >> p\n");
	s.container
		.querySelector<HTMLButtonElement>('[data-side="left"] [data-edge]')!
		.click();
	s.container.querySelector<HTMLButtonElement>("[data-delete-edge]")!.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	const result = previewEdits.applyPreviewEdit(s.source, request);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(result.source), null, () => null).message,
	);
	await s.preview.receive({ type: "editResult", request, ok: true });
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		false,
	);
	expect(s.container.querySelectorAll("[data-edge]")).toHaveLength(0);
	expectPanelFocus(s.container);
});

it("preserves text typed after sending a connection while its reply is pending", async () => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.value = "new_result";
	input.dispatchEvent(new Event("input"));
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	input.value = "next_result";
	input.dispatchEvent(new Event("input"));
	await s.preview.receive({ type: "editResult", request, ok: true });
	expect(input.value).toBe("next_result");
});

it("validates existing candidates without generating edited documents for each candidate", async () => {
	const s = await setup();
	const compute = vi.spyOn(previewEdits, "applyPreviewEdit");
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="left"] input',
	)!;
	input.focus();
	input.value = "free";
	input.dispatchEvent(new Event("input"));
	expect(
		s.container.querySelector<HTMLButtonElement>('[data-candidate="free"]')!
			.disabled,
	).toBe(false);
	expect(
		compute.mock.calls.every(
			([, request]) => request.type === "addConnector" && request.create,
		),
	).toBe(true);
	expect(compute.mock.calls.length).toBeLessThanOrEqual(4);
});

it("supports candidate keyboard navigation, Escape, IME input, resize and focus departure without creating a node", async () => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="left"] input',
	)!;
	input.value = "free";
	input.dispatchEvent(new Event("input"));
	input.focus();
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			bubbles: true,
			isComposing: true,
		}),
	);
	expect(document.activeElement).toBe(input);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	const candidate = s.container.querySelector<HTMLButtonElement>(
		'[data-side="left"] [data-candidate="free"]',
	)!;
	expect(document.activeElement).toBe(candidate);
	candidate.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	candidate.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
	);
	candidate.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(document.activeElement).toBe(input);
	expect(input.getAttribute("aria-expanded")).toBe("false");
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	input.focus();
	window.dispatchEvent(new Event("resize"));
	expect(input.value).toBe("free");
	expect(input.getAttribute("aria-expanded")).toBe("false");
	input.dispatchEvent(new Event("focus"));
	s.container.querySelector<HTMLButtonElement>("#node-actions-close")!.focus();
	expect(input.getAttribute("aria-expanded")).toBe("false");
	expect(
		s.postMessage.mock.calls.filter(([m]) => m.type === "addConnector"),
	).toHaveLength(0);
});

it("keeps candidates through internal layout changes and closes them when the preview is resized", async () => {
	let resized!: ResizeObserverCallback;
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resized = callback;
			}
			observe() {}
			disconnect() {}
		},
	);
	try {
		const s = await setup();
		const input = s.container.querySelector<HTMLInputElement>(
			'[data-side="left"] input',
		)!;
		input.value = "b";
		input.dispatchEvent(new Event("input"));
		resized([], {} as ResizeObserver);
		expect(input.getAttribute("aria-expanded")).toBe("true");
		Object.defineProperty(s.container, "clientWidth", { value: 600 });
		resized([], {} as ResizeObserver);
		expect(input.getAttribute("aria-expanded")).toBe("false");
		expect(input.value).toBe("b");
	} finally {
		vi.unstubAllGlobals();
	}
});

it("keeps rejected text and displays host refusals, and drops a late result after the center closes", async () => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.value = "new_result";
	input.dispatchEvent(new Event("input"));
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	await s.preview.receive({
		type: "editResult",
		request,
		ok: false,
		message: "The revision changed",
	});
	expect(input.value).toBe("new_result");
	expect(
		s.container.querySelector("#node-actions-error")!.textContent,
	).toContain("revision");
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	await s.preview.receive({
		type: "editResult",
		request: s.postMessage.mock.calls.at(-1)![0],
		ok: false,
	});
	expect(
		s.container.querySelector("#node-actions-error")!.textContent,
	).toContain("could not be applied");
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	s.container.querySelector<HTMLButtonElement>("#node-actions-close")!.click();
	await s.preview.receive({ type: "editResult", request, ok: true });
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
});

it("toggles semantic input from either endpoint, retains center through redraw and rejects stale candidates", async () => {
	const s = await setup();
	const edge = s.container.querySelector<HTMLButtonElement>(
		'[data-side="left"] [data-edge]',
	)!;
	edge.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
	s.container
		.querySelector<HTMLButtonElement>("[data-toggle-feedback]")!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	expect(request).toMatchObject({
		type: "toggleFeedback",
		kind: "input",
		artifact: "a",
		process: "p",
	});
	await s.preview.receive({ type: "editResult", request, ok: true });
	edge.click();
	s.container
		.querySelector<HTMLElement>(".connection-menu")!
		.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
	expect(document.activeElement).toBe(edge);
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.value = "free";
	input.dispatchEvent(new Event("input"));
	const stale = s.container.querySelector<HTMLButtonElement>(
		'[data-side="right"] [data-candidate="free"]',
	)!;
	const changed = `${s.source}x >> q -> z\n`;
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(changed), null, () => null).message,
	);
	expect(input.value).toBe("free");
	s.postMessage.mockClear();
	stale.click();
	expect(s.postMessage).not.toHaveBeenCalled();
	expect(
		s.container.querySelector("#node-actions-error")!.textContent,
	).toContain("document changed");
	s.container.querySelector<HTMLButtonElement>('[data-neighbor="a"]')!.click();
	s.container.querySelector<HTMLButtonElement>("#create-definition")!.click();
	expect(s.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({
			type: "createDefinition",
			nodeId: "a",
			source: changed,
		}),
	);
	const definitionRequest = s.postMessage.mock.calls.at(-1)![0];
	s.container.querySelector<HTMLButtonElement>("#create-definition")!.click();
	expect(s.postMessage.mock.calls).toHaveLength(1);
	await s.preview.receive({
		type: "editResult",
		request: definitionRequest,
		ok: true,
	});
	const feedback = `${changed}b >>? p\n`;
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(feedback), null, () => null).message,
	);
	s.container.querySelector<HTMLButtonElement>('[data-neighbor="p"]')!.click();
	s.container
		.querySelector<HTMLButtonElement>(
			'[aria-label="feedback connection from b to p"]',
		)!
		.click();
	expect(s.container.querySelector("[data-toggle-feedback]")!.textContent).toBe(
		"Remove feedback",
	);
});

it("shows both connection sides and navigates while retaining the full graph", async () => {
	const s = await setup();
	expect(
		s.container.querySelector('[aria-label="Connections"]'),
	).not.toBeNull();
	expect(
		s.container.querySelector('[data-side="left"] [data-neighbor="a"]'),
	).not.toBeNull();
	expect(
		s.container.querySelector('[data-side="right"] [data-neighbor="b"]'),
	).not.toBeNull();
	s.container.querySelector<HTMLButtonElement>('[data-neighbor="a"]')!.click();
	expect(
		s.container.querySelector("#node-actions-title")!.textContent,
	).toContain("a");
	expect(s.container.querySelectorAll("#inner g.node")).toHaveLength(3);
});

it("reports Create Definition availability for the selected node and invalidates it with the graph", async () => {
	const s = await setup();
	expect(s.preview.canCreateDefinition()).toBe(true);
	s.preview.createDefinition();
	expect(s.postMessage).toHaveBeenLastCalledWith({
		type: "createDefinition",
		nodeId: "p",
		source: s.source,
	});
	const defined = s.source.replace(
		"artifact:\n",
		"process:\n  p: {label: Task}\nartifact:\n",
	);
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(defined), null, () => null).message,
	);
	expect(s.preview.canCreateDefinition()).toBe(false);
	s.postMessage.mockClear();
	s.preview.createDefinition();
	expect(s.postMessage).not.toHaveBeenCalled();
	await s.preview.receive({ type: "error", message: "Broken" });
	expect(s.preview.canCreateDefinition()).toBe(false);
});

it("filters by label, connects candidates, and only explicitly creates from +", async () => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.value = "Searchable";
	input.dispatchEvent(new Event("input"));
	input.focus();
	const candidate = s.container.querySelector<HTMLButtonElement>(
		'[data-candidate="free"]',
	)!;
	expect(candidate.textContent).toContain("Searchable result");
	candidate.click();
	expect(s.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({
			type: "addConnector",
			otherId: "free",
			connector: "->",
			create: false,
		}),
	);
	await s.preview.receive({
		type: "editResult",
		request: s.postMessage.mock.calls.at(-1)![0],
		ok: true,
	});
	input.value = "new_result";
	input.dispatchEvent(new Event("input"));
	s.postMessage.mockClear();
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	expect(s.postMessage).not.toHaveBeenCalled();
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	expect(s.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({ otherId: "new_result", create: true }),
	);
});

it("clears only the accepted side, ignores unrelated replies, and clears candidates on center changes", async () => {
	const s = await setup();
	const left = s.container.querySelector<HTMLInputElement>(
		'[data-side="left"] input',
	)!;
	const right = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	left.value = "left_new";
	left.dispatchEvent(new Event("input"));
	right.value = "right_new";
	right.dispatchEvent(new Event("input"));
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	await s.preview.receive({
		type: "editResult",
		request: { ...request, otherId: "unrelated" },
		ok: true,
	});
	expect(right.value).toBe("right_new");
	await s.preview.receive({ type: "editResult", request, ok: true });
	expect(right.value).toBe("");
	expect(left.value).toBe("left_new");
	s.container.querySelector<HTMLButtonElement>('[data-neighbor="a"]')!.click();
	expect(left.value).toBe("");
	expect(right.value).toBe("");
});

it("offers delete and input feedback only, and keeps text hover free of an interactive graph", async () => {
	const s = await setup();
	const output = s.container.querySelector<HTMLButtonElement>(
		'[data-side="right"] [data-edge]',
	)!;
	output.click();
	expect(
		s.container.querySelector<HTMLButtonElement>("[data-toggle-feedback]")!
			.disabled,
	).toBe(true);
	s.container.querySelector<HTMLButtonElement>("[data-delete-edge]")!.click();
	expect(s.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({
			type: "deleteConnector",
			artifact: "b",
			process: "p",
			kind: "output",
		}),
	);
	s.container
		.querySelector('[data-node-id="a"]')!
		.dispatchEvent(
			new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 30 }),
		);
	await Promise.resolve();
	expect(s.container.querySelector("#tooltip svg")).toBeNull();
});

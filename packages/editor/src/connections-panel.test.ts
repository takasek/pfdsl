// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { analyzeSnapshot, prepareDocument } from "./document.js";
import { mountPreview } from "./preview.js";
import * as previewEdits from "./preview-edit.js";
import { previewStyles } from "./preview-shell.js";

const dispose: Array<() => void> = [];

it.each([
	true,
	false,
])("does not reopen dismissed candidates on late success (renderFirst=%s)", async (renderFirst) => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.focus();
	s.container
		.querySelector<HTMLButtonElement>(
			'[data-side="right"] [data-candidate="free"]',
		)!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	const result = previewEdits.applyPreviewEdit(s.source, request);
	if (!result.ok) throw new Error(result.message);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(input.getAttribute("aria-expanded")).toBe("false");
	const redraw = () =>
		s.preview.receive(
			prepareDocument(analyzeSnapshot(result.source), null, () => null).message,
		);
	if (renderFirst) await redraw();
	await s.preview.receive({ type: "editResult", request, ok: true });
	if (!renderFirst) await redraw();
	expect(input.getAttribute("aria-expanded")).toBe("false");
	expect(document.activeElement).toBe(input);
});

it.each([
	"center",
	"input",
	"document",
])("does not reopen old candidates after changing $0 while an addition is pending", async (change) => {
	const s = await setup();
	const right = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	right.focus();
	s.container
		.querySelector<HTMLButtonElement>(
			'[data-side="right"] [data-candidate="free"]',
		)!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	if (change === "center")
		await s.preview.receive({ type: "focus", nodeId: "a" });
	if (change === "document")
		await s.preview.receive(
			prepareDocument(analyzeSnapshot("x >> p -> y\n"), null, () => null)
				.message,
		);
	const current = s.container.querySelector<HTMLInputElement>(
		`[data-side="${change === "input" ? "left" : "right"}"] input`,
	)!;
	current.focus();
	current.value = "next";
	current.dispatchEvent(new Event("input"));
	current.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	await s.preview.receive({ type: "editResult", request, ok: true });
	expect(current.value).toBe("next");
	expect(document.activeElement).toBe(current);
	expect(
		s.container.querySelector('[role="combobox"][aria-expanded="true"]'),
	).toBeNull();
});

it.each([
	"neighbor",
	"edge",
])("preserves %s focus when reopening the same center with the pointer", async (control) => {
	const s = await setup();
	const selector =
		control === "neighbor"
			? '[data-side="right"] [data-neighbor="b"]'
			: '[data-side="right"] [data-edge]';
	s.container.querySelector<HTMLButtonElement>(selector)!.focus();
	s.container
		.querySelector('[data-node-id="p"]')!
		.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
		);
	expect(document.activeElement).toBe(s.container.querySelector(selector));
	expect(
		s.container.querySelector('[role="combobox"][aria-expanded="true"]'),
	).toBeNull();
});

it.each([
	true,
	false,
])("distinguishes parallel input and feedback rows after deletion (renderFirst=%s)", async (renderFirst) => {
	const s = await setup("a >> p\na >>? p\nc >> p\n");
	s.container
		.querySelector<HTMLButtonElement>(
			'[data-side="left"] [data-edge][data-kind="feedback"]',
		)!
		.click();
	s.container.querySelector<HTMLButtonElement>("[data-delete-edge]")!.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	const result = previewEdits.applyPreviewEdit(s.source, request);
	if (!result.ok) throw new Error(result.message);
	const redraw = () =>
		s.preview.receive(
			prepareDocument(analyzeSnapshot(result.source), null, () => null).message,
		);
	if (renderFirst) await redraw();
	await s.preview.receive({ type: "editResult", request, ok: true });
	if (!renderFirst) await redraw();
	expect(document.activeElement).toBe(
		s.container
			.querySelector('[data-neighbor="c"]')!
			.closest(".connection-row")!
			.querySelector("[data-edge]"),
	);
});

it("distinguishes an unchanged feedback row from an input row on redraw", async () => {
	const s = await setup("a >> p\na >>? p\nc >> p\n");
	s.container
		.querySelector<HTMLButtonElement>('[data-edge][data-kind="feedback"]')!
		.focus();
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(`${s.source}# redraw\n`), null, () => null)
			.message,
	);
	expect(document.activeElement).toBe(
		s.container.querySelector('[data-edge][data-kind="feedback"]'),
	);
});

it.each([
	true,
	false,
])("restores the switched semantic connection among repeated endpoints (renderFirst=%s)", async (renderFirst) => {
	const s = await setup("a >> p\na >>? p\nc >> p\n");
	// Removing one kind makes the remaining kind switchable without changing edit rules.
	s.container
		.querySelector<HTMLButtonElement>('[data-edge][data-kind="input"]')!
		.click();
	s.container.querySelector<HTMLButtonElement>("[data-delete-edge]")!.click();
	let request = s.postMessage.mock.calls.at(-1)![0];
	let result = previewEdits.applyPreviewEdit(s.source, request);
	if (!result.ok) throw new Error(result.message);
	const remaining = result.source;
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(remaining), null, () => null).message,
	);
	await s.preview.receive({ type: "editResult", request, ok: true });
	s.container
		.querySelector<HTMLButtonElement>('[data-edge][data-kind="feedback"]')!
		.click();
	s.container
		.querySelector<HTMLButtonElement>("[data-toggle-feedback]")!
		.click();
	request = s.postMessage.mock.calls.at(-1)![0];
	result = previewEdits.applyPreviewEdit(remaining, request);
	if (!result.ok) throw new Error(result.message);
	const changed = result.source;
	const redraw = () =>
		s.preview.receive(
			prepareDocument(analyzeSnapshot(changed), null, () => null).message,
		);
	if (renderFirst) await redraw();
	await s.preview.receive({ type: "editResult", request, ok: true });
	if (!renderFirst) await redraw();
	const row = s.container
		.querySelector('[data-neighbor="a"]')!
		.closest(".connection-row")!;
	expect(document.activeElement).toBe(
		row.querySelector('[data-edge][data-kind="input"]'),
	);
	expect(
		s.container.querySelector('[role="combobox"][aria-expanded="true"]'),
	).toBeNull();
});

it.each([
	false,
	true,
])("opens without candidates, with heading focus only for keyboard (defined=%s)", async (defined) => {
	const s = await setup(
		defined
			? "---\nprocess:\n  p: {label: Work}\n---\na >> p -> b\n"
			: undefined,
	);
	s.container.querySelector<HTMLButtonElement>("#node-actions-close")!.click();
	const node = s.container.querySelector<SVGGElement>('[data-node-id="p"]')!;
	node.focus();
	node.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
	expect(document.activeElement).toBe(node);
	expect(
		s.container.querySelector('[role="combobox"][aria-expanded="true"]'),
	).toBeNull();
	node.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	expect(document.activeElement).toBe(
		s.container.querySelector("#create-definition"),
	);
	expect(
		s.container.querySelector('[role="combobox"][aria-expanded="true"]'),
	).toBeNull();
});

it.each([
	{
		source: "a >> p -> b\n",
		side: "left",
		absent: "a",
		present: "b",
		feedback: true,
	},
	{
		source: "a >>? p -> b\n",
		side: "left",
		absent: "a",
		present: "b",
		feedback: true,
	},
	{
		source: "a >> p -> b\nc >> q -> d\n",
		side: "right",
		absent: "d",
		present: "c",
		feedback: false,
	},
	{
		source: "---\nartifact:\n  free: {}\n---\na >> p -> b\n",
		side: "right",
		absent: "b",
		present: "free",
		feedback: false,
	},
])("filters candidates by semantic connection and edit validity ($source, $side)", async ({
	source,
	side,
	absent,
	present,
	feedback,
}) => {
	const s = await setup(source);
	s.container
		.querySelector<HTMLInputElement>(`[data-side="${side}"] input`)!
		.focus();
	const list = s.container.querySelector(
		`[data-side="${side}"] .connection-candidates`,
	)!;
	expect(list.querySelector(`[data-candidate="${absent}"]`)).toBeNull();
	const option = list.querySelector<HTMLElement>(
		`[data-candidate="${present}"]`,
	)!;
	expect(option).not.toBeNull();
	expect(option.getAttribute("aria-label")).toContain("artifact");
	expect(option.querySelector('[data-kind="artifact"]')).not.toBeNull();
	expect(option.dataset.feedback === "true").toBe(feedback);
	expect(option.textContent).not.toContain(" — ");
});

it("shows draft -> doc as a feedback candidate into draft", async () => {
	const s = await setup("draft -> doc\na >> p\n");
	await s.preview.receive({ type: "focus", nodeId: "draft" });
	s.container
		.querySelector<HTMLInputElement>('[data-side="left"] input')!
		.focus();
	s.container
		.querySelector<HTMLButtonElement>('[data-candidate="doc"]')!
		.click();
	expect(s.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({
			nodeId: "draft",
			otherId: "doc",
			connector: ">>?",
		}),
	);
});

it("gives center and neighbors kind shapes and accessible names", async () => {
	const s = await setup();
	const center = s.container.querySelector<HTMLElement>(".connections-center")!;
	expect(center.dataset.kind).toBe("process");
	expect(center.getAttribute("role")).toBe("img");
	expect(center.getAttribute("aria-label")).toContain("process");
	const neighbor = s.container.querySelector('[data-neighbor="a"]')!;
	expect(neighbor.querySelector('[data-kind="artifact"]')).not.toBeNull();
	expect(neighbor.getAttribute("aria-label")).toContain("artifact");
});

it("uses kind outlines, distinct connection strokes, shared borders and scroll padding", async () => {
	const s = await setup("a >> p\nb >>? p\n");
	const style = document.createElement("style");
	// JSDOM cannot resolve CSS variables; use the stylesheet's theme fallbacks.
	style.textContent = previewStyles.replace(
		/var\(--[^,)]+,\s*([^)]+)\)/g,
		"$1",
	);
	s.container.append(style);
	const css = (selector: string) =>
		window.getComputedStyle(s.container.querySelector(selector)!);
	expect(css(".connections-center").borderRadius).toBe("999px");
	expect(css('[data-neighbor="a"] .connection-node').borderRadius).toBe("0");
	expect(css(".connection-row").borderTopWidth).toBe("1px");
	expect(css(".connections-input").borderTopWidth).toBe("1px");
	expect(css("[data-edge]").borderTopWidth).toBe("0px");
	for (const selector of [
		".connections-list",
		".connection-candidates",
		".connection-reason",
		".connection-menu",
	]) {
		const computed = css(selector);
		expect(
			parseFloat(computed.paddingInline || computed.paddingLeft),
		).toBeGreaterThanOrEqual(14);
		expect(
			parseFloat(computed.paddingInline || computed.paddingRight),
		).toBeGreaterThanOrEqual(14);
	}
	expect(css(".connection-menu").position).toBe("fixed");
	// JSDOM does not paint pseudo-elements; assert the authored stroke rules too.
	expect(previewStyles).toContain("border-top: 2px solid currentColor");
	expect(previewStyles).toContain(
		'[data-kind="feedback"]::before { border-top-style: dashed; }',
	);
	expect(css('[data-edge][data-kind="feedback"]').color).toBe(
		"rgb(136, 136, 136)",
	);
});

it("anchors and clamps the context menu, navigates by keyboard, and returns on Escape", async () => {
	const s = await setup();
	const edge = s.container.querySelector<HTMLButtonElement>(
		'[data-side="left"] [data-edge]',
	)!;
	vi.spyOn(edge, "getBoundingClientRect").mockReturnValue(
		new DOMRect(1000, 750, 30, 24),
	);
	const menu = s.container.querySelector<HTMLElement>(".connection-menu")!;
	vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 180, 80),
	);
	edge.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
	expect(menu.getAttribute("role")).toBe("menu");
	expect(parseFloat(menu.style.left) + 180).toBeLessThanOrEqual(
		window.innerWidth,
	);
	expect(parseFloat(menu.style.top) + 80).toBeLessThanOrEqual(
		window.innerHeight,
	);
	expect(parseFloat(menu.style.left)).toBeGreaterThan(0);
	menu.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	expect(document.activeElement).toBe(
		menu.querySelector("[data-toggle-feedback]"),
	);
	menu.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
	);
	expect(document.activeElement).toBe(menu.querySelector("[data-delete-edge]"));
	menu.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(menu.hidden).toBe(true);
	expect(document.activeElement).toBe(edge);
	edge.click();
	document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
	expect(menu.hidden).toBe(true);
});

it("keeps one-item edge menus keyboard navigable and returns focus on Escape", async () => {
	const s = await setup("a >> p -> b\nb >>? p\n");
	const edge = s.container.querySelector<HTMLButtonElement>(
		'[data-side="left"] [data-edge][data-kind="feedback"]',
	)!;
	const menu = s.container.querySelector<HTMLElement>(".connection-menu")!;
	edge.dispatchEvent(
		new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
	);
	const remove = menu.querySelector<HTMLButtonElement>("[data-delete-edge]")!;
	expect(menu.hidden).toBe(false);
	expect(menu.querySelectorAll("[role=menuitem]")).toHaveLength(1);
	expect(document.activeElement).toBe(remove);
	for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
		const event = new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
		});
		menu.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(document.activeElement).toBe(remove);
	}
	menu.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(menu.hidden).toBe(true);
	expect(document.activeElement).toBe(edge);
});

it.each([
	true,
	false,
])("reopens current candidates after adding in either reply order (renderFirst=%s)", async (renderFirst) => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.focus();
	s.container
		.querySelector<HTMLButtonElement>(
			'[data-side="right"] [data-candidate="free"]',
		)!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	const result = previewEdits.applyPreviewEdit(s.source, request);
	if (!result.ok) throw new Error(result.message);
	const redraw = () =>
		s.preview.receive(
			prepareDocument(analyzeSnapshot(result.source), null, () => null).message,
		);
	if (renderFirst) await redraw();
	await s.preview.receive({ type: "editResult", request, ok: true });
	if (!renderFirst) {
		// A success acknowledgement must not enable candidates from the old source.
		expect(
			s.container.querySelector(
				'[data-side="right"] .connection-candidates:not([hidden]) [data-candidate="free"]:not(:disabled)',
			),
		).toBeNull();
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);
		expect(
			s.container.querySelector(
				'[data-side="right"] .connection-candidates:not([hidden]) [data-candidate="free"]:not(:disabled)',
			),
		).toBeNull();
		await redraw();
	}
	expect(document.activeElement).toBe(input);
	expect(input.getAttribute("aria-expanded")).toBe("true");
	expect(
		s.container.querySelector('[data-side="right"] [data-candidate="free"]'),
	).toBeNull();
});

it.each([
	"deleteConnector",
	"toggleFeedback",
] as const)("restores the operated side after %s", async (action) => {
	const s = await setup("a >> p -> b\nc >> p\n");
	s.container
		.querySelector<HTMLButtonElement>('[data-side="left"] [data-edge]')!
		.click();
	s.container
		.querySelector<HTMLButtonElement>(
			action === "deleteConnector"
				? "[data-delete-edge]"
				: "[data-toggle-feedback]",
		)!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	const result = previewEdits.applyPreviewEdit(s.source, request);
	if (!result.ok) throw new Error(result.message);
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(result.source), null, () => null).message,
	);
	expect(document.activeElement).toBe(
		s.container.querySelector('[data-side="left"] [data-edge]'),
	);
	expect(
		document
			.activeElement!.closest(".connection-row")!
			.querySelector("[data-neighbor]")!
			.getAttribute("data-neighbor"),
	).toBe(action === "deleteConnector" ? "c" : "a");
	expect(
		s.container.querySelector('[role="combobox"][aria-expanded="true"]'),
	).toBeNull();
});
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
	postMessage.mockClear();
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

it("selects existing candidates with Arrow and Enter while keeping real focus in the input", async () => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="left"] input',
	)!;
	input.focus();
	input.value = "free";
	input.dispatchEvent(new Event("input"));
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	expect(
		s.postMessage.mock.calls.filter(
			([message]) => message.type === "addConnector",
		),
	).toHaveLength(0);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	const candidate = s.container.querySelector<HTMLButtonElement>(
		'[data-candidate="free"]',
	)!;
	expect(document.activeElement).toBe(input);
	expect(input.getAttribute("aria-activedescendant")).toBe(candidate.id);
	expect(candidate.getAttribute("aria-selected")).toBe("true");
	expect(candidate.tabIndex).toBe(-1);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
	expect(s.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({
			type: "addConnector",
			otherId: "free",
			create: false,
		}),
	);
	expect(document.activeElement).toBe(input);
	expect(input.hasAttribute("aria-activedescendant")).toBe(false);
	expect(input.getAttribute("aria-expanded")).toBe("false");
});

it("dismisses the edge menu before resize and keeps a visible return target", async () => {
	const s = await setup();
	const edge = s.container.querySelector<HTMLButtonElement>(
		'[data-side="left"] [data-edge]',
	)!;
	edge.click();
	window.dispatchEvent(new Event("resize"));
	expect(
		s.container.querySelector<HTMLElement>(".connection-menu")!.hidden,
	).toBe(true);
	expect(document.activeElement).toBe(edge);
	expectPanelFocus(s.container);
	edge.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
});

it("moves focus to a stable control only when redraw removes the current control", async () => {
	const s = await setup();
	s.container
		.querySelector<HTMLButtonElement>('[data-side="left"] [data-edge]')!
		.click();
	await s.preview.receive(
		prepareDocument(analyzeSnapshot(`${s.source}# changed\n`), null, () => null)
			.message,
	);
	expectPanelFocus(s.container);
	expect(
		s.container.querySelector<HTMLElement>(".connection-menu")!.hidden,
	).toBe(true);
	expect(document.activeElement).toBe(
		s.container.querySelector('[data-side="left"] [data-edge]'),
	);
	expect(
		s.container.querySelector('[aria-expanded="true"][role="combobox"]'),
	).toBeNull();
});

it("closes the panel and returns to a visible preview control when the center disappears", async () => {
	const s = await setup();
	s.container.querySelector<HTMLButtonElement>("#create-definition")!.focus();
	await s.preview.receive(
		prepareDocument(analyzeSnapshot("x >> q\n"), null, () => null).message,
	);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
	expect(
		s.container
			.querySelector("#node-actions-toggle")!
			.getAttribute("aria-expanded"),
	).toBe("false");
	expect(document.activeElement).toBe(
		s.container.querySelector("#preview-help-toggle"),
	);
});

it.each([
	true,
	false,
])("only returns preview focus on error if it owned focus (inside=%s)", async (inside) => {
	const s = await setup();
	const elsewhere = document.createElement("button");
	s.container.after(elsewhere);
	try {
		if (inside)
			s.container
				.querySelector<HTMLButtonElement>("#create-definition")!
				.focus();
		else elsewhere.focus();
		await s.preview.receive({ type: "error", message: "Invalid source" });
		expect(document.activeElement).toBe(
			inside ? s.container.querySelector("#preview-error") : elsewhere,
		);
		expect(document.activeElement!.closest("[hidden]")).toBeNull();
	} finally {
		elsewhere.remove();
	}
});

it.each([
	true,
	false,
])("does not move focus on a late edit response (ok=%s)", async (ok) => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.focus();
	input.value = "fresh";
	input.dispatchEvent(new Event("input"));
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	const elsewhere = document.createElement("button");
	s.container.after(elsewhere);
	try {
		elsewhere.focus();
		await s.preview.receive({ type: "editResult", request, ok });
		expect(document.activeElement).toBe(elsewhere);
	} finally {
		elsewhere.remove();
	}
});

it.each([
	"candidates",
	"edge",
])("refreshes the %s opened while a request is pending without moving focus", async (kind) => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	input.focus();
	input.value = "fresh";
	input.dispatchEvent(new Event("input"));
	s.container
		.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
		.click();
	const request = s.postMessage.mock.calls.at(-1)![0];
	if (kind === "candidates") {
		input.value = "free";
		input.dispatchEvent(new Event("input"));
	} else
		s.container
			.querySelector<HTMLButtonElement>('[data-side="left"] [data-edge]')!
			.click();
	const selector =
		kind === "candidates"
			? '[data-side="right"] [data-candidate="free"]'
			: "[data-delete-edge]";
	expect(s.container.querySelector<HTMLButtonElement>(selector)!.disabled).toBe(
		true,
	);
	const focused = document.activeElement;
	await s.preview.receive({
		type: "editResult",
		request,
		ok: false,
		message: "Rejected",
	});
	expect(s.container.querySelector<HTMLButtonElement>(selector)!.disabled).toBe(
		false,
	);
	expect(document.activeElement).toBe(focused);
	expect(input.value).toBe(kind === "candidates" ? "free" : "fresh");
});

it("keeps two identical requests distinct after closing and reopening the panel", async () => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	const send = () => {
		input.focus();
		input.value = "fresh";
		input.dispatchEvent(new Event("input"));
		s.container
			.querySelector<HTMLButtonElement>('[data-side="right"] [data-create]')!
			.click();
		return s.postMessage.mock.calls.at(-1)![0];
	};
	const first = send();
	s.container.querySelector<HTMLButtonElement>("#node-actions-close")!.click();
	s.container.querySelector<HTMLButtonElement>("#node-actions-toggle")!.click();
	send();
	expect(
		s.postMessage.mock.calls.filter(
			([message]) => message.type === "addConnector",
		),
	).toHaveLength(1);
	await s.preview.receive({ type: "editResult", request: first, ok: false });
	const second = send();
	expect(second.requestId).not.toBe(first.requestId);
	await s.preview.receive({
		type: "editResult",
		request: first,
		ok: false,
		message: "Old request refused",
	});
	expect(s.container.querySelector("#node-actions-error")!.textContent).toBe(
		"",
	);
	expect(input.value).toBe("fresh");
	await s.preview.receive({ type: "editResult", request: second, ok: true });
	expect(input.value).toBe("");
});

it.each([
	true,
	false,
])("keeps a pending edit locked across neighbor navigation (ok=%s)", async (ok) => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		'[data-side="right"] input',
	)!;
	const create = s.container.querySelector<HTMLButtonElement>(
		'[data-side="right"] [data-create]',
	)!;
	const send = () => {
		input.value = "fresh";
		input.dispatchEvent(new Event("input"));
		create.click();
	};
	send();
	const request = s.postMessage.mock.calls.at(-1)![0];
	s.container.querySelector<HTMLButtonElement>('[data-neighbor="b"]')!.click();
	send();
	expect(create.disabled).toBe(true);
	expect(
		s.postMessage.mock.calls.filter(
			([message]) => message.type === "addConnector",
		),
	).toHaveLength(1);
	await s.preview.receive({ type: "editResult", request, ok });
	expect(input.value).toBe("fresh");
	expect(create.disabled).toBe(false);
	expectPanelFocus(s.container);
	create.click();
	expect(s.postMessage.mock.calls.at(-1)![0]).toMatchObject({
		type: "addConnector",
		nodeId: "b",
		otherId: "fresh",
	});
	expect(
		s.postMessage.mock.calls.filter(
			([message]) => message.type === "addConnector",
		),
	).toHaveLength(2);
});

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
	expect(document.activeElement).toBe(input);
	expect(input.getAttribute("aria-activedescendant")).toBe(candidate.id);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
	);
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(document.activeElement).toBe(input);
	expect(input.getAttribute("aria-expanded")).toBe("false");
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		true,
	);
	expect(input.value).toBe("free");
	s.container.querySelector<HTMLButtonElement>("#node-actions-toggle")!.click();
	input.value = "free";
	input.dispatchEvent(new Event("input"));
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

it.each(
	["left", "right"].flatMap((side) =>
		["input", "candidate", "resize"].map((origin) => ({ side, origin })),
	),
)("closes candidates before Connections from $side after $origin", async ({
	side,
	origin,
}) => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		`[data-side="${side}"] input`,
	)!;
	const panel = s.container.querySelector<HTMLElement>("#node-actions")!;
	input.focus();
	input.value = "free";
	input.dispatchEvent(new Event("input"));
	if (origin === "candidate")
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);
	if (origin === "resize") window.dispatchEvent(new Event("resize"));
	else {
		document.activeElement!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(panel.hidden).toBe(false);
		expect(document.activeElement).toBe(input);
	}
	expect(input.getAttribute("aria-expanded")).toBe("false");
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);
	expect(panel.hidden).toBe(true);
	expect(document.activeElement).toBe(
		s.container.querySelector("#node-actions-toggle"),
	);
	expect(input.value).toBe("free");
	expect(
		s.postMessage.mock.calls.filter(([message]) => message.type !== "ready"),
	).toHaveLength(0);
});

it.each([
	"left",
	"right",
])("leaves composing Escape in the %s input to the IME", async (side) => {
	const s = await setup();
	const input = s.container.querySelector<HTMLInputElement>(
		`[data-side="${side}"] input`,
	)!;
	input.focus();
	input.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "Escape",
			bubbles: true,
			isComposing: true,
		}),
	);
	expect(s.container.querySelector<HTMLElement>("#node-actions")!.hidden).toBe(
		false,
	);
	expect(input.getAttribute("aria-expanded")).toBe("true");
	expect(document.activeElement).toBe(input);
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
	expect(s.postMessage).toHaveBeenLastCalledWith({
		type: "nodeClick",
		nodeId: "a",
		preserveFocus: true,
	});
	s.postMessage.mockClear();
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
			'[aria-label="feedback connection from b, artifact to p, process. Connection actions"]',
		)!
		.click();
	const menu = s.container.querySelector<HTMLElement>(".connection-menu")!;
	expect(menu.querySelector("[data-toggle-feedback]")).toBeNull();
	expect(menu.querySelectorAll("[role=menuitem]")).toHaveLength(1);
	expect(menu.textContent).toBe("Delete");
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
		request: { ...request, requestId: undefined },
		ok: true,
	});
	expect(right.value).toBe("right_new");
	await s.preview.receive({
		type: "editResult",
		request: { ...request, requestId: "unrelated" },
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
	expect(s.container.querySelector("[data-toggle-feedback]")).toBeNull();
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

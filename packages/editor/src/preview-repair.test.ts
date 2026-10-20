// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountPreview } from "./preview.js";

describe("preview error repair", () => {
	it.each([
		"feedback",
		"input",
	] as const)("posts an identified %s deletion and handles pending and failed replies", async (kind) => {
		const container = document.createElement("div");
		document.body.append(container);
		const postMessage = vi.fn();
		const preview = mountPreview(container, {
			postMessage,
			renderDot: async () => "<svg/>",
		});
		const repair = {
			source: "a >> p -> b\na >>? p\n",
			artifact: "a",
			process: "p",
		};
		try {
			await preview.receive({ type: "error", message: "Conflict", repair });
			const buttons = [
				...container.querySelectorAll<HTMLButtonElement>(
					"#preview-error button",
				),
			];
			expect(buttons.map((b) => b.textContent)).toEqual([
				"Keep normal input",
				"Keep feedback",
			]);
			expect(buttons.every((b) => !b.disabled && b.tabIndex === 0)).toBe(true);
			const button = buttons[kind === "feedback" ? 0 : 1]!;
			button.focus();
			expect(document.activeElement).toBe(button);
			button.click();
			const request = postMessage.mock.calls.at(-1)![0];
			expect(request).toEqual({
				type: "deleteConnector",
				nodeId: "a",
				...repair,
				kind,
				repair: true,
				requestId: expect.any(String),
			});
			expect(buttons.every((b) => b.disabled)).toBe(true);
			await preview.receive({
				type: "editResult",
				request: { ...request, requestId: "other" },
				ok: false,
				message: "Unrelated",
			});
			expect(buttons.every((b) => b.disabled)).toBe(true);
			await preview.receive({
				type: "editResult",
				request,
				ok: false,
				message: "Source changed",
			});
			expect(container.querySelector("#preview-error")!.textContent).toContain(
				"Source changed",
			);
			expect(buttons.every((b) => !b.disabled)).toBe(true);
			button.click();
			const retry = postMessage.mock.calls.at(-1)![0];
			expect(retry.requestId).not.toBe(request.requestId);
			await preview.receive({ type: "editResult", request: retry, ok: false });
			expect(container.querySelector("#preview-error")!.textContent).toContain(
				"The edit could not be applied.",
			);
			button.click();
			await preview.receive({
				type: "editResult",
				request: postMessage.mock.calls.at(-1)![0],
				ok: true,
			});
			expect(buttons.every((b) => b.disabled)).toBe(true);
			await preview.receive({ type: "error", message: "Parse failed" });
			expect(container.querySelector("#preview-error")!.textContent).toBe(
				"Parse failed",
			);
			expect(container.querySelectorAll("#preview-error button")).toHaveLength(
				0,
			);
			await preview.receive({ type: "error", message: "Conflict", repair });
			container
				.querySelector<HTMLButtonElement>("#preview-error button")!
				.click();
			const replaced = postMessage.mock.calls.at(-1)![0];
			await preview.receive({ type: "render", dot: "a" });
			expect(container.querySelectorAll("#preview-error button")).toHaveLength(
				0,
			);
			await preview.receive({
				type: "editResult",
				request: replaced,
				ok: false,
				message: "Stale",
			});
			expect(container.querySelector("#preview-error")!.textContent).toBe("");
		} finally {
			preview.dispose();
			container.remove();
		}
	});
});

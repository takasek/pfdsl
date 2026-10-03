import { analyze, diffGraphs } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import type { MessageToWebview } from "./messages.js";
import { PreviewController } from "./preview-controller.js";

const first = diffGraphs(
	analyze("a >> p -> b").graph,
	analyze("a >> p -> c").graph,
);
const latest = diffGraphs(
	analyze("a >> p -> b").graph,
	analyze("a >> p -> d").graph,
);

function setup(renderType: "render" | "error" = "render") {
	const messages: MessageToWebview[] = [];
	const controller = new PreviewController(
		() =>
			messages.push(
				renderType === "render"
					? { type: "render", dot: "digraph {}" }
					: { type: "error", message: "invalid document" },
			),
		(message) => {
			messages.push(message);
		},
	);
	return { controller, messages };
}

describe("PreviewController", () => {
	it("retains the initial focus until ready and consumes it on the first update", () => {
		const focuses: (string | undefined)[] = [];
		const controller = new PreviewController(
			(focus) => {
				focuses.push(focus);
			},
			() => {},
			"a",
		);
		controller.update();
		expect(focuses).toEqual([]);
		controller.markReady();
		controller.update();
		expect(focuses).toEqual(["a", undefined]);
	});
	it("waits for ready and sends only the latest diff after rendering", () => {
		const { controller, messages } = setup();
		controller.postDiff(first);
		controller.update();
		controller.postDiff(latest);
		expect(messages).toEqual([]);
		controller.markReady();
		expect(messages).toEqual([
			{ type: "render", dot: "digraph {}" },
			{ type: "diff", report: latest },
		]);
		controller.update();
		controller.markReady();
		expect(messages.map((message) => message.type)).toEqual([
			"render",
			"diff",
			"render",
			"render",
		]);
	});

	it("lets clear replace a pending diff, including after an error update", () => {
		const { controller, messages } = setup("error");
		controller.postDiff(first);
		controller.postDiff(null);
		controller.markReady();
		controller.update();
		expect(messages).toEqual([
			{ type: "error", message: "invalid document" },
			{ type: "clearDiff" },
			{ type: "error", message: "invalid document" },
		]);
	});

	it("lets a diff replace a pending clear", () => {
		const { controller, messages } = setup();
		controller.postDiff(null);
		controller.postDiff(latest);
		controller.markReady();
		expect(messages[1]).toEqual({ type: "diff", report: latest });
		expect(messages).toHaveLength(2);
	});

	it("sends no diff notification when none was requested", () => {
		const { controller, messages } = setup();
		controller.markReady();
		expect(messages.map((message) => message.type)).toEqual(["render"]);
	});

	it("sends diff and clear immediately after ready", () => {
		const { controller, messages } = setup();
		controller.markReady();
		controller.postDiff(first);
		controller.postDiff(null);
		expect(messages.slice(1)).toEqual([
			{ type: "diff", report: first },
			{ type: "clearDiff" },
		]);
	});

	it("discards pending notifications on disposal and ignores late callbacks", () => {
		const { controller, messages } = setup();
		controller.postDiff(first);
		controller.dispose();
		controller.markReady();
		controller.update();
		controller.postDiff(latest);
		controller.postDiff(null);
		expect(messages).toEqual([]);
	});

	it("ignores diff requests after disposing a ready controller", () => {
		const { controller, messages } = setup();
		controller.markReady();
		controller.dispose();
		controller.postDiff(first);
		controller.update();
		expect(messages).toHaveLength(1);
	});
});

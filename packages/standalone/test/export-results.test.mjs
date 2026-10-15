import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createExportResults } from "../src/export-results.ts";

test("application export batches survive tab removal and are dismissed independently", () => {
	const dom = new JSDOM("<main><article id='tab'></article></main>");
	const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
	globalThis.document = dom.window.document;
	try {
		const show = createExportResults(document.querySelector("main"), () => {});
		const result = [
			{
				format: "svg",
				status: "saved",
				savedPath: "/chosen/a.svg",
				warnings: [],
			},
		];
		document.querySelector("#tab").remove();
		show("Closed source", 1, result);
		show("Second source", 3, result);
		const panel = document.querySelector(".export-results");
		assert.equal(panel.querySelectorAll("h2").length, 2);
		assert.match(panel.textContent, /Closed source/);
		panel.querySelector("button").click();
		assert.equal(panel.querySelectorAll("h2").length, 1);
		panel.querySelector("button").click();
		assert.equal(document.querySelector(".export-results"), null);
		show("Third source", 4, result);
		assert.match(
			document.querySelector(".export-results").textContent,
			/Third source/,
		);
	} finally {
		if (previous) Object.defineProperty(globalThis, "document", previous);
		else delete globalThis.document;
		dom.window.close();
	}
});

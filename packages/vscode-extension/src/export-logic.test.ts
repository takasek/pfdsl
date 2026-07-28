import { describe, expect, it } from "vitest";
import {
	exportAllOutcome,
	exportStem,
	skippedBinaryFormats,
} from "./export-logic.js";

describe("exportStem", () => {
	it("drops the extension the save dialog appended", () => {
		expect(exportStem("/tmp/flow.dot")).toBe("/tmp/flow");
	});

	it("drops only the last extension", () => {
		expect(exportStem("/tmp/flow.v2.dot")).toBe("/tmp/flow.v2");
	});

	it("leaves a path with no extension alone", () => {
		expect(exportStem("/tmp/flow")).toBe("/tmp/flow");
	});

	it("does not eat a dot that belongs to a directory name", () => {
		expect(exportStem("/tmp/v1.2/flow")).toBe("/tmp/v1.2/flow");
	});

	it("keeps a leading dot in a dotfile name", () => {
		expect(exportStem("/tmp/.pfdslrc")).toBe("/tmp/.pfdslrc");
	});
});

describe("skippedBinaryFormats", () => {
	const ok = { status: "fulfilled", value: new Uint8Array() } as const;
	const bad = {
		status: "rejected",
		reason: new Error("no puppeteer"),
	} as const;

	it("is empty when both renders succeeded", () => {
		expect(skippedBinaryFormats(ok, ok)).toEqual([]);
	});

	it("names PDF when only that one failed", () => {
		expect(skippedBinaryFormats(bad, ok)).toEqual(["PDF"]);
	});

	it("names PNG when only that one failed", () => {
		expect(skippedBinaryFormats(ok, bad)).toEqual(["PNG"]);
	});

	it("names both, in the order they are offered", () => {
		expect(skippedBinaryFormats(bad, bad)).toEqual(["PDF", "PNG"]);
	});
});

describe("exportAllOutcome", () => {
	it("lists every extension when nothing was skipped", () => {
		expect(exportAllOutcome("/tmp/flow", [])).toEqual({
			kind: "info",
			message: "Exported: /tmp/flow.dot / .svg / .pdf / .png / .tsv",
		});
	});

	it("warns, and says why, when a format was skipped", () => {
		const outcome = exportAllOutcome("/tmp/flow", ["PDF"]);
		expect(outcome.kind).toBe("warning");
		expect(outcome.message).toContain("PDF skipped");
		expect(outcome.message).toContain("puppeteer required");
	});

	it("still reports the export as done, since dot/svg/tsv were written", () => {
		expect(exportAllOutcome("/tmp/flow", ["PDF", "PNG"]).message).toContain(
			"Exported: /tmp/flow.*",
		);
	});
});

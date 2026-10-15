import { describe, expect, it } from "vitest";
import { exportStem } from "./export-logic.js";

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

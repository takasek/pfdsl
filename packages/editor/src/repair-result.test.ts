import { describe, expect, it } from "vitest";
import { repairResultMessage } from "./index.js";

describe("repair result notice", () => {
	const before = "a >> p -> b\na >>? p\n";
	it("reports newly introduced W008 after removing normal input", () => {
		expect(
			repairResultMessage(
				{
					type: "deleteConnector",
					nodeId: "a",
					source: before,
					artifact: "a",
					process: "p",
					kind: "input",
				},
				before,
				"p -> b\na >>? p\n",
			),
		).toBe(
			"Removed the normal input 'a' >> 'p'. W008: Process 'p' has no normal input; feedback edges are its only inputs",
		);
	});
	it("reports only removal when feedback removal introduces no diagnostic", () => {
		expect(
			repairResultMessage(
				{
					type: "deleteConnector",
					nodeId: "a",
					source: before,
					artifact: "a",
					process: "p",
					kind: "feedback",
				},
				before,
				"a >> p -> b\n",
			),
		).toBe("Removed the feedback 'a' >>? 'p'.");
	});
	it("uses authored IDs and omits existing diagnostics", () => {
		const source = "'odd a' >> 'p-1' -> b\n";
		expect(
			repairResultMessage(
				{
					type: "deleteConnector",
					nodeId: "odd a",
					source,
					artifact: "odd a",
					process: "p-1",
					kind: "input",
				},
				source,
				source,
			),
		).toBe("Removed the normal input 'odd a' >> 'p-1'.");
	});
	it("compares both code and message and appends every new diagnostic in order", () => {
		const source = "p -> b\na >>? p\n";
		expect(
			repairResultMessage(
				{
					type: "deleteConnector",
					nodeId: "a",
					source,
					artifact: "a",
					process: "p",
					kind: "input",
				},
				source,
				`${source}q -> c\nd >>? q\nr -> e\nf >>? r\n`,
			),
		).toBe(
			"Removed the normal input 'a' >> 'p'. W008: Process 'q' has no normal input; feedback edges are its only inputs W008: Process 'r' has no normal input; feedback edges are its only inputs",
		);
	});
});

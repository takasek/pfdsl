import { analyze } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	blockingDiagnosticMessage,
	idsOfStatement,
	positionOfNodeId,
} from "./preview-logic.js";

/** ids a single-statement source mentions, in the order the walker yields them. */
function idsOf(src: string): string[] {
	const stmt = analyze(src).document.statements[0];
	if (!stmt) throw new Error(`no statement parsed from ${JSON.stringify(src)}`);
	return idsOfStatement(stmt).map((id) => id.value);
}

describe("idsOfStatement", () => {
	it("walks a chain head, then each segment's process and outputs", () => {
		expect(idsOf("A >> P -> B")).toEqual(["A", "P", "B"]);
	});

	it("keeps walking a multi-segment chain", () => {
		expect(idsOf("A >> P -> B >> Q -> C")).toEqual(["A", "P", "B", "Q", "C"]);
	});

	it("includes every member of a bracketed set on both sides", () => {
		expect(idsOf("[a, b] >> P -> [x, y]")).toEqual(["a", "b", "P", "x", "y"]);
	});

	it("handles a chain segment with no output", () => {
		expect(idsOf("A >> P -> B >> Q")).toEqual(["A", "P", "B", "Q"]);
	});

	it("yields artifact before process for an input edge", () => {
		expect(idsOf("A >> P")).toEqual(["A", "P"]);
	});

	it("yields artifact before process for a feedback edge", () => {
		expect(idsOf("A >>? P")).toEqual(["A", "P"]);
	});

	it("yields process before artifact for an output edge", () => {
		expect(idsOf("P -> A")).toEqual(["P", "A"]);
	});

	it("yields the single id of a node declaration", () => {
		expect(idsOf("lonely")).toEqual(["lonely"]);
	});
});

describe("blockingDiagnosticMessage", () => {
	const at = {
		start: { line: 1, column: 1, offset: 0 },
		end: { line: 1, column: 2, offset: 1 },
	};

	it("is undefined when nothing is wrong", () => {
		expect(blockingDiagnosticMessage([])).toBeUndefined();
	});

	it("is undefined for warnings, which still describe a renderable graph", () => {
		expect(
			blockingDiagnosticMessage([
				{
					severity: "warning",
					code: "W002",
					message: "no criteria",
					range: at,
				},
			]),
		).toBeUndefined();
	});

	it("names the first error with its code", () => {
		expect(
			blockingDiagnosticMessage([
				{
					severity: "warning",
					code: "W002",
					message: "no criteria",
					range: at,
				},
				{
					severity: "error",
					code: "V001",
					message: "two generators",
					range: at,
				},
				{ severity: "error", code: "V002", message: "no inputs", range: at },
			]),
		).toBe("V001: two generators");
	});
});

describe("positionOfNodeId", () => {
	const statementsOf = (src: string) => analyze(src).document.statements;

	it("finds an id in the body, converted to a zero-origin position", () => {
		expect(
			positionOfNodeId(statementsOf("req >> design -> spec\n"), "design"),
		).toEqual({
			line: 0,
			column: 7,
		});
	});

	it("returns the first mention when an id appears more than once", () => {
		const statements = statementsOf(
			"req >> design -> spec\nspec >> impl -> code\n",
		);
		expect(positionOfNodeId(statements, "spec")).toEqual({
			line: 0,
			column: 17,
		});
	});

	it("is undefined for an id the body never mentions", () => {
		expect(
			positionOfNodeId(statementsOf("req >> design -> spec\n"), "ghost"),
		).toBeUndefined();
	});
});

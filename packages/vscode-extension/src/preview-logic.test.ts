import { analyze } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	allIdsOfDocument,
	blockingDiagnosticMessage,
	buildHtml,
	idsOfStatement,
	nodeIdAtCursor,
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

describe("allIdsOfDocument", () => {
	it("collects ids across every statement", () => {
		const result = analyze("A >> P -> B\nC >> Q -> D\nlonely\n");
		expect(allIdsOfDocument(result)).toEqual(
			new Set(["A", "P", "B", "C", "Q", "D", "lonely"]),
		);
	});

	it("reports a repeated id once", () => {
		const result = analyze("A >> P -> B\nB >> Q -> C\n");
		expect(allIdsOfDocument(result).size).toBe(5);
	});

	it("is empty for a document with no statements", () => {
		expect(allIdsOfDocument(analyze(""))).toEqual(new Set());
	});
});

describe("nodeIdAtCursor", () => {
	// "A >> P -> B" — vscode is 0-indexed, so line 0 / character 0 is 'A'.
	const result = analyze("A >> P -> B");

	it("finds the id the cursor sits on at its first character", () => {
		expect(nodeIdAtCursor(result, { line: 0, character: 0 })).toBe("A");
	});

	it("finds an id in the middle of the line", () => {
		expect(nodeIdAtCursor(result, { line: 0, character: 5 })).toBe("P");
	});

	it("is undefined when the cursor is on an operator, not an id", () => {
		expect(nodeIdAtCursor(result, { line: 0, character: 2 })).toBeUndefined();
	});

	it("is undefined on a line that has no statement", () => {
		expect(nodeIdAtCursor(result, { line: 5, character: 0 })).toBeUndefined();
	});

	it("finds an id on a later line, translating the 0/1-indexing", () => {
		const multi = analyze("A >> P -> B\nC >> Q -> D");
		expect(nodeIdAtCursor(multi, { line: 1, character: 0 })).toBe("C");
	});

	it("matches a multi-character id anywhere within it", () => {
		const wide = analyze("requirement >> design -> spec");
		expect(nodeIdAtCursor(wide, { line: 0, character: 5 })).toBe("requirement");
		expect(nodeIdAtCursor(wide, { line: 0, character: 15 })).toBe("design");
	});
});

describe("buildHtml", () => {
	const html = buildHtml(
		"https://example/webview.js",
		"https://cdn.example",
		false,
	);

	it("embeds the script URI as a module script", () => {
		expect(html).toContain(
			'<script type="module" src="https://example/webview.js"></script>',
		);
	});

	// The webview runs with scripts enabled, so the policy is what keeps a
	// crafted .pfdsl from reaching anything but our own bundle.
	describe("content security policy", () => {
		const csp =
			html.match(
				/http-equiv="Content-Security-Policy" content="([^"]+)"/,
			)?.[1] ?? "";

		it("denies everything by default", () => {
			expect(csp).toContain("default-src 'none'");
		});

		it("allows scripts only from the webview's own cspSource", () => {
			expect(csp).toContain(
				"script-src https://cdn.example 'wasm-unsafe-eval'",
			);
		});

		it("allows connections only to that same source", () => {
			expect(csp).toContain("connect-src https://cdn.example");
		});

		it("allows images only as inline data, never fetched from a host", () => {
			expect(csp).toContain("img-src data:");
			expect(csp).not.toMatch(/img-src[^;]*https?:\/\//);
		});
	});

	it("declares the mount points the webview script attaches to", () => {
		for (const id of ["root", "inner", "tooltip", "diff-panel", "minimap"]) {
			expect(html).toContain(`id="${id}"`);
		}
	});

	it("exposes the debug flag to the webview", () => {
		expect(buildHtml("s", "c", true)).toContain(
			"window.__PFDSL_DEBUG__ = true;",
		);
		expect(buildHtml("s", "c", false)).toContain(
			"window.__PFDSL_DEBUG__ = false;",
		);
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

import type { Frontmatter } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	buildXlabel,
	calcMinWidth,
	darkenHex,
	quote,
	resolveStyleAttrs,
} from "./node-attrs.js";

// These helpers were only ever reached through exportDot, where a DOT string
// has to be pattern-matched to see what they returned. Testing them directly
// reaches the branches a whole-graph assertion cannot single out — the 3-digit
// hex form, the non-colour input, the minimum-width floor.

describe("quote", () => {
	it("wraps a plain string in double quotes", () => {
		expect(quote("plain")).toBe('"plain"');
	});

	it("escapes a backslash before anything else, so it is not doubled twice", () => {
		expect(quote("a\\b")).toBe('"a\\\\b"');
	});

	it("escapes an embedded double quote", () => {
		expect(quote('say "hi"')).toBe('"say \\"hi\\""');
	});

	it("turns a newline into the DOT escape rather than a raw break", () => {
		expect(quote("a\nb")).toBe('"a\\nb"');
	});

	it("quotes the empty string", () => {
		expect(quote("")).toBe('""');
	});
});

describe("calcMinWidth", () => {
	it("is undefined for a label with no CJK, leaving graphviz to size it", () => {
		expect(calcMinWidth("plain ascii")).toBeUndefined();
	});

	it("returns the 0.75 floor for a short CJK label", () => {
		// 2 units * 0.1 + 0.3 = 0.5, below the floor.
		expect(calcMinWidth("設")).toBe(0.75);
	});

	it("grows with the widest line, counting CJK as two units", () => {
		// 8 CJK chars on the longest line → 16 * 0.1 + 0.3 = 1.9
		expect(calcMinWidth("短\nもっと長い行です")).toBeCloseTo(1.9, 10);
	});

	it("measures the widest line, not the last one", () => {
		expect(calcMinWidth("長い行がここにあります\n短")).toBeGreaterThan(0.75);
	});

	it("counts ASCII inside a CJK label as one unit, half a CJK character", () => {
		// "あいうえお" is 10 units; "あbcde" is 2 + 4 = 6, though both are 5 chars.
		expect(calcMinWidth("あいうえお")).toBeCloseTo(1.3, 10);
		expect(calcMinWidth("あbcde")).toBeCloseTo(0.9, 10);
	});
});

describe("darkenHex", () => {
	it("scales each channel of a 6-digit hex", () => {
		expect(darkenHex("#4CAF50")).toBe("#357a38");
	});

	it("expands a 3-digit hex before scaling", () => {
		// #abc → aa/bb/cc, each * 0.7
		expect(darkenHex("#abc")).toBe("#77838f");
	});

	it("pads a channel that darkens to a single hex digit", () => {
		expect(darkenHex("#000")).toBe("#000000");
	});

	it("honours an explicit factor", () => {
		expect(darkenHex("#ffffff", 0.5)).toBe("#808080");
	});

	it("is undefined for a named colour it cannot parse", () => {
		expect(darkenHex("lightblue")).toBeUndefined();
	});

	it("is undefined for a hex of the wrong length", () => {
		expect(darkenHex("#12345")).toBeUndefined();
	});
});

describe("buildXlabel", () => {
	it("is undefined without frontmatter", () => {
		expect(buildXlabel("a", "artifact", null)).toBeUndefined();
	});

	it("is undefined when the node has neither status nor tags", () => {
		const fm: Frontmatter = { artifact: { a: { label: "A" } } };
		expect(buildXlabel("a", "artifact", fm)).toBeUndefined();
	});

	it("shows an artifact's status", () => {
		const fm: Frontmatter = { artifact: { a: { status: "todo" } } };
		expect(buildXlabel("a", "artifact", fm)).toBe("todo");
	});

	it("puts status before tags, comma-separated", () => {
		const fm: Frontmatter = {
			artifact: { a: { status: "wip", tags: ["x", "y"] } },
		};
		expect(buildXlabel("a", "artifact", fm)).toBe("wip, x, y");
	});

	it("shows only tags for a process, since status is artifact-only", () => {
		const fm = {
			process: { p: { tags: ["slow"], status: "done" } },
		} as unknown as Frontmatter;
		expect(buildXlabel("p", "process", fm)).toBe("slow");
	});

	it("is undefined for a group, which carries neither", () => {
		const fm: Frontmatter = { group: { g: { label: "G" } } };
		expect(buildXlabel("g", "group", fm)).toBeUndefined();
	});
});

describe("resolveStyleAttrs", () => {
	it("is empty without frontmatter", () => {
		expect(resolveStyleAttrs("a", "artifact", null)).toEqual({});
	});

	it("is empty for a group, whose styling comes from the cluster instead", () => {
		const fm: Frontmatter = {
			group: { g: { label: "G" } },
			statusStyles: { done: { fillcolor: "green" } },
		};
		expect(resolveStyleAttrs("g", "group", fm)).toEqual({});
	});

	it("applies a tag's style", () => {
		const fm: Frontmatter = {
			artifact: { a: { tags: ["hot"] } },
			tag: { hot: { style: { fillcolor: "red" } } },
		};
		expect(resolveStyleAttrs("a", "artifact", fm).fillcolor).toBe("red");
	});

	it("lets the first tag win a conflicting attribute", () => {
		const fm: Frontmatter = {
			artifact: { a: { tags: ["first", "second"] } },
			tag: {
				first: { style: { fillcolor: "red" } },
				second: { style: { fillcolor: "blue" } },
			},
		};
		expect(resolveStyleAttrs("a", "artifact", fm).fillcolor).toBe("red");
	});

	it("merges non-conflicting attributes across tags", () => {
		const fm: Frontmatter = {
			artifact: { a: { tags: ["first", "second"] } },
			tag: {
				first: { style: { fillcolor: "red" } },
				second: { style: { color: "blue" } },
			},
		};
		expect(resolveStyleAttrs("a", "artifact", fm)).toMatchObject({
			fillcolor: "red",
			color: "blue",
		});
	});

	it("lets status override a tag on the same attribute", () => {
		const fm: Frontmatter = {
			artifact: { a: { tags: ["hot"], status: "done" } },
			tag: { hot: { style: { fillcolor: "red" } } },
			statusStyles: { done: { fillcolor: "green" } },
		};
		expect(resolveStyleAttrs("a", "artifact", fm).fillcolor).toBe("green");
	});

	it("ignores a tag that has no entry under tag:", () => {
		const fm: Frontmatter = { artifact: { a: { tags: ["undeclared"] } } };
		expect(resolveStyleAttrs("a", "artifact", fm)).toEqual({});
	});

	it("does not apply artifact statusStyles to a process", () => {
		const fm = {
			process: { p: { status: "done" } },
			statusStyles: { done: { fillcolor: "green" } },
		} as unknown as Frontmatter;
		expect(resolveStyleAttrs("p", "process", fm).fillcolor).toBeUndefined();
	});
});

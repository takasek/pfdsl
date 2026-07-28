import type { Frontmatter } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import {
	buildXlabel,
	calcMinWidth,
	darkenHex,
	nodeAttrs,
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

// nodeAttrs is the branchiest function here, and every one of these fields was
// only ever exercised through a docs/samples fixture — a .dot regenerated from
// a sample states no intent, so deleting the sample would silently drop the
// coverage. These name the contract directly (#608).
describe("nodeAttrs", () => {
	/** The tooltip attribute's value, unescaped back into real newlines. */
	function tooltipOf(attrs: string): string | undefined {
		const m = /tooltip="((?:[^"\\]|\\.)*)"/.exec(attrs);
		return m?.[1]?.replace(/\\n/g, "\n").replace(/\\"/g, '"');
	}

	it("lists owner after criteria for an artifact", () => {
		const fm: Frontmatter = {
			artifact: {
				a: { label: "A", criteria: "done when green", owner: "ops" },
			},
		};
		expect(tooltipOf(nodeAttrs("a", "artifact", fm))).toBe(
			"A\ncriteria: done when green\nowner: ops",
		);
	});

	it("lists a process's command and subflow", () => {
		const fm = {
			process: {
				p: { label: "P", command: "make build", subflow: "build.pfdsl" },
			},
		} as unknown as Frontmatter;
		expect(tooltipOf(nodeAttrs("p", "process", fm))).toBe(
			"P\ncommand: make build\nsubflow: build.pfdsl",
		);
	});

	it("gives a process with a subflow a double outline, so a drill-down is visible", () => {
		const fm = {
			process: { p: { subflow: "build.pfdsl" } },
		} as unknown as Frontmatter;
		expect(nodeAttrs("p", "process", fm)).toContain('peripheries="2"');
	});

	it("leaves a process without a subflow single-outlined", () => {
		const fm = { process: { p: { label: "P" } } } as unknown as Frontmatter;
		expect(nodeAttrs("p", "process", fm)).not.toContain("peripheries");
	});

	it("shows an unknown string field, so frontmatter the exporter does not know still reaches the reader", () => {
		const fm = {
			artifact: { a: { label: "A", ticket: "#608" } },
		} as unknown as Frontmatter;
		expect(tooltipOf(nodeAttrs("a", "artifact", fm))).toBe("A\nticket: #608");
	});

	it("joins an unknown string-array field with commas", () => {
		const fm = {
			artifact: { a: { label: "A", reviewers: ["ann", "bo"] } },
		} as unknown as Frontmatter;
		expect(tooltipOf(nodeAttrs("a", "artifact", fm))).toBe(
			"A\nreviewers: ann, bo",
		);
	});

	it("skips an unknown field that is neither a string nor a non-empty string array", () => {
		const fm = {
			artifact: {
				a: { label: "A", criteria: "c", retries: 3, flags: [1, 2], empty: [] },
			},
		} as unknown as Frontmatter;
		// criteria keeps a tooltip in the output at all; nothing else may join it.
		expect(tooltipOf(nodeAttrs("a", "artifact", fm))).toBe("A\ncriteria: c");
	});

	it("omits the tooltip entirely when the label is all there is to say", () => {
		const fm: Frontmatter = { artifact: { a: { label: "A" } } };
		expect(nodeAttrs("a", "artifact", fm)).not.toContain("tooltip=");
	});

	it("skips the fields rendered elsewhere rather than repeating them in the tooltip", () => {
		const fm: Frontmatter = {
			artifact: {
				a: {
					label: "A",
					description: "why",
					status: "wip",
					tags: ["hot"],
					location: "docs/a.md",
				},
			},
		};
		// description leads, status and tags show as colour and xlabel, location
		// is appended last with its own formatting.
		expect(tooltipOf(nodeAttrs("a", "artifact", fm))).toBe(
			"A\n\nwhy\nlocation: docs/a.md",
		);
	});

	it("indents a multi-line value under its own key instead of running it onto one line", () => {
		const fm: Frontmatter = {
			artifact: { a: { label: "A", criteria: "first line\nsecond line" } },
		};
		expect(tooltipOf(nodeAttrs("a", "artifact", fm))).toBe(
			"A\ncriteria:\n  first line\n  second line",
		);
	});
});

import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { rename } from "./rename.js";

/** `rename`'s result for an artifact/process id it is expected to rename. */
function renamed(source: string, oldId: string, newId: string) {
	const r = rename(source, oldId, newId);
	if (!r.ok || r.kind === "group") {
		throw new Error(
			`expected an artifact/process rename, got ${JSON.stringify(r)}`,
		);
	}
	return r;
}

describe("renameId", () => {
	it("renames an artifact in a chain statement, byte-exact", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
  c:
    label: C
process:
  p:
    label: P
  q:
    label: Q
---
a >> p -> b >> q -> c
`;
		const { output, kind } = renamed(src, "b", "bx");
		expect(kind).toBe("artifact");
		expect(output).toBe(`---
artifact:
  a:
    label: A
  bx:
    label: B
  c:
    label: C
process:
  p:
    label: P
  q:
    label: Q
---
a >> p -> bx >> q -> c
`);
	});

	it("renames every id in a set notation ([a, b] >> p), byte-exact", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
---
[a, b] >> p
`;
		const { output } = renamed(src, "a", "ax");
		expect(output).toBe(`---
artifact:
  ax:
    label: A
  b:
    label: B
process:
  p:
    label: P
---
[ax, b] >> p
`);
	});

	it("renames a process across a multi-line continuation chain, byte-exact", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
  c:
    label: C
process:
  p:
    label: P
  q:
    label: Q
---
a >> p -> b
  >> q -> c
`;
		const { output } = renamed(src, "p", "px");
		expect(output).toBe(`---
artifact:
  a:
    label: A
  b:
    label: B
  c:
    label: C
process:
  px:
    label: P
  q:
    label: Q
---
a >> px -> b
  >> q -> c
`);
	});

	it("keeps a trailing same-line comment and an interior comment, byte-exact", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
---
a >> p  # trailing note
  -> b
`;
		const { output } = renamed(src, "a", "ax");
		expect(output).toBe(`---
artifact:
  ax:
    label: A
  b:
    label: B
process:
  p:
    label: P
---
ax >> p  # trailing note
  -> b
`);
	});

	it("renames a feedback (>>?) edge, byte-exact", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
---
a >> p -> b
b >>? p
`;
		const { output } = renamed(src, "b", "bx");
		expect(output).toBe(`---
artifact:
  a:
    label: A
  bx:
    label: B
process:
  p:
    label: P
---
a >> p -> bx
bx >>? p
`);
	});

	it("re-quotes an id needing quoting (contains a space) in every occurrence", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
---
[a, b] >> p
`;
		const { output } = renamed(src, "a", "a new");
		// The frontmatter declaration key's own scalar type (plain, from the
		// original unquoted `a`) is preserved by the CST mutation — a plain
		// key needing no `: ` disambiguation round-trips fine unquoted, the
		// same way an existing plain scalar value would. `formatId` only
		// governs the body's own notation, which does require the quotes
		// (`,`/space are not in `BARE_ID_RE`).
		expect(output).toContain("a new:");
		expect(output).toContain('["a new", b] >> p');
		const { edges } = analyze(output);
		expect(edges).toEqual([
			{ kind: "input", artifact: "a new", process: "p" },
			{ kind: "input", artifact: "b", process: "p" },
		]);
	});

	// The lexer ends a bare id before a `-` that starts `->`, so a bare new id
	// ending in `-` placed right before `>` would lose that dash to an arrow.
	it.each([
		["a>>p -> b", '"x-">>p -> b\n'],
		["a >>p -> b", "x- >>p -> b\n"],
	])("quotes a new id ending in '-' only where the next character is '>' (%s)", (body, expected) => {
		const { output } = renamed(`${body}\n`, "a", "x-");
		expect(output).toBe(expected);
		const after = analyze(output);
		expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(after.nodeKinds.get("x-")).toBe("artifact");
	});

	it("preserves CRLF line endings", () => {
		const src =
			"---\r\nartifact:\r\n  a:\r\n    label: A\r\nprocess:\r\n  p:\r\n    label: P\r\n---\r\na >> p\r\n";
		const { output } = renamed(src, "a", "ax");
		expect(output.replace(/\r\n/g, "")).not.toContain("\n");
		expect(output).toContain("ax:\r\n");
		expect(output).toContain("ax >> p\r\n");
	});

	it("rewrites another artifact's revises: reference", () => {
		const src = `---
artifact:
  a:
    label: A
  b:
    label: B
    revises: a
process:
  p:
    label: P
---
a >> p -> b
`;
		const { output } = renamed(src, "a", "ax");
		expect(output).toContain("revises: ax");
	});

	it("rewrites a parts: item referencing the renamed artifact", () => {
		const src = `---
artifact:
  a:
    label: A
  bundle:
    label: Bundle
    parts: [a, other]
  other:
    label: Other
process:
  p:
    label: P
---
a >> p -> bundle
`;
		const { output } = renamed(src, "a", "ax");
		// A mutated flow-sequence item re-serializes with the `yaml` package's
		// own default flow spacing (the same shape `deleteNodes` produces for
		// a trimmed `parts:`, e.g. `parts: [ y ]`), not the original spacing.
		expect(output).toContain("parts: [ ax, other ]");
	});

	it("rewrites a subflow process's boundary: key referencing the renamed artifact", () => {
		const src = `---
artifact:
  order:
    label: Order
  fulfilled:
    label: Fulfilled
process:
  work:
    label: Work
    subflow: ./child.pfdsl
    boundary: { order: incoming_order, fulfilled: outgoing_fulfilled }
---
order >> work -> fulfilled
`;
		const { output } = renamed(src, "order", "order_v2");
		expect(output).toContain(
			"boundary: { order_v2: incoming_order, fulfilled: outgoing_fulfilled }",
		);
	});

	it("renames a body-only (undeclared) node", () => {
		const src = "a >> p -> b\n";
		const { output, kind } = renamed(src, "b", "bx");
		expect(kind).toBe("artifact");
		expect(output).toBe("a >> p -> bx\n");
	});
});

describe("renameId subflow boundary preservation (spec §2.9.3)", () => {
	it("adds a boundary: {new: old} entry when the renamed artifact is a normal input with no existing boundary map", () => {
		const src = `---
artifact:
  order:
    label: Order
  fulfilled:
    label: Fulfilled
process:
  work:
    label: Work
    subflow: ./child.pfdsl
---
order >> work -> fulfilled
`;
		const { output } = renamed(src, "order", "order_v2");
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.work?.boundary).toEqual({
			order_v2: "order",
		});
	});

	it("adds a boundary: {new: old} entry for a renamed output artifact, merging into an existing unrelated boundary map", () => {
		const src = `---
artifact:
  order:
    label: Order
  fulfilled:
    label: Fulfilled
  other_in:
    label: OtherIn
process:
  work:
    label: Work
    subflow: ./child.pfdsl
    boundary: { other_in: mapped_in }
---
order >> work -> fulfilled
other_in >> work
`;
		const { output } = renamed(src, "fulfilled", "fulfilled_v2");
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.work?.boundary).toEqual({
			other_in: "mapped_in",
			fulfilled_v2: "fulfilled",
		});
	});

	it("renames an existing boundary key instead of adding a new entry, keeping its child-side value", () => {
		const src = `---
artifact:
  order:
    label: Order
  fulfilled:
    label: Fulfilled
process:
  work:
    label: Work
    subflow: ./child.pfdsl
    boundary: { order: incoming_order }
---
order >> work -> fulfilled
`;
		const { output } = renamed(src, "order", "order_v2");
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.work?.boundary).toEqual({
			order_v2: "incoming_order",
		});
	});

	// boundary: keys are not restricted to YAML strings (only declaration ids
	// are), so a bare `10:` there names the parent artifact "10".
	it("renames a bare numeric boundary: key naming the renamed artifact, adding no second entry", () => {
		const src = `---
process:
  work: { subflow: ./child.pfdsl, boundary: { 10: child_in } }
---
"10" >> work
`;
		const { output } = renamed(src, "10", "ten");
		const { frontmatter, diagnostics } = analyze(output);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(frontmatter?.process?.work?.boundary).toEqual({ ten: "child_in" });
	});

	it("adds nothing when the renamed artifact is not adjacent to any subflow process", () => {
		const src = `---
artifact:
  order:
    label: Order
  fulfilled:
    label: Fulfilled
  unrelated:
    label: Unrelated
process:
  work:
    label: Work
    subflow: ./child.pfdsl
  other:
    label: Other
---
order >> work -> fulfilled
unrelated >> other
`;
		const { output } = renamed(src, "unrelated", "unrelated_v2");
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.work?.boundary).toBeUndefined();
	});

	it("adds nothing when the renamed artifact only feeds the subflow process via a feedback (>>?) edge", () => {
		const src = `---
artifact:
  order:
    label: Order
  fulfilled:
    label: Fulfilled
  correction:
    label: Correction
process:
  work:
    label: Work
    subflow: ./child.pfdsl
---
order >> work -> fulfilled
correction >>? work
`;
		const { output } = renamed(src, "correction", "correction_v2");
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.work?.boundary).toBeUndefined();
	});
});

// A new id that looks like a YAML number, boolean or null must be written as
// a string in every frontmatter position the rename touches: declaration ids
// and revises:/parts:/boundary: values are strings (FM004 otherwise).
describe("renameId writes a typed-looking new id as a YAML string", () => {
	const src = `---
artifact:
  a: { label: A }
  copy: { revises: a }
  bundle: { parts: [a, sib] }
process:
  mapped: { subflow: ./child.pfdsl, boundary: { a: child_a } }
  merged: { subflow: ./child.pfdsl, boundary: { k: v } }
  fresh: { subflow: ./child.pfdsl }
---
a >> mapped
a >> merged
a >> fresh
`;

	it.each(["43", "true", "null", "1e3"])("%s", (newId) => {
		const { output } = renamed(src, "a", newId);
		const { frontmatter, diagnostics } = analyze(output);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(Object.keys(frontmatter?.artifact ?? {})).toEqual([
			newId,
			"copy",
			"bundle",
		]);
		expect(frontmatter?.artifact?.copy?.revises).toBe(newId);
		expect(frontmatter?.artifact?.bundle?.parts).toEqual([newId, "sib"]);
		expect(frontmatter?.process?.mapped?.boundary).toEqual({
			[newId]: "child_a",
		});
		expect(frontmatter?.process?.merged?.boundary).toEqual({
			k: "v",
			[newId]: "a",
		});
		expect(frontmatter?.process?.fresh?.boundary).toEqual({ [newId]: "a" });
	});

	it("writes a typed-looking old id as a string boundary: value", () => {
		const typedOld = `---
artifact:
  "43": { label: N }
process:
  merged: { subflow: ./child.pfdsl, boundary: { k: v } }
  fresh: { subflow: ./child.pfdsl }
---
"43" >> merged
"43" >> fresh
`;
		const { output } = renamed(typedOld, "43", "n43");
		const { frontmatter, diagnostics } = analyze(output);
		expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(frontmatter?.process?.merged?.boundary).toEqual({
			k: "v",
			n43: "43",
		});
		expect(frontmatter?.process?.fresh?.boundary).toEqual({ n43: "43" });
	});
});

// The product of the ways an id can be spelled, the body position it can
// occupy, and whether it is frontmatter-declared or body-only — checked
// against the invariant from spec §9/§15.11 rather than the implementation:
// re-analyzing the output after a rename gives exactly the original edge
// list with old→new substituted, the same node kinds, and old nowhere.
describe("renameId invariant across id spellings, positions, and declared vs body-only", () => {
	interface Spelling {
		name: string;
		id: string;
		bodyToken: string;
		declaredKey: string;
	}
	const idSpellings: Spelling[] = [
		{ name: "bare", id: "n1", bodyToken: "n1", declaredKey: "n1" },
		{
			name: "quoted-not-needed",
			id: "n1",
			bodyToken: '"n1"',
			declaredKey: '"n1"',
		},
		{
			name: "quoted-needed",
			id: "n one",
			bodyToken: '"n one"',
			declaredKey: '"n one"',
		},
	];
	const newId = "zz";

	interface PositionCase {
		name: string;
		body: (tok: string) => string;
		/** Only "reference" needs this — revises: requires a declared target (V016), so it is declared-only. */
		declaredOnly?: boolean;
		extraFrontmatter?: (refId: string) => string;
	}
	const positions: PositionCase[] = [
		{ name: "input", body: (tok) => `${tok} >> anchor\n` },
		{ name: "output", body: (tok) => `anchorIn >> anchor -> ${tok}\n` },
		{ name: "set-member", body: (tok) => `[${tok}, sib] >> anchor\n` },
		{
			name: "chain-middle",
			body: (tok) => `head >> anchor -> ${tok} >> anchor2 -> tail\n`,
		},
		{
			name: "reference",
			declaredOnly: true,
			body: (tok) => `${tok} >> anchor\n`,
			extraFrontmatter: (refId) =>
				`  copy:\n    revises: ${refId}\n  bundle:\n    parts: [${refId}, sib2]\n`,
		},
	];

	function buildSource(
		position: PositionCase,
		spelling: Spelling,
		declared: boolean,
	): string {
		const artifactLines: string[] = [];
		if (declared)
			artifactLines.push(`  ${spelling.declaredKey}:\n    label: Old\n`);
		if (position.extraFrontmatter) {
			artifactLines.push(position.extraFrontmatter(spelling.id));
		}
		const frontmatter =
			artifactLines.length > 0
				? `---\nartifact:\n${artifactLines.join("")}---\n`
				: "";
		return frontmatter + position.body(spelling.bodyToken);
	}

	function substitute(
		edges: readonly {
			kind: "input" | "output" | "feedback";
			artifact: string;
			process: string;
		}[],
		oldId: string,
		newIdValue: string,
	) {
		return edges.map((e) => ({
			kind: e.kind,
			artifact: e.artifact === oldId ? newIdValue : e.artifact,
			process: e.process === oldId ? newIdValue : e.process,
		}));
	}

	const cases = idSpellings.flatMap((spelling) =>
		positions.flatMap((position) =>
			[true, false]
				.filter((declared) => declared || !position.declaredOnly)
				.map((declared) => ({ spelling, position, declared })),
		),
	);

	it("builds the full combinatorial case set (27: reference is declared-only)", () => {
		expect(cases).toHaveLength(27);
	});

	it.each(cases)("$spelling.name / $position.name / declared=$declared", ({
		spelling,
		position,
		declared,
	}) => {
		const source = buildSource(position, spelling, declared);
		const before = analyze(source);
		expect(before.diagnostics.filter((d) => d.severity === "error")).toEqual(
			[],
		);
		expect(before.nodeKinds.get(spelling.id)).toBe("artifact");

		const { output, kind } = renamed(source, spelling.id, newId);
		expect(kind).toBe("artifact");

		const after = analyze(output);
		expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(after.edges).toEqual(substitute(before.edges, spelling.id, newId));
		expect(after.nodeKinds.get(newId)).toBe("artifact");
		expect(after.nodeKinds.has(spelling.id)).toBe(false);

		if (position.name === "reference") {
			expect(String(after.frontmatter?.artifact?.copy?.revises)).toBe(newId);
			expect(after.frontmatter?.artifact?.bundle?.parts).toContain(newId);
			expect(after.frontmatter?.artifact?.bundle?.parts).not.toContain(
				spelling.id,
			);
		}
	});
});

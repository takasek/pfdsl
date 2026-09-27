import { describe, expect, it } from "vitest";
import { analyze } from "./index.js";
import { renameId } from "./rename-id.js";

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
		const { output, found, kind } = renameId(src, "b", "bx");
		expect(found).toBe(true);
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
		const { output } = renameId(src, "a", "ax");
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
		const { output } = renameId(src, "p", "px");
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
		const { output } = renameId(src, "a", "ax");
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
		const { output } = renameId(src, "b", "bx");
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
		const { output } = renameId(src, "a", "a new");
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
		const { output, found } = renameId(`${body}\n`, "a", "x-");
		expect(found).toBe(true);
		expect(output).toBe(expected);
		const after = analyze(output);
		expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(after.nodeKinds.get("x-")).toBe("artifact");
	});

	it("preserves CRLF line endings", () => {
		const src =
			"---\r\nartifact:\r\n  a:\r\n    label: A\r\nprocess:\r\n  p:\r\n    label: P\r\n---\r\na >> p\r\n";
		const { output } = renameId(src, "a", "ax");
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
		const { output } = renameId(src, "a", "ax");
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
		const { output } = renameId(src, "a", "ax");
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
		const { output } = renameId(src, "order", "order_v2");
		expect(output).toContain(
			"boundary: { order_v2: incoming_order, fulfilled: outgoing_fulfilled }",
		);
	});

	it("renames a body-only (undeclared) node", () => {
		const src = "a >> p -> b\n";
		const { output, found, kind } = renameId(src, "b", "bx");
		expect(found).toBe(true);
		expect(kind).toBe("artifact");
		expect(output).toBe("a >> p -> bx\n");
	});

	it("is a no-op reporting found: false when oldId does not exist", () => {
		const src = "a >> p -> b\n";
		const { output, found, kind } = renameId(src, "ghost", "gx");
		expect(found).toBe(false);
		expect(kind).toBeNull();
		expect(output).toBe(src);
	});

	it("is a no-op when oldId is a group id, not an artifact/process id", () => {
		const src = `---
group:
  g1:
    label: G1
---
a
`;
		const { output, found, kind } = renameId(src, "g1", "gx");
		expect(found).toBe(false);
		expect(kind).toBeNull();
		expect(output).toBe(src);
	});

	it("is a no-op when the source already carries a parse error", () => {
		const src = `---
artifact:
  a: [unterminated
---
a
`;
		const { output, found, diagnostics } = renameId(src, "a", "ax");
		expect(found).toBe(false);
		expect(output).toBe(src);
		expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
	});

	it("is a no-op when the body carries a parser (P) error", () => {
		const src = "a >> >> p -> b\n";
		const { output, found, diagnostics } = renameId(src, "b", "bx");
		expect(diagnostics.some((d) => String(d.code).startsWith("P"))).toBe(true);
		expect(found).toBe(false);
		expect(output).toBe(src);
	});

	// Only a document that could not be read (FM / L / P) blocks the rewrite.
	// A validation (V) or normalizer (N) error is judged on the result by the
	// caller, the same way `meta set` judges its write.
	it("still renames when the source carries a validation (V) error", () => {
		const src = `---
artifact:
  a: { status: bogus }
---
a >> p -> b
`;
		const { output, found, kind } = renameId(src, "b", "bb");
		expect(found).toBe(true);
		expect(kind).toBe("artifact");
		expect(output).toBe(`---
artifact:
  a: { status: bogus }
---
a >> p -> bb
`);
	});

	it("still renames when the source carries a normalizer (N) error", () => {
		const src = `---
artifact:
  x: {label: X}
process:
  x: {label: X}
---
a >> p -> b
`;
		const { output, found } = renameId(src, "b", "bb");
		expect(found).toBe(true);
		expect(output.endsWith("a >> p -> bb\n")).toBe(true);
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
		const { output } = renameId(src, "order", "order_v2");
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
		const { output } = renameId(src, "fulfilled", "fulfilled_v2");
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
		const { output } = renameId(src, "order", "order_v2");
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.work?.boundary).toEqual({
			order_v2: "incoming_order",
		});
	});

	// `boundary:` must be a map; an empty one is unreadable (FM004).
	it.each([
		["block-style with no value", "    boundary:\n"],
		["an explicit null (~)", "    boundary: ~\n"],
	])("is a no-op next to an empty boundary: (%s), which is FM004", (_name, boundaryLine) => {
		const src = `---
process:
  sub:
    subflow: ./child.pfdsl
${boundaryLine}---
x >> sub -> y
`;
		const { output, found, kind, diagnostics } = renameId(src, "y", "y2");
		expect(diagnostics.map((d) => d.code)).toContain("FM004");
		expect(found).toBe(false);
		expect(kind).toBeNull();
		expect(output).toBe(src);
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
		const { output } = renameId(src, "unrelated", "unrelated_v2");
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
		const { output } = renameId(src, "correction", "correction_v2");
		const { frontmatter } = analyze(output);
		expect(frontmatter?.process?.work?.boundary).toBeUndefined();
	});
});

// The product of the ways an id can be spelled, the body position it can
// occupy, and whether it is frontmatter-declared or body-only — checked
// against the invariant from spec §9/§15.11 rather than the implementation:
// re-analyzing the output after a rename gives exactly the original edge
// list with old→new substituted, the same node kinds, and old nowhere.
// Modelled on rename-group.test.ts's "id identity across key shapes,
// positions and styles" describe block.
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

		const { output, found, kind } = renameId(source, spelling.id, newId);
		expect(found).toBe(true);
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

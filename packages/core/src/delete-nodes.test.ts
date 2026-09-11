import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deleteNodes } from "./delete-nodes.js";
import { analyze } from "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("deleteNodes", () => {
	describe("frontmatter declarations", () => {
		it("removes a single artifact's declaration block", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
---
a; b
`;
			const { output, deleted, notFound } = deleteNodes(src, ["a"]);
			expect(deleted).toEqual(["a"]);
			expect(notFound).toEqual([]);
			expect(output).toContain("b:\n    label: B");
			expect(output).not.toContain("a:\n    label: A");
		});

		it("leaves an empty mapping in place rather than deleting the section key, when the last entry goes", () => {
			// Decision: removing the section key entirely would strip a schema
			// element (`artifact:` as "no artifacts declared yet" vs. absent
			// entirely) for no benefit over the yaml package's own default
			// deleteIn behavior, which already leaves `artifact: {}`.
			const src = `---
artifact:
  a:
    label: A
process:
  p:
    label: P
---
a >> p
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("artifact: {}");
		});

		it("reports an id absent from the document as notFound, not deleted", () => {
			const src = `---
artifact:
  a:
    label: A
---
a
`;
			const { deleted, notFound } = deleteNodes(src, ["ghost"]);
			expect(deleted).toEqual([]);
			expect(notFound).toEqual(["ghost"]);
		});

		it("is idempotent: deleting an already-deleted id is a no-op", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
---
a; b
`;
			const first = deleteNodes(src, ["a"]);
			const second = deleteNodes(first.output, ["a"]);
			expect(second.deleted).toEqual([]);
			expect(second.notFound).toEqual(["a"]);
			expect(second.output).toBe(first.output);
		});
	});

	describe("body edges", () => {
		it("trims a deleted id out of an artifact set, keeping the edge", () => {
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
---
[a, b] >> p -> c
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("b >> p -> c");
		});

		it("drops the whole input-edge statement when the artifact set empties out", () => {
			const src = `---
artifact:
  a:
    label: A
process:
  p:
    label: P
  q:
    label: Q
---
a >> p

toolchain >> q
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).not.toContain("a >> p");
			expect(output).toContain("toolchain >> q");
			// no doubled blank line left behind where the dropped statement was
			expect(output).not.toMatch(/\n\n\n/);
		});

		it("drops the whole output-edge statement when the process is deleted", () => {
			const src = `---
artifact:
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
p -> b

toolchain >> q
`;
			const { output } = deleteNodes(src, ["p"]);
			expect(output).not.toContain("p -> b");
			expect(output).toContain("toolchain >> q");
		});

		it("drops the whole edge statement when the output artifact is deleted", () => {
			const src = `---
artifact:
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
p -> b

toolchain >> q
`;
			const { output } = deleteNodes(src, ["b"]);
			expect(output).not.toContain("p -> b");
			expect(output).toContain("toolchain >> q");
		});

		it("removes the last statement cleanly, leaving a single trailing newline", () => {
			const src = `---
artifact:
  x:
    label: X
  y:
    label: Y
process:
  p:
    label: P
  q:
    label: Q
---
toolchain >> q

p -> x
`;
			const { output } = deleteNodes(src, ["x"]);
			expect(output.endsWith("toolchain >> q\n")).toBe(true);
			expect(output).not.toMatch(/\n\n\n/);
		});

		it("drops a bare node-decl statement for a deleted id", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
---
a; b
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).not.toMatch(/\ba\b/);
			expect(output).toContain("b");
		});

		it("renders a role trimmed to one id the way the formatter would", () => {
			// formatter.ts's fmtIds writes a single id bare and several bracketed.
			// Bracketing unconditionally leaves `[b]`, which `fmt --check` rejects
			// — and `make check-fmt` runs that over the operational .pfdsl/, so a
			// swept roadmap in that shape fails its own PR's checks.
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
---
[a, b] >> p -> c
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("b >> p -> c");
			expect(output).not.toContain("[b]");
		});

		it("carries a trailing comment across a trimmed statement", () => {
			// statementEndOffset folds a same-line comment into the statement's
			// span so a dropped statement takes its comment with it. A replaced
			// statement has to bring that tail along instead of dropping it.
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
---
[a, b] >> p -> c  # why this edge exists
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("b >> p -> c  # why this edge exists");
		});

		it("leaves an untouched statement byte-for-byte unchanged", () => {
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
[a,   b] >> p
`;
			const { output } = deleteNodes(src, ["ghost"]);
			expect(output).toContain("[a,   b] >> p");
		});

		it("fuses a surviving multi-segment chain back into one chain statement", () => {
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
			// Nothing deleted from this chain at all; still exercises the
			// multi-segment fuse path via an unrelated deletion elsewhere.
			const { output } = deleteNodes(`${src}\nghost\n`, ["ghost"]);
			expect(output).toContain("a >> p -> b >> q -> c");
		});

		it("splits a multi-segment chain where a middle process is deleted", () => {
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
			const { output } = deleteNodes(src, ["q"]);
			expect(output).toContain("a >> p -> b");
			expect(output).not.toContain(">> q");
			expect(output).not.toContain("-> c");
		});

		it("fuses a chain across two continuations when a shared head id is trimmed", () => {
			const src = `---
artifact:
  a:
    label: A
  x:
    label: X
  b:
    label: B
  c:
    label: C
  d:
    label: D
process:
  p:
    label: P
  q:
    label: Q
  r:
    label: R
---
[a, x] >> p -> b >> q -> c >> r -> d
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("x >> p -> b >> q -> c >> r -> d");
		});

		it("keeps a feedback edge (>>?) unaffected, trims one, and drops the whole thing", () => {
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
[a, b] >>? p
`;
			const trimmed = deleteNodes(src, ["a"]);
			expect(trimmed.output).toContain("b >>? p");

			const droppedProc = deleteNodes(src, ["p"]);
			expect(droppedProc.output).not.toContain(">>?");

			const unaffected = deleteNodes(src, ["ghost"]);
			expect(unaffected.output).toContain("[a, b] >>? p");
		});

		it("trims one of several output artifacts, keeping the statement", () => {
			const src = `---
artifact:
  b:
    label: B
  c:
    label: C
process:
  p:
    label: P
---
p -> [b, c]
`;
			const { output } = deleteNodes(src, ["b"]);
			expect(output).toContain("p -> c");
		});

		it("leaves an unaffected output-edge statement byte-for-byte unchanged", () => {
			const src = `---
artifact:
  b:
    label: B
  c:
    label: C
process:
  p:
    label: P
---
p -> [b,   c]
`;
			const { output } = deleteNodes(src, ["ghost"]);
			expect(output).toContain("p -> [b,   c]");
		});

		it("trims one of several ids out of a bare input-edge (no trailing ->)", () => {
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
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("b >> p");
		});

		it("re-quotes a process id it has to rewrite (#1125 defect 2)", () => {
			// The process id contains a space, so its declaration and every body
			// occurrence must stay quoted. Losing the quotes on rewrite turns "p q"
			// into two bare tokens the parser reads as two separate ids, which
			// silently forks the edge in two.
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
  c:
    label: C
process:
  "p q":
    label: PQ
---
[a, b] >> "p q" -> c
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain('b >> "p q" -> c');
			const after = analyze(output);
			expect(after.edges).toEqual([
				{ kind: "input", artifact: "b", process: "p q" },
				{ kind: "output", process: "p q", artifact: "c" },
			]);
		});

		it("re-quotes a trimmed artifact role id that needs quoting (#1125 defect 2)", () => {
			const src = `---
artifact:
  a:
    label: A
  "b c":
    label: BC
process:
  p:
    label: P
---
[a, "b c"] >> p
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain('"b c" >> p');
			const after = analyze(output);
			expect(after.edges).toEqual([
				{ kind: "input", artifact: "b c", process: "p" },
			]);
		});

		it("re-quotes a process id in a chain segment it has to rewrite (#1125 defect 2)", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
  c:
    label: C
process:
  "p q":
    label: PQ
  r:
    label: R
---
a >> "p q" -> b >> r -> c
`;
			const { output } = deleteNodes(src, ["r"]);
			expect(output).toContain('a >> "p q" -> b');
			const after = analyze(output);
			expect(after.nodeKinds.has("p q")).toBe(true);
			expect(after.nodeKinds.has("p")).toBe(false);
			expect(after.nodeKinds.has("q")).toBe(false);
			expect(after.edges).toEqual([
				{ kind: "input", artifact: "a", process: "p q" },
				{ kind: "output", process: "p q", artifact: "b" },
			]);
		});

		it("leaves an unaffected bare-tail chain byte-for-byte unchanged", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
a >> p -> b >> q
`;
			const { output } = deleteNodes(src, ["ghost"]);
			expect(output).toContain("a >> p -> b >> q");
		});

		it("attaches a trailing same-line comment to the statement it actually follows, not an earlier one on the same line", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
a >> p; b >> q  # trails the second statement
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).not.toContain("a >> p");
			expect(output).toContain("b >> q  # trails the second statement");
		});

		it("closes a fused bare-tail chain segment (no trailing ->) when its input survives", () => {
			const src = `---
artifact:
  a:
    label: A
  x:
    label: X
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
[a, x] >> p -> b >> q
`;
			// x survives the head trim, b and q are both untouched: the bare
			// tail "b >> q" fuses onto the rest of the chain.
			const { output } = deleteNodes(src, ["a"]);
			expect(output).toContain("x >> p -> b >> q");
		});

		it("drops a bare-tail chain segment when the id feeding it is gone", () => {
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
a >> p -> b >> q
`;
			// b is deleted: the bare tail has nothing left to feed q with.
			const { output } = deleteNodes(src, ["b"]);
			expect(output).toContain("a >> p");
			expect(output).not.toContain(">> q");
		});

		it("stands a produced artifact up as its own output-edge when the link feeding its process breaks", () => {
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
---
[a, b] >> p -> c
`;
			// Deleting both input ids severs p's input from this statement, but p
			// still produces c — that stands alone as "p -> c".
			const { output } = deleteNodes(src, ["a", "b"]);
			expect(output).toContain("p -> c");
			expect(output).not.toContain(">> p ->");
		});

		it("closes a chain as a bare input-edge when its own output vanishes", () => {
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
`;
			const { output } = deleteNodes(src, ["b"]);
			expect(output).toContain("a >> p");
			expect(output).not.toContain("->");
		});

		it("drops a dropped statement's own trailing same-line comment along with it, and preserves one on a kept statement", () => {
			const src = `---
artifact:
  a:
    label: A
process:
  p:
    label: P
  q:
    label: Q
---
a >> p  # notice me

toolchain >> q  # unrelated
`;
			const { output } = deleteNodes(src, ["a"]);
			expect(output).not.toContain("notice me");
			expect(output).toContain("toolchain >> q  # unrelated");

			const kept = deleteNodes(src, ["ghost"]);
			expect(kept.output).toContain("a >> p  # notice me");
		});

		it("keeps a comment attached to the statement that survives after it (#1125 defect 3)", () => {
			// `# b-chain` sits directly above the surviving `b >> q -> y`, not
			// above the deleted `a >> p -> x`. Losing it along with the deleted
			// chain's own gap strips the explanation for a statement that is
			// still there.
			const src = `---
artifact:
  a:
    label: A
  x:
    label: X
  b:
    label: B
  y:
    label: Y
process:
  p:
    label: P
  q:
    label: Q
---
a >> p -> x

# b-chain
b >> q -> y
`;
			const { output } = deleteNodes(src, ["a", "p", "x"]);
			expect(output).toContain("# b-chain\nb >> q -> y");
			expect(output).not.toContain("a >> p");
		});

		it("does not let a deleted statement's comment re-attach to the next surviving statement (#1125 defect 4)", () => {
			// The note describes the now-deleted `a >> p`. Its content must
			// survive, but it must not end up glued to `b >> q` — that would
			// misrepresent the note as describing a statement it never did.
			const src = `---
artifact:
  a:
    label: A
  b:
    label: B
process:
  p:
    label: P
  q:
    label: Q
---
# this note explains the a-chain
a >> p

b >> q
`;
			const { output } = deleteNodes(src, ["a", "p"]);
			expect(output).toContain("this note explains the a-chain");
			expect(output).not.toMatch(/this note explains the a-chain\nb >> q/);
			expect(output).not.toContain("a >> p");
		});

		it("returns the body unchanged when it has no statements at all", () => {
			const src = `---
artifact:
  a:
    label: A
---
`;
			const { output, notFound } = deleteNodes(src, ["ghost"]);
			expect(output).toBe(src);
			expect(notFound).toEqual(["ghost"]);
		});
	});

	describe("no frontmatter", () => {
		it("still edits the body when the document has no frontmatter block", () => {
			const src = "a >> p\n";
			const { output } = deleteNodes(src, ["a"]);
			expect(output).not.toContain("a >> p");
		});
	});

	describe("pre-existing errors", () => {
		it("returns the source unchanged when it already fails to parse", () => {
			const src = "[a, >> p\n";
			const { output, deleted, notFound, diagnostics } = deleteNodes(src, [
				"a",
			]);
			expect(output).toBe(src);
			expect(deleted).toEqual([]);
			expect(notFound).toEqual(["a"]);
			expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
		});
	});

	describe("reference fields", () => {
		it("drops a dangling revises: field", () => {
			const src = `---
artifact:
  old_a:
    label: Old A
    status: done
  a:
    label: A
    status: done
    revises: old_a
---
old_a; a
`;
			const { output } = deleteNodes(src, ["old_a"]);
			expect(output).not.toContain("revises");
			expect(output).toContain("a:\n    label: A");
		});

		it("trims a deleted id out of parts:, keeping the field when members remain", () => {
			const src = `---
artifact:
  whole:
    label: Whole
    parts: [x, y]
  x:
    label: X
  y:
    label: Y
---
whole; x; y
`;
			const { output } = deleteNodes(src, ["x"]);
			expect(output).toContain("parts: [ y ]");
		});

		it("drops parts: entirely when every member is deleted", () => {
			const src = `---
artifact:
  whole:
    label: Whole
    parts: [x]
  x:
    label: X
---
whole; x
`;
			const { output } = deleteNodes(src, ["x"]);
			expect(output).not.toContain("parts");
		});

		it("drops a boundary: key that names a deleted artifact, leaving the child-side value alone", () => {
			const src = `---
artifact:
  order:
    label: Order
process:
  order_fulfill:
    label: Order fulfill
    subflow: ./child.pfdsl
    boundary:
      order: incoming_order
---
order >> order_fulfill
`;
			const { output } = deleteNodes(src, ["order"]);
			expect(output).not.toContain("boundary");
			expect(output).not.toContain("incoming_order");
		});
	});

	describe("safety against dangling roadmap references (V035)", () => {
		it("never leaves a declaration without its edge occurrence, or vice versa", () => {
			const src = `---
type: roadmap
artifact:
  a:
    label: A
    status: done
  b:
    label: B
    status: done
  c:
    label: C
    status: done
process:
  p:
    label: P
---
[a, b] >> p -> c
`;
			const { output } = deleteNodes(src, ["p", "c"]);
			const after = analyze(output);

			// Stated directly, not inferred from a clean `check`: `nodeKinds` is
			// total over frontmatter declarations and body edges alike, so an id
			// absent from it has lost both. Reading zero errors instead would
			// only cover one direction — a declaration left without its edge
			// raises no error at all, and a surviving edge whose declaration went
			// is the V035 this guards.
			for (const id of ["p", "c"]) {
				expect(after.nodeKinds.has(id)).toBe(false);
				expect(output).not.toMatch(new RegExp(`\\b${id}\\b`));
			}
			expect(
				after.edges.filter((e) => e.process === "p" || e.artifact === "c"),
			).toEqual([]);
			expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual(
				[],
			);
		});

		it("catches a declaration removed while its edge survives", () => {
			// The predicate above is only worth asserting if it separates a clean
			// delete from a half one. Hand-build the half: drop `a`'s declaration
			// and keep the edge naming it.
			const halfDeleted = `---
type: roadmap
artifact:
  b:
    label: B
    status: done
  c:
    label: C
    status: done
process:
  p:
    label: P
---
[a, b] >> p -> c
`;
			const after = analyze(halfDeleted);
			expect(after.nodeKinds.has("a")).toBe(true);
			expect(after.diagnostics.filter((d) => d.code === "V035")).not.toEqual(
				[],
			);
		});
	});

	describe("real roadmap.pfdsl", () => {
		// Derived, never hardcoded: the sweep set this repo's roadmap currently
		// carries is exactly what merging this work removes, so naming those ids
		// here would make the test fail the first time the sweep runs. The rule is
		// the backend reference's: keep every process that outputs a not-done
		// artifact, keep the artifacts on those processes' edges, delete the rest.
		// An already-swept roadmap yields an empty set and the assertions still
		// hold. Whether the planning queries survive a sweep is checked where the
		// real query runs, in the CLI's own suite — reproducing their logic here
		// would only test this file's copy of it.
		const sweepSet = (result: ReturnType<typeof analyze>): string[] => {
			const status = (id: string) => result.frontmatter?.artifact?.[id]?.status;
			const keepProcesses = new Set(
				result.edges
					.filter((e) => e.kind === "output" && status(e.artifact) !== "done")
					.map((e) => e.process),
			);
			const keepArtifacts = new Set(
				result.edges
					.filter((e) => keepProcesses.has(e.process))
					.map((e) => e.artifact),
			);
			return [...result.nodeKinds]
				.filter(([id, kind]) =>
					kind === "process"
						? !keepProcesses.has(id)
						: kind === "artifact" && !keepArtifacts.has(id),
				)
				.map(([id]) => id);
		};

		it("sweeps the derived set out of the real roadmap without leaving errors", () => {
			const src = readFileSync(
				resolve(__dirname, "../../../.pfdsl/roadmap.pfdsl"),
				"utf-8",
			);
			const before = analyze(src);
			expect(before.diagnostics.filter((d) => d.severity === "error")).toEqual(
				[],
			);

			const targets = sweepSet(before);
			const { output, deleted, notFound } = deleteNodes(src, targets);
			expect(notFound).toEqual([]);
			expect(deleted.sort()).toEqual([...targets].sort());

			const after = analyze(output);
			expect(after.diagnostics.filter((d) => d.severity === "error")).toEqual(
				[],
			);
			for (const id of targets) expect(after.nodeKinds.has(id)).toBe(false);
		});
	});
});

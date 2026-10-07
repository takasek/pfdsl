import {
	linkSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { run } from "./index.js";

let dir: string;
let file: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-dependency-mutations-"));
	file = join(dir, "entry.pfdsl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it.each([
	"symlink",
	"hardlink",
])("allows deletion that keeps a same-file child boundary valid: %s", async (kind) => {
	writeFileSync(
		file,
		"---\nprocess:\n  p: {subflow: alias.pfdsl}\n---\n[a,c] >> p -> b\n",
	);
	if (kind === "symlink") symlinkSync(file, join(dir, "alias.pfdsl"));
	else linkSync(file, join(dir, "alias.pfdsl"));
	expect((await run(["delete", file, "c", "--write"])).exitCode).toBe(0);
	const checked = JSON.parse((await run(["check", file, "--json"])).stdout);
	expect(checked.diagnostics.map((d: { code: string }) => d.code)).toEqual([
		"V022",
	]);
});

it.each([
	"inherited",
	"local,inherited",
])("refuses preset-only group delete atomically: %s", async (ids) => {
	const preset = "group:\n  inherited: {label: Inherited}\n";
	const source =
		"---\nextends: preset.yaml\ngroup:\n  local: {}\nartifact:\n  a: {group: inherited}\n---\na >> p -> b\n";
	writeFileSync(join(dir, "preset.yaml"), preset);
	writeFileSync(file, source);
	const result = await run(["delete", file, ids, "--write", "--json"]);
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: false,
		error: expect.stringContaining("preset"),
	});
	expect(readFileSync(file, "utf8")).toBe(source);
	expect(readFileSync(join(dir, "preset.yaml"), "utf8")).toBe(preset);
});

it("keeps local deletion and an absent ID idempotent", async () => {
	writeFileSync(join(dir, "preset.yaml"), "group:\n  inherited: {}\n");
	writeFileSync(
		file,
		"---\nextends: preset.yaml\ngroup:\n  local: {}\n---\na\n",
	);
	expect((await run(["delete", file, "local", "--write"])).exitCode).toBe(0);
	const source = readFileSync(file, "utf8");
	const result = await run([
		"delete",
		file,
		"local,absent",
		"--write",
		"--json",
	]);
	expect(JSON.parse(result.stdout)).toMatchObject({
		ok: true,
		deleted: [],
		notFound: ["local", "absent"],
	});
	expect(readFileSync(file, "utf8")).toBe(source);
});

it.each([
	"rename",
	"delete",
])("allows %s with unrelated preset style errors", async (command) => {
	writeFileSync(
		join(dir, "preset.yaml"),
		"statusStyles: {done: {fill: red}}\ngroup:\n  root: {}\n",
	);
	writeFileSync(
		file,
		"---\nextends: preset.yaml\ngroup:\n  local: {parent: root}\nartifact:\n  a: {group: local}\n---\na >> p -> b\n",
	);
	expect((await run(["check", file])).exitCode).toBe(1);
	const args = command === "rename" ? ["local", "renamed"] : ["local"];
	expect((await run([command, file, ...args, "--write"])).exitCode).toBe(0);
});

it("allows rename with unrelated child errors and permits deleting a broken reference", async () => {
	writeFileSync(
		file,
		"---\nprocess:\n  p: {subflow: missing.pfdsl}\n---\na >> p -> b\nx >> q -> y\n",
	);
	expect((await run(["rename", file, "x", "x2", "--write"])).exitCode).toBe(0);
	expect((await run(["delete", file, "p", "--write"])).exitCode).toBe(0);
	expect(readFileSync(file, "utf8")).not.toContain("missing.pfdsl");
});

it.each([
	"a",
	"b",
])("refuses deleting a boundary artifact %s without changing either file", async (id) => {
	const source =
		"---\nprocess:\n  p: {subflow: child.pfdsl}\n---\n[a,c] >> p -> [b,d]\n";
	const child = "[a,c] >> q -> [b,d]\n";
	writeFileSync(file, source);
	writeFileSync(join(dir, "child.pfdsl"), child);
	const result = await run(["delete", file, id, "--write", "--json"]);
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
		expect.objectContaining({ code: "V034" }),
	);
	expect(readFileSync(file, "utf8")).toBe(source);
	expect(readFileSync(join(dir, "child.pfdsl"), "utf8")).toBe(child);
});

it("allows deletion that repairs a boundary mismatch", async () => {
	writeFileSync(
		file,
		"---\nprocess:\n  p: {subflow: child.pfdsl}\n---\n[a,c] >> p -> b\n",
	);
	writeFileSync(join(dir, "child.pfdsl"), "a >> q -> b\n");
	expect((await run(["delete", file, "c", "--write"])).exitCode).toBe(0);
	expect((await run(["check", file])).exitCode).toBe(0);
});

it.each([
	false,
	true,
])("refuses rename that breaks a reachable return boundary, indirect=%s", async (indirect) => {
	const source = `---\nprocess:\n  p: {subflow: ${indirect ? "child.pfdsl" : "entry.pfdsl"}}\n---\na >> p -> b\n`;
	writeFileSync(file, source);
	if (indirect)
		writeFileSync(
			join(dir, "child.pfdsl"),
			"---\nprocess:\n  q: {subflow: entry.pfdsl}\n---\na >> q -> b\n",
		);
	const before = JSON.parse((await run(["check", file, "--json"])).stdout);
	expect(before.diagnostics.map((d: { code: string }) => d.code)).toEqual([
		"V022",
	]);
	const result = await run(["rename", file, "a", "a2", "--write", "--json"]);
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
		expect.objectContaining({ code: expect.stringMatching(/^V03/) }),
	);
	expect(readFileSync(file, "utf8")).toBe(source);
});

it("refuses changing a surviving boundary whose child cannot be read", async () => {
	const source =
		"---\nprocess:\n  p: {subflow: missing.pfdsl}\n---\n[a,c] >> p -> b\n";
	writeFileSync(file, source);
	expect((await run(["delete", file, "a", "--write"])).exitCode).toBe(1);
	expect(readFileSync(file, "utf8")).toBe(source);
});

it("refuses process deletion that breaks a reachable child's return boundary", async () => {
	const source =
		"---\nprocess:\n  p: {subflow: child.pfdsl}\n---\nx >> u -> a >> p -> b\n";
	writeFileSync(file, source);
	writeFileSync(
		join(dir, "child.pfdsl"),
		"---\nprocess:\n  q: {subflow: entry.pfdsl, boundary: {a: x}}\n---\na >> q -> b\n",
	);
	const before = JSON.parse((await run(["check", file, "--json"])).stdout);
	expect(before.diagnostics.map((d: { code: string }) => d.code)).toEqual([
		"V022",
	]);
	const result = await run(["delete", file, "u", "--write", "--json"]);
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
		expect.objectContaining({ code: "V030", file: join(dir, "child.pfdsl") }),
	);
	expect(readFileSync(file, "utf8")).toBe(source);
});

it("allows removing the only route to a child that refers back to the entry", async () => {
	writeFileSync(
		file,
		"---\nprocess:\n  p: {subflow: child.pfdsl}\n---\nx >> u -> a >> p -> b\n",
	);
	writeFileSync(
		join(dir, "child.pfdsl"),
		"---\nprocess:\n  q: {subflow: entry.pfdsl, boundary: {a: x}}\n---\na >> q -> b\n",
	);
	expect((await run(["delete", file, "p", "--write"])).exitCode).toBe(0);
	expect((await run(["check", file])).exitCode).toBe(0);
});

it.each([
	"symlink",
	"hardlink",
])("refuses a boundary rename through an alias of the edited file: %s", async (kind) => {
	const source =
		"---\nprocess:\n  p: {subflow: alias.pfdsl}\n---\na >> p -> b\n";
	writeFileSync(file, source);
	if (kind === "symlink") symlinkSync(file, join(dir, "alias.pfdsl"));
	else linkSync(file, join(dir, "alias.pfdsl"));
	const result = await run(["rename", file, "a", "a2", "--write", "--json"]);
	expect(result.exitCode).toBe(1);
	expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
		expect.objectContaining({ code: "V030" }),
	);
	expect(readFileSync(file, "utf8")).toBe(source);
});

it.each([
	false,
	true,
])("protects inherited child parents on group rename, local override=%s", async (override) => {
	writeFileSync(join(dir, "preset.yaml"), "group:\n  child: {parent: g}\n");
	const source = `---\nextends: preset.yaml\ngroup:\n  g: {}\n${override ? "  child: {parent: g}\n" : ""}artifact:\n  a: {group: child}\n---\na\n`;
	writeFileSync(file, source);
	const result = await run(["rename", file, "g", "h", "--write"]);
	expect(result.exitCode).toBe(override ? 0 : 1);
	if (!override) expect(readFileSync(file, "utf8")).toBe(source);
});

it("reports a shared extends cycle only once through the CLI", async () => {
	writeFileSync(
		file,
		"---\nprocess:\n  p: {subflow: left.pfdsl}\n  q: {subflow: right.pfdsl}\n---\na >> p -> b\na >> q -> c\n",
	);
	writeFileSync(
		join(dir, "left.pfdsl"),
		"---\nextends: a.yaml\n---\na >> r -> b\n",
	);
	writeFileSync(
		join(dir, "right.pfdsl"),
		"---\nextends: b.yaml\n---\na >> s -> c\n",
	);
	writeFileSync(join(dir, "a.yaml"), "extends: b.yaml\n");
	writeFileSync(join(dir, "b.yaml"), "extends: a.yaml\n");
	const result = await run(["check", file, "--json"]);
	expect(
		JSON.parse(result.stdout).diagnostics.filter(
			(d: { code: string }) => d.code === "V027",
		),
	).toHaveLength(1);
});

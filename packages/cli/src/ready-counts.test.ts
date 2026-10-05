import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./index.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-ready-counts-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function fixture(
	statuses: Record<string, string | undefined>,
	graph: string,
): string {
	const metadata = Object.entries(statuses)
		.filter(([, status]) => status !== undefined)
		.map(([id, status]) => `  ${id}: ${JSON.stringify({ status })}`)
		.join("\n");
	// Legacy untyped files may omit statuses; explicit roadmap files require them.
	const type = Object.values(statuses).includes(undefined)
		? ""
		: "type: roadmap\n";
	return `---\n${type}artifact:\n${metadata}\n---\n${graph}\n`;
}

// Compare each forecast to the public mutation command and to a fresh ready
// query on an independent copy. This exercises the actual state transition.
async function verifyCounts(source: string, expected: Record<string, number>) {
	const file = join(dir, "before.pfdsl");
	writeFileSync(file, source);
	const before = await run(["status", "ready", file, "--json"]);
	expect(before.exitCode, before.stdout + before.stderr).toBe(0);
	const payload = JSON.parse(before.stdout);
	expect(payload.best).toBeUndefined();
	expect(
		Object.fromEntries(
			payload.ready.map((item: { id: string; newlyReadyCount: number }) => [
				item.id,
				item.newlyReadyCount,
			]),
		),
	).toEqual(expected);
	const beforeIds = new Set(
		payload.ready.map((item: { id: string }) => item.id),
	);
	for (const item of payload.ready) {
		const copy = join(dir, `${item.id}.pfdsl`);
		writeFileSync(copy, source);
		const done = await run([
			"meta",
			"set",
			copy,
			item.outputs.join(","),
			"status",
			"done",
			"--json",
		]);
		expect(done.exitCode).toBe(0);
		const after = await run(["status", "ready", copy, "--json"]);
		expect(after.exitCode).toBe(0);
		const newly = JSON.parse(after.stdout).ready.filter(
			(next: { id: string }) => !beforeIds.has(next.id),
		);
		expect(item.newlyReadyCount).toBe(newly.length);
		expect(JSON.parse(done.stdout).newlyReady.sort()).toEqual(
			newly.map((next: { id: string }) => next.id).sort(),
		);
	}
	expect(readFileSync(file, "utf8")).toBe(source);
	return { file, payload };
}

describe("status ready newlyReadyCount (#1345)", () => {
	it("counts A=0, B=1 without counting consumers that are already ready", async () => {
		await verifyCounts(
			fixture(
				{
					seed: "done",
					x: "done",
					extra: "todo",
					z: "todo",
					c: "todo",
					d: "todo",
					e: "todo",
				},
				"seed >> A -> [x, extra]\nseed >> B -> z\nx >> C -> c\nx >> D -> d\nz >> E -> e",
			),
			{ A: 0, B: 1, C: 0, D: 0 },
		);
	});

	it("satisfies all outputs together, deduplicates shared consumers and preserves ties in source order", async () => {
		const { payload } = await verifyCounts(
			fixture(
				{
					seed: "done",
					x: "todo",
					y: "todo",
					a: "todo",
					b: "todo",
					shared: "todo",
					next: "todo",
					blocker: "todo",
					blocked: "todo",
					parked: "waiting",
				},
				"seed >> zeta -> [x, y]\n[x, y] >> merge -> shared\n[x, blocker] >> blocked_process -> blocked\ny >> parked_process -> parked\nseed >> alpha -> [a, b]\n[a, b] >> finish -> next",
			),
			{ zeta: 1, alpha: 1 },
		);
		expect(payload.ready.map((item: { id: string }) => item.id)).toEqual([
			"zeta",
			"alpha",
		]);
	});

	it.each([
		"waiting",
		"suspended",
	])("simulates completing every output, including one currently %s", async (status) => {
		await verifyCounts(
			fixture(
				{ seed: "done", x: "todo", y: status, c: "todo" },
				"seed >> P -> [x, y]\ny >> C -> c",
			),
			{ P: 1 },
		);
	});

	it.each([
		"done",
		"wip",
		"waiting",
		"suspended",
	])("excludes a consumer with all outputs %s", async (status) => {
		await verifyCounts(
			fixture(
				{ seed: "done", gate: "todo", result: status },
				"seed >> build -> gate\ngate >> consume -> result",
			),
			{ build: 0 },
		);
	});

	it.each([
		"todo",
		undefined,
	])("includes a consumer with actionable output %s among inert outputs", async (status) => {
		await verifyCounts(
			fixture(
				{
					seed: "done",
					gate: "todo",
					result: status,
					done: "done",
					wip: "wip",
					waiting: "waiting",
					suspended: "suspended",
				},
				"seed >> build -> gate\ngate >> consume -> [result, done, wip, waiting, suspended]",
			),
			{ build: 1 },
		);
	});

	it("excludes consumers with mixed inert outputs", async () => {
		await verifyCounts(
			fixture(
				{
					seed: "done",
					gate: "todo",
					done: "done",
					wip: "wip",
					waiting: "waiting",
					suspended: "suspended",
				},
				"seed >> build -> gate\ngate >> consume -> [done, wip, waiting, suspended]",
			),
			{ build: 0 },
		);
	});

	it("keeps zero-count prerequisites useful and does not complete downstream work recursively", async () => {
		const { file } = await verifyCounts(
			fixture(
				{
					seed: "done",
					approval: "todo",
					schema: "todo",
					release: "todo",
					sdk: "todo",
					package: "todo",
				},
				"seed >> approve -> approval\nseed >> generate -> schema\n[approval, schema] >> ship -> release\nschema >> build_sdk -> sdk\nsdk >> package_sdk -> package",
			),
			{ approve: 0, generate: 1 },
		);
		const approval = await run([
			"meta",
			"set",
			file,
			"approval",
			"status",
			"done",
			"--json",
		]);
		expect(JSON.parse(approval.stdout).newlyReady).toEqual([]);
		const after = await run(["status", "ready", file, "--json"]);
		expect(JSON.parse(after.stdout).ready).toMatchObject([
			{ id: "generate", newlyReadyCount: 2 },
		]);
	});

	it("treats omitted input status as satisfied and ignores feedback as a blocker", async () => {
		await verifyCounts(
			fixture(
				{
					seed: undefined,
					gate: "todo",
					other: undefined,
					result: "todo",
					feedback: "todo",
				},
				"seed >> build -> gate\n[gate, other] >> consume -> result\nseed >> observe -> feedback\nfeedback >>? consume",
			),
			{ build: 1, observe: 0 },
		);
	});

	it("shows counts by default and suppresses only text counts with --no-counts", async () => {
		const { file, payload } = await verifyCounts(
			fixture(
				{ seed: "done", gate: "todo", result: "todo" },
				"seed >> build -> gate\ngate >> consume -> result",
			),
			{ build: 1 },
		);
		const plain = await run(["status", "ready", file]);
		expect(plain.stdout).toContain("newly ready: 1");
		expect(plain.stdout).toContain("not a priority ranking");
		expect(plain.stdout).not.toContain("recommended");
		const concise = await run(["status", "ready", file, "--no-counts"]);
		expect(concise.exitCode).toBe(0);
		expect(concise.stdout).toContain("build");
		expect(concise.stdout).not.toContain("newly ready");
		expect(concise.stdout).not.toContain("priority ranking");
		const json = await run(["status", "ready", file, "--no-counts", "--json"]);
		expect(json.exitCode).toBe(0);
		expect(JSON.parse(json.stdout)).toEqual(payload);
	});

	it("rejects the removed --best flag", async () => {
		const file = join(dir, "removed.pfdsl");
		writeFileSync(file, "seed >> build -> result\n");
		const result = await run(["status", "ready", file, "--best"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("--best");
	});
});

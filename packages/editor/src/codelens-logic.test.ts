import { describe, expect, it } from "vitest";
import { declaredCommands, runHintAnchors } from "./codelens-logic.js";

describe("declaredCommands", () => {
	it("collects the command of every process that has one", () => {
		expect(
			declaredCommands({
				build: { command: "make build" },
				test: { command: "make test" },
			}),
		).toEqual(new Set(["make build", "make test"]));
	});

	it("skips processes without a command", () => {
		expect(declaredCommands({ build: {}, test: { command: "x" } })).toEqual(
			new Set(["x"]),
		);
	});

	it("collapses the same command declared twice", () => {
		expect(
			declaredCommands({ a: { command: "make" }, b: { command: "make" } }).size,
		).toBe(1);
	});

	it("is empty when there is no process section at all", () => {
		expect(declaredCommands(undefined)).toEqual(new Set());
	});
});

describe("runHintAnchors", () => {
	const lines = [
		"---",
		"process:",
		"  build:",
		"    command: make build",
		"---",
		"spec >> build -> out",
	];
	const bodyStartLine = 6; // 1-based line the body starts on

	it("anchors at the end of the command line", () => {
		expect(
			runHintAnchors(lines, bodyStartLine, new Set(["make build"])),
		).toEqual([
			{
				line: 3,
				column: "    command: make build".length,
				command: "make build",
			},
		]);
	});

	it("returns nothing when no process declares a command", () => {
		expect(runHintAnchors(lines, bodyStartLine, new Set())).toEqual([]);
	});

	it("skips a command: line whose value no process declares", () => {
		expect(
			runHintAnchors(lines, bodyStartLine, new Set(["make test"])),
		).toEqual([]);
	});

	it("ignores a body line that looks like a command declaration", () => {
		const withBodyLookalike = [...lines, "    command: make build"];
		expect(
			runHintAnchors(withBodyLookalike, bodyStartLine, new Set(["make build"])),
		).toHaveLength(1);
	});

	it("unquotes a quoted value, since that is how it reaches the runner", () => {
		const quoted = [
			"---",
			"process:",
			"  build:",
			'    command: "make build"',
			"---",
		];
		expect(runHintAnchors(quoted, 6, new Set(["make build"]))[0]?.command).toBe(
			"make build",
		);
	});

	it("requires the indent that puts command: inside a node, not at the root", () => {
		const rootLevel = ["---", "command: make build", "---"];
		expect(runHintAnchors(rootLevel, 4, new Set(["make build"]))).toEqual([]);
	});

	it("anchors every declaring line when several processes have commands", () => {
		const two = [
			"---",
			"process:",
			"  build:",
			"    command: make build",
			"  test:",
			"    command: make test",
			"---",
		];
		expect(
			runHintAnchors(two, 8, new Set(["make build", "make test"])).map(
				(a) => a.line,
			),
		).toEqual([3, 5]);
	});
});

import { describe, expect, it } from "vitest";
import { resolveLocationFsPath } from "./location-path.js";

describe("resolveLocationFsPath", () => {
	it("resolves a relative path against the .pfdsl file's directory", () => {
		expect(
			resolveLocationFsPath(
				"/repo/.pfdsl/roadmap.pfdsl",
				"../docs/spec/spec.md",
			),
		).toBe("/repo/docs/spec/spec.md");
	});

	it("resolves a sibling path against the .pfdsl file's directory", () => {
		expect(
			resolveLocationFsPath("/repo/.pfdsl/roadmap.pfdsl", "roadmap.md"),
		).toBe("/repo/.pfdsl/roadmap.md");
	});

	it("returns an absolute location unchanged", () => {
		expect(
			resolveLocationFsPath("/repo/.pfdsl/roadmap.pfdsl", "/etc/hosts"),
		).toBe("/etc/hosts");
	});

	it("resolves relative to parent directory when basePath is ../", () => {
		expect(
			resolveLocationFsPath("/repo/.pfdsl/roadmap.pfdsl", "config.json", "../"),
		).toBe("/repo/config.json");
	});

	it("resolves relative to subdirectory when basePath is ./subdir/", () => {
		expect(
			resolveLocationFsPath(
				"/repo/.pfdsl/roadmap.pfdsl",
				"config.json",
				"./subdir/",
			),
		).toBe("/repo/.pfdsl/subdir/config.json");
	});

	it("behaves the same as without basePath when basePath is undefined", () => {
		expect(
			resolveLocationFsPath(
				"/repo/.pfdsl/roadmap.pfdsl",
				"../docs/spec/spec.md",
				undefined,
			),
		).toBe("/repo/docs/spec/spec.md");
	});
});

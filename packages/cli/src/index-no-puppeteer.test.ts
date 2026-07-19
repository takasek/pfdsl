import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Simulate puppeteer not being installed
vi.mock("puppeteer", async () => {
	throw new Error("Cannot find module 'puppeteer'");
});

import { run } from "./index.js";

let dir: string;
const valid = "req >> design -> spec\nspec >> impl -> code\n";

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-nopuppeteer-"));
	writeFileSync(join(dir, "valid.pfdsl"), valid);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("graph without puppeteer", () => {
	it("format=pdf returns error with installation hint", async () => {
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			"pdf",
		]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("puppeteer");
	});

	it("format=png returns error with installation hint", async () => {
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			"png",
		]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("puppeteer");
	});
});

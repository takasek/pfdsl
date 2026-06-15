import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mockPage = {
	setViewport: vi.fn().mockResolvedValue(undefined),
	setContent: vi.fn().mockResolvedValue(undefined),
	pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4 fake")),
	screenshot: vi.fn().mockResolvedValue(Buffer.from("\x89PNG fake")),
};
const mockBrowser = {
	newPage: vi.fn().mockResolvedValue(mockPage),
	close: vi.fn().mockResolvedValue(undefined),
};

vi.mock("puppeteer", () => ({
	default: {
		launch: vi.fn().mockResolvedValue(mockBrowser),
	},
}));

import { run } from "./index.js";

let dir: string;
const valid = "req >> design -> spec\nspec >> impl -> code\n";

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "pfdsl-pdf-"));
	writeFileSync(join(dir, "valid.pfdsl"), valid);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("graph with puppeteer", () => {
	it("format=pdf returns binary output", async () => {
		const r = await run(["graph", join(dir, "valid.pfdsl"), "--format", "pdf"]);
		expect(r.exitCode).toBe(0);
		expect(r.binaryOutput).toBeInstanceOf(Buffer);
		expect(r.binaryOutput!.toString()).toContain("%PDF");
		expect(r.stdout).toBe("");
	});

	it("format=png returns binary output", async () => {
		const r = await run(["graph", join(dir, "valid.pfdsl"), "--format", "png"]);
		expect(r.exitCode).toBe(0);
		expect(r.binaryOutput).toBeInstanceOf(Buffer);
		expect(r.stdout).toBe("");
	});
});

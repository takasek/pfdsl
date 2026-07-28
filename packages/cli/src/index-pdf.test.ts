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
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			"pdf",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.binaryOutput).toBeInstanceOf(Buffer);
		expect(r.binaryOutput!.toString()).toContain("%PDF");
		expect(r.stdout).toBe("");
	});

	it("format=png returns binary output", async () => {
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			"png",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.binaryOutput).toBeInstanceOf(Buffer);
		expect(r.stdout).toBe("");
	});

	// svgToBinary closes the browser in a finally and swallows a failing close,
	// so that a render error is not replaced by a teardown error. The mock's
	// close always succeeded, so that suppression was never exercised (#638).
	describe("when tearing the browser down also fails", () => {
		it("reports the render failure, not the close failure", async () => {
			mockPage.pdf.mockRejectedValueOnce(new Error("render exploded"));
			mockBrowser.close.mockRejectedValueOnce(new Error("close exploded"));
			const r = await run([
				"render",
				join(dir, "valid.pfdsl"),
				"--format",
				"pdf",
			]);
			expect(r.exitCode).not.toBe(0);
			expect(r.stderr).toContain("render exploded");
			expect(r.stderr).not.toContain("close exploded");
		});

		it("still works on the next call, since the failure was not cached", async () => {
			const r = await run([
				"render",
				join(dir, "valid.pfdsl"),
				"--format",
				"pdf",
			]);
			expect(r.exitCode).toBe(0);
			expect(r.binaryOutput!.toString()).toContain("%PDF");
		});
	});
});

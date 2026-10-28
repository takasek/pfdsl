import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const mockPage = {
	setViewport: vi.fn(),
	setContent: vi.fn(),
	pdf: vi.fn(),
	screenshot: vi.fn(),
};
const mockBrowser = {
	newPage: vi.fn(),
	close: vi.fn(),
};

vi.mock("puppeteer", () => ({
	default: {
		launch: vi.fn().mockResolvedValue(mockBrowser),
	},
}));

import { run } from "./index.js";

let dir: string;
const valid = "req >> design -> spec\nspec >> impl -> code\n";
const pdfBytes = Buffer.from("%PDF-1.4 fake");
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

beforeEach(() => {
	vi.clearAllMocks();
	mockPage.setViewport.mockReset().mockResolvedValue(undefined);
	mockPage.setContent.mockReset().mockResolvedValue(undefined);
	mockPage.pdf.mockReset().mockResolvedValue(pdfBytes);
	mockPage.screenshot.mockReset().mockResolvedValue(pngBytes);
	mockBrowser.newPage.mockReset().mockResolvedValue(mockPage);
	mockBrowser.close.mockReset().mockResolvedValue(undefined);
});

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
		expect(r.binaryOutput).toEqual(pdfBytes);
		expect(r.stdout).toBe("");
		expect(mockPage.pdf).toHaveBeenCalledOnce();
		expect(mockPage.screenshot).not.toHaveBeenCalled();
		expect(mockBrowser.close).toHaveBeenCalledOnce();
	});

	it("format=png returns binary output", async () => {
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			"png",
		]);
		expect(r.exitCode).toBe(0);
		expect(r.binaryOutput).toEqual(pngBytes);
		expect(r.stdout).toBe("");
		expect(mockPage.screenshot).toHaveBeenCalledOnce();
		expect(mockPage.screenshot).toHaveBeenCalledWith({ type: "png" });
		expect(mockPage.pdf).not.toHaveBeenCalled();
		expect(mockBrowser.close).toHaveBeenCalledOnce();
	});

	it.each([
		"pdf",
		"png",
	] as const)("closes the browser after a %s render failure", async (format) => {
		const render = format === "pdf" ? mockPage.pdf : mockPage.screenshot;
		render.mockRejectedValueOnce(new Error("render exploded"));
		const r = await run([
			"render",
			join(dir, "valid.pfdsl"),
			"--format",
			format,
		]);
		expect(r.exitCode).toBe(1);
		expect(r.stderr).toContain("render exploded");
		expect(r.binaryOutput).toBeUndefined();
		expect(mockBrowser.close).toHaveBeenCalledOnce();
	});

	it("preserves the render failure when closing also fails, then recovers on the next call", async () => {
		mockPage.pdf.mockRejectedValueOnce(new Error("render exploded"));
		mockBrowser.close.mockRejectedValueOnce(new Error("close exploded"));
		const argv = ["render", join(dir, "valid.pfdsl"), "--format", "pdf"];
		const failed = await run(argv);
		expect(failed.exitCode).toBe(1);
		expect(failed.stderr).toContain("render exploded");
		expect(failed.stderr).not.toContain("close exploded");
		expect(mockBrowser.close).toHaveBeenCalledOnce();

		const recovered = await run(argv);
		expect(recovered.exitCode).toBe(0);
		expect(recovered.binaryOutput).toEqual(pdfBytes);
		expect(mockBrowser.close).toHaveBeenCalledTimes(2);
	});
});

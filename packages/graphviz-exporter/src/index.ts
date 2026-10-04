export * from "./dot.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPuppeteer = any;

export type BinaryFormat = "pdf" | "png";

export async function svgToBinary(
	svg: string,
	format: BinaryFormat,
): Promise<Buffer> {
	const puppeteer: AnyPuppeteer = await import("puppeteer").catch(() => {
		throw new Error(
			`PDF/PNG export requires puppeteer, installed into the same Node/npm environment as the pfdsl CLI. Install it with:\n  npm install puppeteer\nIf pfdsl is a global install under a Node version manager (nvm/nodenv/volta), a different Node version's global will not be resolved — install into the CLI's own environment, e.g.:\n  nodenv exec npm install -g puppeteer`,
		);
	});
	const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
	const parts = viewBoxMatch?.[1]?.split(/\s+/).map(Number);
	const width = parts?.[2] ?? 1200;
	const height = parts?.[3] ?? 800;
	const sandboxArgs =
		process.platform === "linux"
			? ["--no-sandbox", "--disable-setuid-sandbox"]
			: [];
	const browser = await puppeteer.default.launch({
		headless: true,
		args: sandboxArgs,
	});
	try {
		const page = await browser.newPage();
		await page.setContent(
			`<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`,
			{ waitUntil: "load" },
		);
		if (format === "pdf") {
			return await page.pdf({
				width: `${width}px`,
				height: `${height}px`,
				printBackground: true,
				margin: { top: 0, right: 0, bottom: 0, left: 0 },
				pageRanges: "1",
			});
		}
		await page.setViewport({
			width: Math.ceil(width),
			height: Math.ceil(height),
			deviceScaleFactor: 1,
		});
		return await page.screenshot({ type: "png" });
	} finally {
		try {
			await browser.close();
		} catch {
			// suppress close errors
		}
	}
}

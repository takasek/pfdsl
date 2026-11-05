// Explicit Chrome regression probe, separate from the Node unit suite.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";

const requireExtension = createRequire(
	new URL("../../vscode-extension/package.json", import.meta.url),
);
const { chromium } = requireExtension("playwright-core");
const css = await readFile(
	new URL("../src/style.css", import.meta.url),
	"utf8",
);
const { code } = await transform(
	await readFile(
		new URL("../src/normalized-edges.ts", import.meta.url),
		"utf8",
	),
	{ loader: "ts", format: "esm" },
);
const browser = await chromium.launch({
	executablePath:
		process.env.PFDSL_PROBE_BROWSER ??
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	headless: true,
});
const observations = [];
try {
	const page = await browser.newPage();
	for (const width of [800, 900, 1280, 320])
		for (const sidebar of [0, 227])
			for (const scale of [1, 2])
				for (const ratio of [0.1, 0.5, 0.9]) {
					await page.setViewportSize({ width, height: 800 });
					await page.setContent(
						`<style>${css}</style><button id="origin">Normalize</button><div id="box" style="position:relative;width:${width - sidebar}px;height:600px;--source-ratio:${ratio}"></div>`,
					);
					await page.addScriptTag({
						type: "module",
						content: `${code}\nwindow.panel = createNormalizedEdgesPanel(document.querySelector('#box'));`,
					});
					await page.waitForFunction(() => window.panel);
					await page.evaluate((scale) => {
						document.body.style.fontSize = `${13 * scale}px`;
						document.querySelector("#origin").focus();
						window.panel.show("a >> p -> b");
					}, scale);
					const measured = await page.evaluate(() => {
						const panel = document.querySelector(".normalized-edges");
						const button = panel.querySelector("button");
						const p = panel.getBoundingClientRect();
						const b = button.getBoundingClientRect();
						const range = document.createRange();
						range.selectNodeContents(button);
						const textFits = [...range.getClientRects()].every(
							(r) =>
								r.left >= Math.max(b.left, p.left) - 0.5 &&
								r.right <= Math.min(b.right, p.right) + 0.5,
						);
						const box = document.querySelector("#box");
						const expectedWidth =
							(box.getBoundingClientRect().width - 6) *
							(1 - Number(box.style.getPropertyValue("--source-ratio")));
						return { panelWidth: p.width, expectedWidth, textFits };
					});
					await page.locator(".normalized-edges button").click();
					const clickRestores = await page.evaluate(
						() =>
							document.querySelector(".normalized-edges").hidden &&
							document.activeElement.id === "origin",
					);
					await page.evaluate(() => window.panel.show("a >> p -> b"));
					await page.keyboard.press("Escape");
					const escapeRestores = await page.evaluate(
						() =>
							document.querySelector(".normalized-edges").hidden &&
							document.activeElement.id === "origin",
					);
					observations.push({
						width,
						sidebar,
						scale,
						ratio,
						...measured,
						clickRestores,
						escapeRestores,
					});
				}
} finally {
	await browser.close();
}
if (process.argv[2])
	await writeFile(
		process.argv[2],
		`${JSON.stringify({ observations }, null, 2)}\n`,
	);
const failures = observations.filter(
	(r) =>
		r.width >= 800 &&
		(!r.textFits ||
			Math.abs(r.panelWidth - r.expectedWidth) > 1 ||
			!r.clickRestores ||
			!r.escapeRestores),
);
console.log(
	JSON.stringify({
		cases: observations.length,
		representativeFailures: failures,
	}),
);
assert.equal(
	failures.length,
	0,
	"Close must remain readable and operable at representative widths and 200% text",
);

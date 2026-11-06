import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, menuStub, root } from "./helpers/host-bundle.mjs";

const temporary = mkdtempSync(
	join(root, "packages/standalone/node_modules/.menu-state-matrix-"),
);
after(() => rmSync(temporary, { recursive: true, force: true }));
const output = join(temporary, "menu.mjs");
await build({
	entryPoints: [join(root, "packages/standalone/src/native-menu.ts")],
	outfile: output,
	bundle: true,
	format: "esm",
	platform: "node",
	plugins: [
		{
			name: "native-menu-boundary",
			setup(builder) {
				builder.onResolve({ filter: /^@tauri-apps\/api\/menu$/ }, () => ({
					path: "menu",
					namespace: "boundary",
				}));
				builder.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({
					contents: menuStub,
				}));
			},
		},
	],
});
const { installNativeMenu } = await import(pathToFileURL(output).href);

// Preview tests pin Fit/Connections for A-E. These four literal rows cover
// every pair of those inputs through the production menu's commandEnabled path.
const states = [
	{ fit: false, connections: false, viewEnabled: false, diagramEnabled: false },
	{ fit: false, connections: true, viewEnabled: false, diagramEnabled: true },
	{ fit: true, connections: false, viewEnabled: true, diagramEnabled: false },
	{ fit: true, connections: true, viewEnabled: true, diagramEnabled: true },
];
const operations = [
	{
		name: "view commands",
		expected: "viewEnabled",
		commands: ["fit-graph", "actual-size", "zoom-in", "zoom-out"],
	},
	{
		name: "Connections and Export",
		expected: "diagramEnabled",
		commands: ["node-actions-toggle"],
		exports: true,
	},
];
for (const state of states) {
	for (const operation of operations) {
		test(`native menu matrix: Fit=${state.fit}, Connections=${state.connections}, ${operation.name}`, async () => {
			globalThis.reviewMenuItems = [];
			let menu;
			try {
				menu = await installNativeMenu(
					() => {},
					() => {},
					assert.fail,
				);
				menu.update({
					busy: false,
					document: true,
					save: true,
					folder: false,
					sidebar: false,
					diagramView: state.fit,
					diagram: state.connections,
					definition: false,
				});
				for (let i = 0; i < 500; i++) await Promise.resolve();
				const commands = [...operation.commands];
				if (operation.exports) {
					const exports = globalThis.reviewMenuItems.filter((item) =>
						item.id?.startsWith("pfdsl.export."),
					);
					assert.ok(exports.length > 0);
					commands.push(...exports.map((item) => item.id));
				}
				for (const id of commands) {
					const item = globalThis.reviewMenuItems.find(
						(item) => item.id === id,
					);
					assert.ok(item, id);
					assert.equal(item.enabled, state[operation.expected], id);
				}
			} finally {
				menu?.dispose();
				delete globalThis.reviewMenuItems;
			}
		});
	}
}

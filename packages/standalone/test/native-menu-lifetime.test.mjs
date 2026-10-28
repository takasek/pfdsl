import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, root } from "./helpers/host-bundle.mjs";

const temp = mkdtempSync(
	join(root, "packages/standalone/node_modules/.menu-lifetime-"),
);
after(() => rmSync(temp, { recursive: true, force: true }));
const fixture = join(
	root,
	"packages/standalone/test/helpers/native-menu-fixture.mjs",
);
await build({
	entryPoints: {
		menu: join(root, "packages/standalone/src/native-menu.ts"),
		fixture,
	},
	outdir: temp,
	bundle: true,
	splitting: true,
	format: "esm",
	platform: "node",
	outExtension: { ".js": ".mjs" },
	plugins: [
		{
			name: "native-menu-boundary",
			setup(builder) {
				builder.onResolve({ filter: /^@tauri-apps\/api\/menu$/ }, () => ({
					path: fixture,
				}));
			},
		},
	],
});
const { installNativeMenu } = await import(
	pathToFileURL(join(temp, "menu.mjs")).href
);
const { items, holdNextCreation } = await import(
	pathToFileURL(join(temp, "fixture.mjs")).href
);
const flush = async () => {
	for (let i = 0; i < 500; i++) await Promise.resolve();
};

test("a menu resource arriving after aborted installation is closed without installing a menu", async () => {
	const start = items.length,
		controller = new AbortController();
	const release = holdNextCreation();
	const pending = installNativeMenu(
		() => assert.fail("late command"),
		() => assert.fail("late recent"),
		() => {},
		controller.signal,
	);
	controller.abort();
	release();
	await assert.rejects(pending, /disposed/);
	assert.ok(items.length > start);
	assert.ok(
		items.slice(start).every((item) => item.closed === 1 && !item.installed),
	);
});

test("disposing a mounted menu closes each item once and suppresses subsequent commands and updates", async () => {
	const start = items.length,
		actions = [];
	const menu = await installNativeMenu(
		(command) => actions.push(command),
		(target) => actions.push(target),
		() => {},
	);
	menu.recent([{ kind: "file", path: "/first.pfdsl" }]);
	await flush();
	menu.recent([{ kind: "file", path: "/second.pfdsl" }]);
	await flush();
	menu.dispose();
	menu.dispose();
	await flush();
	const owned = items.slice(start),
		writes = owned.flatMap((item) => item.writes).length;
	assert.ok(owned.every((item) => item.closed === 1));
	for (const item of owned) item.action?.();
	menu.update({
		busy: false,
		document: true,
		save: true,
		folder: true,
		sidebar: true,
		diagram: true,
		definition: true,
	});
	menu.recent([{ kind: "file", path: "/late.pfdsl" }]);
	await flush();
	assert.deepEqual(actions, []);
	assert.equal(items.length, start + owned.length);
	assert.equal(owned.flatMap((item) => item.writes).length, writes);
});

test("disposal during a recent-item read prevents later removals, creation and double closes", async () => {
	const start = items.length;
	const menu = await installNativeMenu(
		() => {},
		() => {},
		() => {},
	);
	menu.recent([{ kind: "file", path: "/first.pfdsl" }]);
	await flush();
	const recent = items.slice(start).find((item) => item.text === "Recent");
	const previous = [...recent.children];
	let release;
	recent.items = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	let removals = 0;
	recent.remove = async () => {
		removals++;
	};
	menu.recent([{ kind: "file", path: "/late.pfdsl" }]);
	await flush();
	assert.equal(typeof release, "function");
	menu.dispose();
	const count = items.length;
	release(previous);
	await flush();
	assert.equal(removals, 0);
	assert.equal(items.length, count);
	assert.ok(items.slice(start).every((item) => item.closed === 1));
});

test("late items() resource handles are released even when installation resources were already disposed", async () => {
	const start = items.length;
	const menu = await installNativeMenu(
		() => {},
		() => {},
		() => {},
	);
	const recent = items.slice(start).find((item) => item.text === "Recent");
	let release,
		closes = 0;
	recent.items = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	menu.recent([{ kind: "file", path: "/late.pfdsl" }]);
	await flush();
	menu.dispose();
	release([
		{
			async close() {
				closes++;
			},
		},
	]);
	await flush();
	assert.equal(closes, 1);
});

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { bundleHost, JSDOM, root } from "./helpers/host-bundle.mjs";

test("reference adoption retains pending handles and rejects invalidation during hard-link inspection", async (t) => {
	const temp = mkdtempSync(
		join(root, "packages/standalone/node_modules/.reference-host-"),
	);
	try {
		const output = join(temp, "main.mjs");
		await bundleHost(output);
		const {
			mountApplication,
			createDocumentTab,
			createTextComparison,
			createTestMenu,
		} = await import(pathToFileURL(output).href);
		for (const invalidation of ["switch", "close", "revision", "none"])
			await t.test(invalidation, async () => {
				const dom = new JSDOM(
					readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
				);
				const document = dom.window.document;
				const tabs = [];
				const openTabs = () => tabs.filter((tab) => tab.button.isConnected);
				const activeTab = () =>
					openTabs().find(
						(tab) => tab.button.getAttribute("aria-selected") === "true",
					);
				const calls = [];
				let finish;
				const original = {
					id: 1,
					path: "/A/a.pfdsl",
					binding: "dir:a.pfdsl",
					identity: "inodeA",
					source: "a >> p -> b",
					revision: "v1",
				};
				const alias = {
					...original,
					id: 2,
					path: "/A/alias.pfdsl",
					binding: "dir:alias.pfdsl",
				};
				const invoke = async (command, args) => {
					calls.push({ command, args });
					if (command === "document_capabilities")
						return { save: true, reason: null };
					if (command === "list_recent") return [];
					if (
						[
							"remember_document",
							"release_document",
							"exit_listener_ready",
						].includes(command)
					)
						return;
					if (command === "select_document") return original;
					if (command === "open_reference") return alias;
					if (command === "read_dependency") return "dependency";
					if (command === "inspect_document")
						return finish
							? original
							: new Promise((resolve) => {
									finish = resolve;
								});
					throw new Error(`Unexpected native command: ${command}`);
				};
				let menu;
				const application = mountApplication({
					document,
					createDocumentTab(options) {
						const tab = createDocumentTab(options);
						tabs.push(tab);
						return tab;
					},
					createTextComparison,
					scheduler: { setInterval: () => 0, clearInterval() {} },
					native: {
						invoke,
						listen: async () => () => {},
						verifyCorpus: async () => null,
						installMenu: async (command, recent) => {
							menu = createTestMenu(command, recent);
							return menu;
						},
						setTitle: async () => {},
						closeWindow: async () => {},
					},
				});
				// Let the deliberately held native read begin without awaiting its completion.
				const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
				try {
					await application.command("new");
					const openFile = menu.items.find((item) => item.id === "open-file");
					assert.equal(openFile.enabled, true);
					openFile.action();
					await application.idle();
					const origin = activeTab();
					let current = true;
					const pending = origin.references.open(
						{ kind: "path", value: alias.path },
						() => current,
					);
					await nextTurn();
					assert.equal(typeof finish, "function");
					if (invalidation === "switch") {
						openTabs()
							.find((tab) => tab !== origin)
							.button.click();
						current = false; // The real tab controller invalidates its generation on deactivation.
					}
					if (invalidation === "close")
						origin.button.parentElement
							.querySelector(".close-document")
							.click();
					if (invalidation === "revision") current = false;
					// A new untitled document also runs the usual handle sweep through a no-op close.
					const spare = openTabs().find((tab) => tab !== origin);
					spare.button.parentElement.querySelector(".close-document").click();
					await nextTurn();
					const prematureRelease = calls.filter(
						(c) => c.command === "release_document" && c.args.id === 2,
					).length;
					finish(original);
					await pending;
					await nextTurn();
					assert.equal(
						prematureRelease,
						0,
						"a pending snapshot is owned until adoption finishes",
					);
					const adopted = openTabs().find((tab) => tab.location === alias.path);
					assert.equal(!!adopted, invalidation === "none");
					if (adopted) {
						await adopted.read("/A/preset.yaml");
						assert.deepEqual(calls.at(-1), {
							command: "read_dependency",
							args: { id: 2, path: "/A/preset.yaml" },
						});
					}
					assert.equal(
						calls.filter(
							(c) => c.command === "release_document" && c.args.id === 2,
						).length,
						invalidation === "none" ? 0 : 1,
					);
				} finally {
					application.dispose();
					dom.window.close();
				}
			});
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});

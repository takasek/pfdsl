import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { bundleHost, JSDOM, root } from "./helpers/host-bundle.mjs";

test("reference adoption retains pending handles and rejects invalidation during hard-link inspection", async (t) => {
	const keys = [
		"document",
		"window",
		"self",
		"setInterval",
		"nativeInvoke",
		"nativeListen",
		"nativeAcceptance",
		"reviewEntries",
		"reviewActive",
		"reviewBusy",
		"reviewTabs",
	];
	const old = new Map(
		keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
	);
	const temp = mkdtempSync(
		join(root, "packages/standalone/node_modules/.reference-host-"),
	);
	try {
		const output = join(temp, "main.mjs");
		await bundleHost(output);
		for (const invalidation of ["switch", "close", "revision", "none"])
			await t.test(invalidation, async () => {
				const dom = new JSDOM(
					readFileSync(`${root}/packages/standalone/index.html`, "utf8"),
				);
				globalThis.document = dom.window.document;
				globalThis.window = dom.window;
				globalThis.self = dom.window;
				globalThis.setInterval = () => 0;
				dom.window.__TAURI_INTERNALS__ = {};
				globalThis.nativeAcceptance = () => new Promise(() => {});
				globalThis.nativeListen = async () => () => {};
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
				globalThis.nativeInvoke = async (command, args) => {
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
					if (command === "inspect_document")
						return finish
							? original
							: new Promise((resolve) => {
									finish = resolve;
								});
					throw new Error(`Unexpected native command: ${command}`);
				};
				const flush = async () => {
					for (let i = 0; i < 100; i++) await Promise.resolve();
				};
				try {
					await import(`${pathToFileURL(output).href}?${invalidation}`);
					document.querySelector("#open-file").click();
					await flush();
					const origin = reviewActive();
					let current = true;
					const pending = origin.tab.references.open(
						{ kind: "path", value: alias.path },
						() => current,
					);
					await flush();
					assert.equal(typeof finish, "function");
					if (invalidation === "switch") {
						[...reviewEntries].find((e) => e !== origin).tab.button.click();
						current = false; // The real tab controller invalidates its generation on deactivation.
					}
					if (invalidation === "close")
						origin.navigation.querySelector(".close-document").click();
					if (invalidation === "revision") current = false;
					// A new untitled document also runs the usual handle sweep through a no-op close.
					const spare = [...reviewEntries].find((e) => e !== origin);
					spare.navigation.querySelector(".close-document").click();
					await flush();
					const prematureRelease = calls.filter(
						(c) => c.command === "release_document" && c.args.id === 2,
					).length;
					finish(original);
					await pending;
					await flush();
					assert.equal(
						prematureRelease,
						0,
						"a pending snapshot is owned until adoption finishes",
					);
					const adopted = [...reviewEntries].find((e) =>
						e.session.usesDocument(2),
					);
					assert.equal(!!adopted, invalidation === "none");
					assert.equal(
						calls.filter(
							(c) => c.command === "release_document" && c.args.id === 2,
						).length,
						invalidation === "none" ? 0 : 1,
					);
				} finally {
					dom.window.close();
				}
			});
	} finally {
		for (const [key, descriptor] of old) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
		rmSync(temp, { recursive: true, force: true });
	}
});

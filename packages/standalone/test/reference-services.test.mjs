import assert from "node:assert/strict";
import test from "node:test";
import { createNativeReferenceServices } from "../src/reference-services.ts";

test("native reference facade binds current document IDs and releases results after closure", async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
	const calls = [],
		opened = [];
	let id = 1,
		available = true,
		finish;
	globalThis.window = {
		__TAURI_INTERNALS__: {
			invoke(command, args) {
				calls.push({ command, args });
				if (command === "open_reference")
					return new Promise((resolve) => {
						finish = resolve;
					});
				return Promise.resolve(
					command === "choose_comparison" ? null : "/work/a.pfdsl",
				);
			},
		},
	};
	try {
		const service = createNativeReferenceServices(
			() => id,
			() => available,
			async (snapshot, isCurrent) => {
				if (isCurrent()) opened.push(snapshot);
				else
					await window.__TAURI_INTERNALS__.invoke("release_document", {
						id: snapshot.id,
					});
			},
		);
		await service.context();
		assert.equal(calls.at(-1).args.id, 1);
		id = 2;
		await service.context();
		assert.equal(calls.at(-1).args.id, 2);
		const pending = service.open({ kind: "path", value: "/outside/b.pfdsl" });
		available = false;
		finish({ id: 40, path: "/outside/b.pfdsl" });
		await pending;
		assert.deepEqual(calls.at(-1), {
			command: "release_document",
			args: { id: 40 },
		});
		assert.deepEqual(opened, []);
		available = true;
		let current = true;
		const superseded = service.open(
			{ kind: "path", value: "/outside/old.pfdsl" },
			() => current,
		);
		current = false;
		finish({ id: 41, path: "/outside/old.pfdsl" });
		await superseded;
		assert.deepEqual(
			opened,
			[],
			"a newer reference or editor revision invalidates an in-flight native open",
		);
		assert.deepEqual(calls.at(-1), {
			command: "release_document",
			args: { id: 41 },
		});
		id = undefined;
		await assert.rejects(
			service.compareGit("HEAD"),
			/Save.*File comparison remains available/,
		);
		assert.equal(await service.compareFile(), null);
		assert.equal(calls.at(-1).command, "choose_comparison");
		await service.run("echo 日本語\nprintf done", "/work/space dir", "ghostty");
		assert.deepEqual(calls.at(-1), {
			command: "run_process",
			args: {
				id: null,
				command: "echo 日本語\nprintf done",
				cwd: "/work/space dir",
				terminal: "ghostty",
			},
		});
	} finally {
		if (previous) Object.defineProperty(globalThis, "window", previous);
		else delete globalThis.window;
	}
});

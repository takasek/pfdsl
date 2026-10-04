import { expect, it } from "vitest";

it("preserves the extension's compatibility imports as shared module bindings", async () => {
	const modules = [
		"connector-logic",
		"def-insertion-logic",
		"diff-panel",
		"format-logic",
		"jump-logic",
		"location-utils",
		"messages",
		"svg-anchors",
		"webview-logic",
	];
	for (const name of modules) {
		const adapter = await import(`./${name}.ts`);
		const shared = await import(`@pfdsl/editor/${name}`);
		expect(Object.keys(adapter).sort()).toEqual(Object.keys(shared).sort());
		for (const key of Object.keys(shared))
			expect(adapter[key]).toBe(shared[key]);
	}
});

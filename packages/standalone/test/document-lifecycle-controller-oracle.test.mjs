import assert from "node:assert/strict";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createHarness } from "./helpers/lifecycle-controller-harness.mjs";
import { beginAction, checkAction } from "./helpers/lifecycle-invariants.mjs";
import { FakeNative } from "./helpers/lifecycle-native.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const forged = "fabricated disk content";

// Corrupt the production decision payload after the native boundary recorded it.
// A failed write cannot reveal this through the unreviewed-overwrite invariant R.
for (const mode of ["selected", "inspected"]) {
	const sourceRoot = mkdtempSync(
		join(root, "packages/standalone/node_modules/.oracle-source-"),
	);
	const directory = join(sourceRoot, "packages/standalone/src");
	mkdirSync(directory, { recursive: true });
	for (const name of [
		"document-session.ts",
		"document-records.ts",
		"save-as-controller.ts",
		"workspace-controller.ts",
	])
		copyFileSync(
			join(root, "packages/standalone/src", name),
			join(directory, name),
		);
	const path = join(directory, "workspace-controller.ts");
	const source = readFileSync(path, "utf8");
	const before =
		mode === "selected"
			? "decisions.request(request, signal)"
			: "target: Object.freeze({ ...selected }),";
	const replacement =
		mode === "selected"
			? `decisions.request({ ...request, target: { ...request.target, source: ${JSON.stringify(forged)} } }, signal)`
			: `target: Object.freeze({ ...selected, source: ${JSON.stringify(forged)} }),`;
	assert.equal(
		source.split(before).length - 1,
		1,
		`${mode}: one decision payload mutation`,
	);
	writeFileSync(
		path,
		source.replace(before, () => replacement),
	);
	after(() => rmSync(sourceRoot, { recursive: true, force: true }));
	const { startHost } = await createHarness(`oracle-${mode}`, { sourceRoot });
	for (const outcome of ["reply-lost", "save-failed"])
		test(`controller oracle A | forged ${mode} content | ${outcome}`, async () => {
			const native = new FakeNative();
			const original = native.add(1, "a.pfdsl", "original text");
			const candidate = native.add(2, "b.pfdsl", "native target text");
			const target = mode === "selected" ? candidate : original;
			const host = await startHost(native, original, {
				choose: () => native.snapshot(candidate),
				saveFault: () => (outcome === "reply-lost" ? "before" : undefined),
				saveReply: () =>
					outcome === "save-failed"
						? {
								outcome: "failed-before-publication",
								current: native.snapshot(target),
								message: "The native write failed.",
								publication: "not-published",
								targetState: "readable",
							}
						: undefined,
			});
			try {
				const tab = await host.open(original);
				tab.type("local editor text");
				if (mode === "inspected") original.file.source = "native target text";
				const trace = beginAction({ host, tab, owned: [original.id] });
				if (mode === "selected") await host.saveAs();
				else await host.save();
				const review = host.log.find((entry) => entry.kind === "dialog");
				const saves = host.log.filter((entry) => entry.kind === "save");
				assert.equal(review.disk, forged);
				assert.equal(saves.length, 1);
				assert.equal(saves[0].wrote, false);
				assert.equal(target.writes, 0);
				const violations = [];
				checkAction({
					native,
					host,
					tab,
					trace,
					violate: (tag, detail) => violations.push(`${tag}: ${detail}`),
				});
				assert.ok(
					violations.some(
						(item) =>
							item.startsWith("A:") && item.includes("inspection returned"),
					),
					JSON.stringify(violations),
				);
			} finally {
				await host.finish();
			}
		});
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("reference acceptance with the published 0.2.0 and candidate CLIs", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "pfdsl-reference-distribution-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const published = join(
		root,
		"scripts/__fixtures__/published-cli/node_modules/@pfdsl/cli/dist/cli.js",
	);
	const candidate = join(root, "packages/cli/dist/cli.js");
	const run = (cli, args) =>
		spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" });

	const local =
		"---\ntype: workflow\nartifact:\n  a: { location: receipt.txt }\n---\na >> work -> b\n";
	const ref = "baseRef: { source: repository, revision: other }";
	writeFileSync(
		join(dir, "model.pfdsl"),
		local.replace("artifact:", `${ref}\nartifact:`),
	);
	writeFileSync(join(dir, "local.pfdsl"), local);
	const localFile = join(dir, "receipt.txt");
	writeFileSync(localFile, "local copy");
	const target = join(dir, "snapshot");
	mkdirSync(target);
	const basis = join(dir, "basis");
	mkdirSync(basis);
	const context = {
		adapter: "fixture",
		model: {
			source: "model",
			fixedRevision: "M",
			documentId: "model.pfdsl",
			extractionId: "whole-file",
		},
		logicalPath: "model.pfdsl",
		basis: { source: "repository", fixedRevision: "B", root: basis },
		targets: [
			{
				source: "repository",
				revision: "other",
				fixedRevision: "R",
				root: target,
			},
		],
	};
	writeFileSync(join(dir, "context.json"), JSON.stringify(context));

	await t.test(
		"a local namesake passes the published check but cannot resolve an explicit reference",
		() => {
			const args = ["meta", "check-links", "model.pfdsl", "--json"];
			const legacy = run(published, args);
			assert.equal(legacy.status, 0, legacy.stderr);
			assert.deepEqual(JSON.parse(legacy.stdout), { ok: true, missing: [] });
			const current = run(candidate, args);
			assert.equal(current.status, 1, current.stderr);
			assert.ok(
				JSON.parse(current.stdout).failures.some(
					({ id, reason }) => id === "a" && reason === "unsupported",
				),
			);
		},
	);

	await t.test(
		"ordinary documents retain local link checking with both CLIs",
		() => {
			for (const cli of [published, candidate]) {
				const result = run(cli, [
					"meta",
					"check-links",
					"local.pfdsl",
					"--json",
				]);
				assert.equal(result.status, 0, result.stderr);
				assert.deepEqual(JSON.parse(result.stdout), { ok: true, missing: [] });
			}
		},
	);

	await t.test(
		"the CLI package's linked guide checks paths in the pinned basis without explicit references",
		() => {
			writeFileSync(join(dir, "extracted.pfdsl"), local);
			const plain = run(candidate, [
				"meta",
				"check-links",
				"extracted.pfdsl",
				"--json",
			]);
			assert.equal(plain.status, 0, plain.stderr);
			const docPath = "docs/reference-resolution.md";
			const readme = readFileSync(join(root, "packages/cli/README.md"), "utf8");
			assert.ok(
				readme.includes(
					`](https://github.com/takasek/pfdsl/blob/main/${docPath})`,
				),
				"the npm README should link to the reference acceptance guide",
			);
			const guide = readFileSync(join(root, docPath), "utf8");
			const command = guide.match(
				/^pfdsl meta check-links extracted\.pfdsl .*$/m,
			)?.[0];
			assert.ok(
				command,
				"the linked guide must provide an executable reference check",
			);
			const args = command.split(/\s+/).slice(1);
			const missing = run(candidate, args);
			assert.equal(missing.status, 1, missing.stdout + missing.stderr);
			const absent = JSON.parse(
				missing.stdout,
			).referenceResolution.results.find(({ id }) => id === "a");
			assert.equal(absent.reason, "target-missing");

			const receiptDir = join(basis, "receipt.txt");
			mkdirSync(receiptDir);
			const present = run(candidate, args);
			assert.equal(present.status, 0, present.stderr);
			const receipt = JSON.parse(
				present.stdout,
			).referenceResolution.results.find(({ id }) => id === "a");
			assert.equal(receipt.result, "exists");
			assert.equal(receipt.source, context.basis.source);
			assert.equal(receipt.fixedRevision, context.basis.fixedRevision);
			assert.equal(receipt.value, receiptDir);
			assert.equal(statSync(receipt.value).isFile(), false);
		},
	);

	await t.test(
		"the distributed skill's reference check verifies the selected snapshot",
		() => {
			const skill = readFileSync(
				join(root, "generated/skills/pfdsl/SKILL.md"),
				"utf8",
			);
			const command = skill.match(
				/^pfdsl meta check-links model\.pfdsl .*$/m,
			)?.[0];
			assert.ok(
				command,
				"the distributed skill must provide an executable reference check",
			);
			const args = command.split(/\s+/).slice(1);
			const legacy = run(published, args);
			assert.equal(legacy.status, 2, legacy.stdout + legacy.stderr);
			assert.match(legacy.stderr, /unknown option.*--reference-context/i);

			const absent = run(candidate, args);
			assert.equal(absent.status, 1, absent.stderr);
			const missing = JSON.parse(
				absent.stdout,
			).referenceResolution.results.find(({ id }) => id === "a");
			assert.equal(missing.reason, "target-missing");
			assert.equal(missing.result, "failed");

			rmSync(localFile);
			writeFileSync(join(target, "receipt.txt"), "pinned copy");
			const present = run(candidate, args);
			assert.equal(present.status, 0, present.stderr);
			const report = JSON.parse(present.stdout);
			assert.equal(report.ok, true);
			const receipt = report.referenceResolution.results.find(
				({ id }) => id === "a",
			);
			assert.deepEqual(receipt.reference, {
				source: "repository",
				revision: "other",
			});
			assert.equal(receipt.source, "repository");
			assert.equal(receipt.fixedRevision, "R");
			assert.equal(receipt.location, "receipt.txt");
			assert.equal(receipt.result, "exists");
		},
	);
});

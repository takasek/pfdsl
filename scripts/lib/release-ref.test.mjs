import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseReleaseRef, validateReleaseRef } from "./release-ref.mjs";

describe("parseReleaseRef", () => {
	it("accepts an exact tag ref and returns its version", () => {
		assert.deepEqual(parseReleaseRef("refs/tags/v0.0.21", "v"), {
			tag: "v0.0.21",
			version: "0.0.21",
		});
	});

	it("rejects a branch or a tag with another prefix", () => {
		assert.throws(() => parseReleaseRef("refs/heads/main", "v"), /tag ref/);
		assert.throws(
			() => parseReleaseRef("refs/tags/lib-v0.0.21", "v"),
			/prefix/,
		);
	});
});

describe("validateReleaseRef", () => {
	it("requires all library package versions to match the tag", () => {
		assert.equal(
			validateReleaseRef({
				event: "push",
				ref: "refs/tags/lib-v0.0.8",
				tag: "lib-v0.0.8",
				packageVersions: ["0.0.8", "0.0.8", "0.0.8"],
			}),
			null,
		);
		assert.match(
			validateReleaseRef({
				event: "push",
				ref: "refs/tags/lib-v0.0.8",
				tag: "lib-v0.0.8",
				packageVersions: ["0.0.8", "0.0.7", "0.0.8"],
			}),
			/package versions do not match/,
		);
	});

	it("rejects workflow dispatch from a branch even when a tag input is supplied", () => {
		assert.match(
			validateReleaseRef({
				event: "workflow_dispatch",
				ref: "refs/heads/main",
				tag: "v0.0.21",
				packageVersions: ["0.0.21"],
			}),
			/tag ref/,
		);
	});

	it("requires the manual tag input to identify the checked out tag", () => {
		assert.match(
			validateReleaseRef({
				event: "workflow_dispatch",
				ref: "refs/tags/v0.0.21",
				tag: "v0.0.20",
				packageVersions: ["0.0.21"],
			}),
			/match the checked out ref/,
		);
	});

	it("keeps manual dispatch tagless and checks out the event SHA", () => {
		const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
		for (const workflow of ["publish-cli.yml", "publish-libraries.yml"]) {
			const source = readFileSync(
				resolve(root, ".github/workflows", workflow),
				"utf8",
			);
			assert.doesNotMatch(source, /workflow_dispatch:\n\s+inputs:/);
			assert.match(source, /ref: \$\{\{ github\.sha \}\}/);
			assert.match(source, /refs\/tags\/\$RELEASE_TAG/);
		}
	});
});

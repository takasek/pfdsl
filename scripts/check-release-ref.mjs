#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_KINDS } from "./lib/release-config.mjs";
import { validateReleaseRef } from "./lib/release-ref.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kindArg = process.argv[2];
const kind = RELEASE_KINDS[kindArg];
if (!kind || process.argv.length !== 3) {
	console.error("usage: node scripts/check-release-ref.mjs <cli|libs>");
	process.exit(2);
}

const event = process.env.RELEASE_EVENT ?? "";
const ref = process.env.RELEASE_REF ?? "";
const tag = process.env.RELEASE_TAG ?? "";
const versions = kind.packages.map(
	(relativePath) =>
		JSON.parse(readFileSync(resolve(root, relativePath), "utf8")).version,
);
const problem = validateReleaseRef({
	event,
	ref,
	tag,
	packageVersions: versions,
	prefix: kind.tagPrefix,
});
if (problem) {
	console.error(`error: ${problem}`);
	process.exit(1);
}
console.log(
	`release ref ${tag} matches ${kindArg} package version ${versions[0]}`,
);

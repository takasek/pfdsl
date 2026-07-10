import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
	RELEASE_KINDS,
	bumpVersionInPackageJson,
	tagName,
	pinMarketplaceSourceToTag,
	filesToCommitForBump,
} from "./release-config.mjs";

test("RELEASE_KINDS has the three known kinds with distinct tag prefixes", () => {
	assert.deepEqual(Object.keys(RELEASE_KINDS).sort(), ["cli", "libs", "vscode"]);
	const prefixes = Object.values(RELEASE_KINDS).map((k) => k.tagPrefix);
	assert.equal(new Set(prefixes).size, prefixes.length);
});

test("cli kind targets packages/cli/package.json and watches publish-cli.yml", () => {
	assert.deepEqual(RELEASE_KINDS.cli.packages, ["packages/cli/package.json"]);
	assert.equal(RELEASE_KINDS.cli.tagPrefix, "v");
	assert.equal(RELEASE_KINDS.cli.workflow, "publish-cli.yml");
});

test("libs kind targets the three library packages and watches publish-libraries.yml", () => {
	assert.deepEqual(RELEASE_KINDS.libs.packages, [
		"packages/core/package.json",
		"packages/graphviz-exporter/package.json",
		"packages/preview-engine/package.json",
	]);
	assert.equal(RELEASE_KINDS.libs.tagPrefix, "lib-v");
	assert.equal(RELEASE_KINDS.libs.workflow, "publish-libraries.yml");
});

test("vscode kind has no GHA workflow to watch (local vsce packaging instead)", () => {
	assert.deepEqual(RELEASE_KINDS.vscode.packages, ["packages/vscode-extension/package.json"]);
	assert.equal(RELEASE_KINDS.vscode.tagPrefix, "vscode-v");
	assert.equal(RELEASE_KINDS.vscode.workflow, null);
});

test("bumpVersionInPackageJson rewrites only the version field, preserving key order and trailing newline", () => {
	const before = '{\n\t"name": "@pfdsl/cli",\n\t"version": "0.0.17",\n\t"type": "module"\n}\n';
	const after = bumpVersionInPackageJson(before, "0.0.18");
	assert.equal(
		after,
		'{\n\t"name": "@pfdsl/cli",\n\t"version": "0.0.18",\n\t"type": "module"\n}\n',
	);
});

test("tagName concatenates prefix and version", () => {
	assert.equal(tagName(RELEASE_KINDS.cli, "0.0.18"), "v0.0.18");
	assert.equal(tagName(RELEASE_KINDS.libs, "0.0.3"), "lib-v0.0.3");
	assert.equal(tagName(RELEASE_KINDS.vscode, "0.0.14"), "vscode-v0.0.14");
});

test("pinMarketplaceSourceToTag replaces a bare relative-path source with a tag-pinned git-subdir source", () => {
	const before = `{
	"name": "pfdsl",
	"plugins": [
		{
			"name": "pfdsl",
			"description": "desc",
			"source": "./plugin/pfdsl"
		}
	]
}
`;
	const after = pinMarketplaceSourceToTag(before, "v0.0.19");
	assert.deepEqual(JSON.parse(after).plugins[0].source, {
		source: "git-subdir",
		url: "https://github.com/takasek/pfdsl.git",
		path: "plugin/pfdsl",
		ref: "v0.0.19",
	});
});

test("pinMarketplaceSourceToTag updates ref on an already-pinned source", () => {
	const before = `{
	"plugins": [
		{
			"name": "pfdsl",
			"source": {
				"source": "git-subdir",
				"url": "https://github.com/takasek/pfdsl.git",
				"path": "plugin/pfdsl",
				"ref": "v0.0.18"
			}
		}
	]
}
`;
	const after = pinMarketplaceSourceToTag(before, "v0.0.19");
	assert.equal(JSON.parse(after).plugins[0].source.ref, "v0.0.19");
});

test("pinMarketplaceSourceToTag preserves tab indentation and trailing newline", () => {
	const before = '{\n\t"plugins": [\n\t\t{ "name": "pfdsl", "source": "./plugin/pfdsl" }\n\t]\n}\n';
	const after = pinMarketplaceSourceToTag(before, "v0.0.19");
	assert.match(after, /\n$/);
	assert.match(after, /\t"plugins"/);
});

test("filesToCommitForBump includes plugin/pfdsl for cli releases, since gen-plugin mirrors packages/cli/package.json's version", () => {
	assert.deepEqual(filesToCommitForBump("cli", RELEASE_KINDS.cli), ["packages/cli/package.json", "plugin"]);
});

test("filesToCommitForBump excludes plugin/pfdsl for libs and vscode releases, which don't touch the cli version", () => {
	assert.deepEqual(filesToCommitForBump("libs", RELEASE_KINDS.libs), RELEASE_KINDS.libs.packages);
	assert.deepEqual(filesToCommitForBump("vscode", RELEASE_KINDS.vscode), RELEASE_KINDS.vscode.packages);
});

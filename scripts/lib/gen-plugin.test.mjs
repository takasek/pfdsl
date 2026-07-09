import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildPluginManifest } from "./gen-plugin.mjs";

describe("buildPluginManifest", () => {
	it("uses the CLI version as the plugin version", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.version, "0.0.18");
	});

	it("names the plugin pfdsl", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.name, "pfdsl");
	});

	it("declares the MIT license", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.license, "MIT");
	});
});

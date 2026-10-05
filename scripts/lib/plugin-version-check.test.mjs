import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
	computeManifestAggregateHash,
	readPluginIdentity,
} from "../../.claude/skills/pfd-ops/scripts/plugin-version-check.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "plugin-version-check-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

function hexOf(seed) {
	return createHash("sha256").update(seed).digest("hex");
}

/** @param {{path: string, hex: string}[]} entries */
function manifestText(entries) {
	return `${entries.map(({ hex, path }) => `${hex}  ${path}`).join("\n\n")}\n`;
}

describe("computeManifestAggregateHash", () => {
	it("matches the pre-#1264 aggregate definition: sha256 of path + \\0 + hex + \\n per entry, in path order", () => {
		const entries = [
			{ path: "a.md", hex: hexOf("a") },
			{ path: "b.md", hex: hexOf("b") },
		];
		const text = manifestText(entries);
		const expected = createHash("sha256");
		for (const { path, hex } of entries) {
			expected.update(path);
			expected.update("\0");
			expected.update(hex);
			expected.update("\n");
		}
		assert.equal(computeManifestAggregateHash(text), expected.digest("hex"));
	});

	// A plugin cache cloned with core.autocrlf=true holds the manifest with CRLF
	// line endings; the digests it records are unchanged, so it still identifies
	// the same bundle as the LF text served from upstream.
	it("gives CRLF text the same aggregate as the LF text it was converted from", () => {
		const text = manifestText([
			{ path: "a.md", hex: hexOf("a") },
			{ path: "b.md", hex: hexOf("b") },
		]);
		const aggregate = computeManifestAggregateHash(text);
		assert.notEqual(aggregate, null);
		assert.equal(
			computeManifestAggregateHash(text.replaceAll("\n", "\r\n")),
			aggregate,
		);
	});

	it("returns null for an empty manifest", () => {
		assert.equal(computeManifestAggregateHash(""), null);
	});

	it("returns null for a manifest with a non-blank separator line", () => {
		const bad = `${hexOf("a")}  a.md\nnot blank\n${hexOf("b")}  b.md\n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null for a duplicate path", () => {
		const hex = hexOf("a");
		const bad = `${hex}  a.md\n\n${hex}  a.md\n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null for an empty path", () => {
		const bad = `${hexOf("a")}  \n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null when the digest is not 64 lowercase hex characters", () => {
		const bad = "not-hex-at-all-and-way-too-short  a.md\n";
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null when the digest and path are not separated by two spaces", () => {
		const bad = `${hexOf("a")} a.md\n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});
});

describe("readPluginIdentity", () => {
	it("reads the version and bundle aggregate hash of a Claude Code plugin", () => {
		const pluginRoot = join(tmp, "claude-plugin-root");
		const text = manifestText([{ hex: hexOf("a"), path: "a.md" }]);
		writeFile(
			pluginRoot,
			".claude-plugin/plugin.json",
			JSON.stringify({ version: "0.2.0" }),
		);
		writeFile(pluginRoot, ".claude-plugin/bundle-manifest.sha256", text);

		assert.deepEqual(readPluginIdentity(pluginRoot), {
			version: "0.2.0",
			bundleHash: computeManifestAggregateHash(text),
		});
	});

	it("leaves the bundle hash null when the Claude Code plugin has no bundle manifest", () => {
		const pluginRoot = join(tmp, "claude-plugin-no-manifest");
		writeFile(
			pluginRoot,
			".claude-plugin/plugin.json",
			JSON.stringify({ version: "0.2.0" }),
		);

		assert.deepEqual(readPluginIdentity(pluginRoot), {
			version: "0.2.0",
			bundleHash: null,
		});
	});

	// The Codex plugin carries no bundle manifest, so its identity is the version alone.
	it("reads the version of a Codex plugin from .codex-plugin/plugin.json", () => {
		const pluginRoot = join(tmp, "codex-plugin-root");
		writeFile(
			pluginRoot,
			".codex-plugin/plugin.json",
			JSON.stringify({ version: "0.3.1" }),
		);

		assert.deepEqual(readPluginIdentity(pluginRoot), {
			version: "0.3.1",
			bundleHash: null,
		});
	});

	it("returns null when neither plugin manifest exists (repo-local run)", () => {
		const pluginRoot = join(tmp, "no-plugin");
		mkdirSync(pluginRoot, { recursive: true });

		assert.equal(readPluginIdentity(pluginRoot), null);
	});

	it("returns null when the manifest is unparsable or carries no usable version", () => {
		for (const [name, content] of [
			["not-json", "{"],
			["no-version", JSON.stringify({ name: "pfdsl" })],
			["numeric-version", JSON.stringify({ version: 1 })],
			["blank-version", JSON.stringify({ version: "  " })],
		]) {
			const pluginRoot = join(tmp, name);
			writeFile(pluginRoot, ".claude-plugin/plugin.json", content);
			assert.equal(readPluginIdentity(pluginRoot), null, name);
		}
	});
});

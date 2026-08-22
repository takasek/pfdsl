// The plugin bundle's content identifier (#971).
//
// plugin.json's version is derived from packages/cli/package.json, so it only
// moves on a CLI release — two bundles that differ by 93 commits still carry
// the same version string. This manifest gives the bundle an identifier that
// moves with its content instead, so a cached copy can tell "same release,
// different content" from "same bundle".
//
// It is a distribution-snapshot identifier, not a runtime integrity check: the
// consumer reads the recorded hash rather than recomputing it, so a cache whose
// files were edited after install still reports its generated-at hash. Nothing
// downstream treats this value as evidence that the cache is untampered.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BUNDLE_MANIFEST_RELATIVE_PATH =
	".claude-plugin/bundle-manifest.json";

/**
 * Enumerate every file under bundleRoot as bundle-relative, forward-slash
 * separated paths, sorted — except the manifest itself, whose exclusion is what
 * makes regenerating the bundle idempotent (the manifest lives inside the very
 * tree it describes, so including it would make each generation change the
 * input of the next, and the gen-plugin-bulk drift gate would fail on every
 * commit that touched nothing).
 * @param {string} bundleRoot
 * @returns {string[]}
 */
function listBundleFiles(bundleRoot) {
	const results = [];
	function walk(dir, relPrefix) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				walk(join(dir, entry.name), rel);
			} else if (rel !== BUNDLE_MANIFEST_RELATIVE_PATH) {
				results.push(rel);
			}
		}
	}
	walk(bundleRoot, "");
	return results.sort();
}

/**
 * Hash the bundle's content: every file's path and bytes, in a fixed order.
 * Paths are part of the digest so that moving a file changes the hash even
 * though the bytes are unchanged.
 *
 * Each file contributes its own fixed-length digest rather than its raw bytes.
 * Streaming the bytes straight into the outer hash would be cheaper, but the
 * separators would then be ambiguous: a file whose content happens to contain
 * the separator bytes followed by another path could produce the same stream as
 * a different set of files. A fixed-length digest per file removes that class.
 * @param {string} bundleRoot
 * @returns {string}
 */
export function computeBundleContentHash(bundleRoot) {
	const digest = createHash("sha256");
	for (const rel of listBundleFiles(bundleRoot)) {
		digest.update(rel);
		digest.update("\0");
		digest.update(
			createHash("sha256")
				.update(readFileSync(join(bundleRoot, rel)))
				.digest("hex"),
		);
		digest.update("\n");
	}
	return digest.digest("hex");
}

/**
 * Write the bundle's content identifier into the bundle. Called last in the
 * assembly, once every other bundled file is final.
 * @param {string} bundleRoot
 */
export function writeBundleManifest(bundleRoot) {
	const manifestPath = join(
		bundleRoot,
		...BUNDLE_MANIFEST_RELATIVE_PATH.split("/"),
	);
	mkdirSync(dirname(manifestPath), { recursive: true });
	const manifest = { contentHash: computeBundleContentHash(bundleRoot) };
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

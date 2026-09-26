// The plugin bundle's content identifier (#971, per-file format #1264).
//
// plugin.json's version is derived from packages/cli/package.json, so it only
// moves on a CLI release — two bundles that differ by 93 commits still carry
// the same version string. This manifest gives the bundle an identifier that
// moves with its content instead, so a cached copy can tell "same release,
// different content" from "same bundle".
//
// This file records one digest per bundled file, one per line, in
// bundle-relative path order — rather than a single aggregate line. Two PRs
// that touch different bundle files then merge this text cleanly as plain
// text, and the merged text is itself the correct manifest for the merged
// tree. A single aggregate line collided on every PR that touched the bundle
// (#1264). The aggregate identifier a consumer wants is now that consumer's
// own job — see plugin-version-check.mjs in the pfd-ops skill — computed over
// these same per-file digests, so it still equals what this module used to
// compute directly.
//
// It is a distribution-snapshot identifier, not a runtime integrity check: a
// consumer recomputes the aggregate from the digests recorded here, not from
// the bytes actually on disk, so a cache whose files were edited after
// install still reports its generated-at aggregate. Nothing downstream treats
// this value as evidence that the cache is untampered.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const BUNDLE_MANIFEST_RELATIVE_PATH =
	".claude-plugin/bundle-manifest.sha256";

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
				// A newline in a path would make it indistinguishable from the
				// blank line the manifest uses to separate entries (see
				// writeBundleManifest), so a file whose path contains one cannot be
				// recorded at all.
				if (rel.includes("\n")) {
					throw new Error(
						`bundle-manifest: file path contains a newline, which the manifest format cannot represent: ${JSON.stringify(rel)}`,
					);
				}
				results.push(rel);
			}
		}
	}
	walk(bundleRoot, "");
	return results.sort();
}

/**
 * Write the bundle manifest: one `<sha256 hex>  <bundle-relative path>` line
 * per bundled file, sorted by path, with exactly one blank line between
 * consecutive entries and a single trailing newline after the last entry.
 *
 * The blank-line separator is what lets two branches that change
 * path-adjacent entries merge as plain text without a conflict — git treats
 * changes to adjacent lines as a conflict, and without a separator every
 * entry is adjacent to the next.
 *
 * Called last in the assembly, once every other bundled file is final.
 * @param {string} bundleRoot
 */
export function writeBundleManifest(bundleRoot) {
	const manifestPath = join(
		bundleRoot,
		...BUNDLE_MANIFEST_RELATIVE_PATH.split("/"),
	);
	mkdirSync(dirname(manifestPath), { recursive: true });
	const lines = listBundleFiles(bundleRoot).map((rel) => {
		const hex = createHash("sha256")
			.update(readFileSync(join(bundleRoot, rel)))
			.digest("hex");
		return `${hex}  ${rel}`;
	});
	writeFileSync(
		manifestPath,
		lines.length > 0 ? `${lines.join("\n\n")}\n` : "",
	);
}

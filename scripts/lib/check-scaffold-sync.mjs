// Drift check for pfd-ops' L4 scaffold templates (#422): unlike install/,
// scaffold/ has no --deploy step (it's copied out by /pfd-init once and then
// user-edited), so the only useful check is "does the plugin-bundled
// canonical still match this repo's own deployed skill copy" — a read-only
// byte comparison, no sync/remediation.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { listInstallFiles } from "../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs";

/**
 * Compare every file under canonicalDir against its counterpart at the same
 * relative path under deployedDir.
 * @param {string} canonicalDir
 * @param {string} deployedDir
 * @returns {Array<{path: string, status: "ok"|"modified"|"missing"}>}
 */
export function checkScaffoldSync(canonicalDir, deployedDir) {
	return listInstallFiles(canonicalDir).map((rel) => {
		const deployedPath = join(deployedDir, rel);
		if (!existsSync(deployedPath)) return { path: rel, status: "missing" };
		const same = readFileSync(join(canonicalDir, rel)).equals(readFileSync(deployedPath));
		return { path: rel, status: same ? "ok" : "modified" };
	});
}

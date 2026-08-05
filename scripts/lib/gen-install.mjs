// Regenerates .claude/skills/pfd-ops/install/** from the repo-root sources
// listed in install-templates.mjs (#547). install/ is a generated mirror,
// not a hand-edited copy — this is one direction only:
//   repo-root source -> .claude/skills/pfd-ops/install/ -> plugin/pfdsl/... (gen-plugin.mjs)
//
// Mirrors the scripts/check-scaffold-sync.mjs / scripts/lib/check-scaffold-sync.mjs
// split: pure logic here, thin CLI wrapper in ../gen-install.mjs.

import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { listInstallFiles } from "../../.claude/skills/pfd-ops/scripts/check-install-sync.mjs";
import { INSTALL_TEMPLATE_PATHS } from "./install-templates.mjs";

export const INSTALL_DIR_RELATIVE = ".claude/skills/pfd-ops/install";

function filesEqual(pathA, pathB) {
	return readFileSync(pathA).equals(readFileSync(pathB));
}

/**
 * Regenerate .claude/skills/pfd-ops/install/** under root from the
 * repo-root-relative sources in templatePaths. A listed source that does not
 * exist is a hard error, raised before any file under install/ is touched,
 * so a missing template never leaves install/ partially regenerated. Any
 * file under install/ that isn't in templatePaths is removed. Never touches
 * the git index.
 * @param {string} root repo root (absolute path)
 * @param {string[]} [templatePaths] defaults to the real distribution list
 * @returns {{ changed: string[], unchanged: string[], removed: string[] }}
 */
export function genInstall(root, templatePaths = INSTALL_TEMPLATE_PATHS) {
	const installDir = join(root, INSTALL_DIR_RELATIVE);

	// Validate every source exists before writing anything.
	for (const rel of templatePaths) {
		const src = join(root, rel);
		if (!existsSync(src)) {
			throw new Error(`gen-install: template source not found: ${rel}`);
		}
	}

	const changed = [];
	const unchanged = [];
	for (const rel of templatePaths) {
		const src = join(root, rel);
		const dest = join(installDir, rel);
		const isChange = !existsSync(dest) || !filesEqual(src, dest);
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(src, dest);
		// copyFileSync's mode handling is platform-dependent (dropped to the
		// umask default on Linux) — chmod explicitly so the mirror stays
		// bit-for-bit identical to its source, including the executable bit,
		// regardless of OS (#421).
		chmodSync(dest, statSync(src).mode);
		(isChange ? changed : unchanged).push(rel);
	}

	// Anything under install/ that isn't a listed template is stale — remove
	// it so dropping a template from the list actually deletes its mirror.
	const templateSet = new Set(templatePaths);
	const removed = [];
	if (existsSync(installDir)) {
		for (const rel of listInstallFiles(installDir)) {
			if (templateSet.has(rel)) continue;
			rmSync(join(installDir, rel), { force: true });
			removed.push(rel);
		}
	}

	return {
		changed: changed.sort(),
		unchanged: unchanged.sort(),
		removed: removed.sort(),
	};
}

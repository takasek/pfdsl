// Shared entrypoint detection for scripts that are both a library (imported by
// tests and by sibling scripts) and a CLI (`node scripts/…`).
//
// Two copies of this logic necessarily live outside this file, because both
// are distributed and must resolve without scripts/: the PostToolUse hook
// (hooks/retro-reminder-post-tool-use.mjs, bound by "hooks/ imports nothing
// outside hooks/") and the pfd-ops skill script
// (.claude/skills/pfd-ops/scripts/check-install-sync.mjs, which lands in
// adopting repos that have no scripts/lib/). Each says so at its own call
// site. Everything under scripts/ imports this one.

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Is this module the process entrypoint? Node resolves symlinks when it builds
 * `import.meta.url` but leaves `process.argv[1]` as it was typed, so comparing
 * the two verbatim answers "no" whenever the invocation path crosses a symlink
 * — `/tmp` on macOS, or a checkout reached through one. Nothing reports that:
 * the file simply behaves as a library and its CLI body never runs (#707).
 * @param {string} metaUrl caller's `import.meta.url`
 * @param {string | undefined} argv1 `process.argv[1]`
 * @param {{realpath?: (p: string) => string}} [deps]
 * @returns {boolean}
 */
export function isCliEntrypoint(
	metaUrl,
	argv1,
	{ realpath = realpathSync } = {},
) {
	if (!argv1) return false;
	let resolved = argv1;
	try {
		resolved = realpath(argv1);
	} catch {
		// Unresolvable path: fall back to comparing what we were given.
	}
	return metaUrl === pathToFileURL(resolved).href;
}

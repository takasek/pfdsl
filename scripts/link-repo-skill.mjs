#!/usr/bin/env node
// Points .claude/skills/pfdsl at the tracked bundle copy
// (plugin/pfdsl/skills/pfdsl) so a branch switch synchronises it through git
// instead of leaving the previous branch's generated copy in place (#714).
//
// Run: node scripts/link-repo-skill.mjs   (wired into `make setup`)
//
// The decision logic — including replacing the real directory that checkouts
// from before #714 carry — lives in scripts/lib/repo-skill-link.mjs.

import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decideSkillLinkAction, SKILL_LINK_TARGET as TARGET } from "./lib/repo-skill-link.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linkPath = resolve(root, ".claude/skills/pfdsl");

// lstat, not stat: a symlink must be reported as itself here, not as the
// directory it resolves to.
let state = { present: false };
try {
	const stats = lstatSync(linkPath);
	state = {
		present: true,
		isSymlink: stats.isSymbolicLink(),
		linkTarget: stats.isSymbolicLink() ? readlinkSync(linkPath) : undefined,
	};
} catch {
	// absent — leave state as { present: false }
}

const { action, reason } = decideSkillLinkAction(state, TARGET);

if (action === "ok") {
	console.log(`.claude/skills/pfdsl → ${TARGET} (already linked)`);
	process.exit(0);
}

if (action !== "create") {
	rmSync(linkPath, { recursive: true, force: true });
	console.log(`.claude/skills/pfdsl removed — ${reason}`);
}

mkdirSync(dirname(linkPath), { recursive: true });
symlinkSync(TARGET, linkPath);
console.log(`.claude/skills/pfdsl → ${TARGET}`);

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SETUP_INPUTS = [
	"Makefile",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"scripts/hooks/pre-commit-shim",
	"scripts/link-repo-skill.mjs",
	"scripts/setup-completion.mjs",
];

const MARKER = "node_modules/.pfdsl-setup-complete";

export function setupFingerprint(root = process.cwd()) {
	const hash = createHash("sha256");
	for (const path of SETUP_INPUTS) {
		hash.update(path);
		hash.update("\0");
		hash.update(readFileSync(join(root, path)));
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function isSetupCurrent(root = process.cwd()) {
	try {
		return (
			readFileSync(join(root, MARKER), "utf8").trim() === setupFingerprint(root)
		);
	} catch {
		return false;
	}
}

export function writeSetupMarker(root = process.cwd()) {
	const marker = join(root, MARKER);
	mkdirSync(dirname(marker), { recursive: true });
	writeFileSync(marker, `${setupFingerprint(root)}\n`);
}

function main(args) {
	if (args.length !== 1 || !["check", "write"].includes(args[0])) {
		throw new Error("usage: setup-completion.mjs <check|write>");
	}
	if (args[0] === "check") {
		process.exitCode = isSetupCurrent() ? 0 : 1;
		return;
	}
	writeSetupMarker();
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

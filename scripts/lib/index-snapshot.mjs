// Export a frozen index (or HEAD for publication) into a private repository. Generators and their Git
// queries run there; the caller's worktree and index are never rewritten.
import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDistStale } from "./dist-freshness.mjs";
import { withoutGitTargetEnvironment } from "./git-environment.mjs";

const BUILD_INPUTS = [
	"packages/*/src",
	"packages/*/package.json",
	"packages/*/*config*",
	"packages/*/scripts",
	"package.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"tsconfig.base.json",
];

function git(root, args, env) {
	return execFileSync("git", args, {
		cwd: root,
		env,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
}

function linkDependencies(source, snapshot) {
	if (
		existsSync(join(source, "node_modules")) &&
		!existsSync(join(snapshot, "node_modules"))
	)
		symlinkSync(
			join(source, "node_modules"),
			join(snapshot, "node_modules"),
			"dir",
		);
	if (!existsSync(join(snapshot, "packages"))) return;
	const workspace = new Map(
		readdirSync(join(snapshot, "packages")).map((name) => {
			const path = join(snapshot, "packages", name);
			return [
				JSON.parse(readFileSync(join(path, "package.json"), "utf8")).name,
				path,
			];
		}),
	);
	for (const name of readdirSync(join(snapshot, "packages"))) {
		const modules = join(source, "packages", name, "node_modules");
		if (!existsSync(modules)) continue;
		const target = join(snapshot, "packages", name, "node_modules");
		if (existsSync(target)) continue;
		mkdirSync(target, { recursive: true });
		for (const entry of readdirSync(modules)) {
			// Test runners write these directories. Keep those writes private.
			if (entry === ".vite" || entry === ".cache") continue;
			if (entry === "@pfdsl") {
				mkdirSync(join(target, entry), { recursive: true });
				for (const dependency of readdirSync(join(modules, entry))) {
					const local = workspace.get(`@pfdsl/${dependency}`);
					if (!local)
						throw new Error(
							`Unknown workspace dependency: @pfdsl/${dependency}`,
						);
					symlinkSync(local, join(target, entry, dependency), "dir");
				}
			} else {
				symlinkSync(join(modules, entry), join(target, entry), "dir");
			}
		}
	}
}

export function withIndexSnapshot(
	source,
	run,
	environment = process.env,
	{ committed = false } = {},
) {
	// Respect GIT_INDEX_FILE while freezing the input, then remove hook target
	// overrides for every operation and child process inside the private repo.
	const env = withoutGitTargetEnvironment(environment);
	const temporary = mkdtempSync(join(tmpdir(), "pfdsl-index-snapshot-"));
	const snapshot = join(temporary, "repo");
	try {
		const indexPath = git(
			source,
			["rev-parse", "--git-path", "index"],
			environment,
		).trim();
		const privateIndex = join(temporary, "index");
		cpSync(resolve(source, indexPath), privateIndex);
		const frozenEnvironment = { ...environment, GIT_INDEX_FILE: privateIndex };
		// Publication checks inspect what will be pushed/released, rather than
		// allowing staged repairs to hide an inconsistent committed tree.
		if (committed) git(source, ["read-tree", "HEAD"], frozenEnvironment);
		// write-tree updates cache-tree metadata even though it preserves staged
		// entries. Apply that update only to our private index copy.
		const tree = git(source, ["write-tree"], frozenEnvironment).trim();
		git(
			source,
			["clone", "--quiet", "--shared", "--no-checkout", "--", source, snapshot],
			env,
		);
		// Cloning a shallow source falls back to a transport copy, even with
		// --shared, so newly staged objects outside HEAD may be omitted.
		// Explicitly expose the source object store for our frozen index tree.
		const objects = git(
			source,
			["rev-parse", "--git-path", "objects"],
			environment,
		).trim();
		writeFileSync(
			join(snapshot, ".git/objects/info/alternates"),
			`${resolve(source, objects)}\n`,
		);
		git(snapshot, ["read-tree", tree], env);
		git(snapshot, ["checkout-index", "--all"], env);
		// Reuse builds only when their inputs match the frozen index and their
		// original mtimes say they are fresh. Export times do not prove freshness.
		const changedInputs = git(
			source,
			["diff", "--name-only", "--", ...BUILD_INPUTS],
			frozenEnvironment,
		);
		const untrackedInputs = git(
			source,
			["ls-files", "--others", "--exclude-standard", "--", ...BUILD_INPUTS],
			frozenEnvironment,
		);
		if (
			!changedInputs &&
			!untrackedInputs &&
			existsSync(join(snapshot, "packages"))
		) {
			const inputPaths = git(
				source,
				["ls-files", "-z", "--", ...BUILD_INPUTS],
				frozenEnvironment,
			)
				.split("\0")
				.filter(Boolean);
			const newestInput = Math.max(
				0,
				...inputPaths.map((path) => statSync(join(source, path)).mtimeMs),
			);
			for (const name of readdirSync(join(snapshot, "packages"))) {
				const dist = join(source, "packages", name, "dist");
				if (!existsSync(dist)) continue;
				if (
					readdirSync(dist).some(
						(file) =>
							isDistStale(join(dist, file)) ||
							statSync(join(dist, file)).mtimeMs < newestInput,
					)
				)
					continue;
				cpSync(dist, join(snapshot, "packages", name, "dist"), {
					recursive: true,
				});
			}
		}
		linkDependencies(source, snapshot);
		// setup supplies this ignored generated-skill link in real checkouts.
		// Recreate it locally rather than connecting back to the caller's tree.
		if (
			existsSync(join(snapshot, ".claude/skills")) &&
			existsSync(join(snapshot, "generated/skills/pfdsl")) &&
			!existsSync(join(snapshot, ".claude/skills/pfdsl"))
		)
			symlinkSync(
				"../../generated/skills/pfdsl",
				join(snapshot, ".claude/skills/pfdsl"),
				"dir",
			);
		return run(snapshot, env);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

import { execFileSync, spawnSync } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import { GEN_PLUGIN_OUTPUTS } from "./lib/gen-plugin-outputs.mjs";
import { operationalSvgSource } from "./lib/operational-svg-contract.mjs";

const SHA = /^[0-9a-f]{40}$/;
const nulPaths = (text) => text.split("\0").filter(Boolean);

export function isGeneratedPath(path) {
	return (
		GEN_PLUGIN_OUTPUTS.some(
			(root) => path === root || path.startsWith(`${root}/`),
		) && !path.split("/").some((part) => part === ".." || part === ".")
	);
}

export function validatePull(pull, repository, number) {
	if (
		!/^[1-9][0-9]*$/.test(String(number)) ||
		!/^[\w.-]+\/[\w.-]+$/.test(repository)
	)
		throw new Error("Invalid repository or PR number");
	if (
		pull.state !== "open" ||
		pull.head?.repo?.full_name !== repository ||
		pull.base?.repo?.full_name !== repository ||
		pull.base.ref !== "main" ||
		pull.head.ref === "main" ||
		!SHA.test(pull.head.sha) ||
		!SHA.test(pull.base.sha)
	) {
		throw new Error(
			"Repair requires an open, same-repository PR targeting main from a feature branch",
		);
	}
	return {
		repository,
		number: Number(number),
		head: pull.head.sha,
		base: pull.base.sha,
		branch: pull.head.ref,
	};
}

function git(root, args) {
	return execFileSync("git", args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trimEnd();
}

class SourceConflictError extends Error {}

function assertGenerated(paths) {
	const canonical = paths.filter((path) => !isGeneratedPath(path));
	if (canonical.length)
		throw new Error(
			`Manual resolution required for canonical files:\n${canonical.join("\n")}`,
		);
}

// Independent of gen-plugin ownership: only tracked, regular operational
// diagrams with an already tracked matching SVG are renderer-owned here.
function operationalSvgs(entries) {
	const nonRegular = new Set(
		entries
			.filter(([mode]) => mode !== "100644" && mode !== "100755")
			.map(([, path]) => path),
	);
	const regular = new Set(
		entries
			.filter(
				([mode, path]) =>
					(mode === "100644" || mode === "100755") && !nonRegular.has(path),
			)
			.map(([, path]) => path),
	);
	return new Set(
		[...regular].filter((path) => regular.has(operationalSvgSource(path))),
	);
}

function treeSvgs(root, tree) {
	return operationalSvgs(
		nulPaths(git(root, ["ls-tree", "-r", "-z", tree])).map((entry) => {
			const [header, path] = entry.split("\t");
			return [header.split(" ")[0], path];
		}),
	);
}

function assertRepairPaths(paths, svgs) {
	assertGenerated(paths.filter((path) => !svgs.has(path)));
}

export function regenerateOperationalSvgs(root, tree) {
	const paths = [...treeSvgs(root, tree)].sort();
	for (const path of paths) {
		const env = { ...process.env };
		delete env.GH_TOKEN;
		delete env.GITHUB_TOKEN;
		// Capture before writing so a failed render cannot truncate the output.
		const svg = execFileSync(
			process.execPath,
			[
				"packages/cli/dist/cli.js",
				"render",
				operationalSvgSource(path),
				"--format",
				"svg",
			],
			{ cwd: root, env },
		);
		writeFileSync(resolve(root, path), svg);
	}
	const allowed = new Set(paths);
	const changes = nulPaths(git(root, ["diff", "--name-only", "-z", tree]));
	if (changes.some((path) => !allowed.has(path)))
		throw new Error(
			"SVG rendering modified files outside operational SVG outputs",
		);
	const untracked = nulPaths(
		git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
	);
	if (untracked.length)
		throw new Error(
			`SVG rendering created unexpected files: ${untracked.join(", ")}`,
		);
	return paths;
}

export function mergeGeneratedConflicts(root, head, base) {
	if (
		!SHA.test(head) ||
		!SHA.test(base) ||
		git(root, ["rev-parse", "HEAD"]) !== head
	)
		throw new Error("Checkout does not match the frozen PR head");
	// Git requires a committer identity even for a --no-commit merge.
	git(root, ["config", "user.name", "generated-repair[bot]"]);
	git(root, [
		"config",
		"user.email",
		"generated-repair[bot]@users.noreply.github.com",
	]);
	const merge = spawnSync("git", ["merge", "--no-ff", "--no-commit", base], {
		cwd: root,
		encoding: "utf8",
	});
	const conflicts = nulPaths(
		git(root, ["diff", "--name-only", "--diff-filter=U", "-z"]),
	);
	if (merge.status !== 0 && (merge.status !== 1 || conflicts.length === 0))
		throw new Error(`Merge failed: ${merge.stderr}`);
	const entries = nulPaths(git(root, ["ls-files", "--stage", "-z"])).flatMap(
		(entry) => {
			const [header, path] = entry.split("\t");
			const [mode, , stage] = header.split(" ");
			// A conflicted source is never an eligible renderer input.
			return stage === "0" || path.endsWith(".svg") ? [[mode, path]] : [];
		},
	);
	const svgs = operationalSvgs(entries);
	const sources = conflicts.filter(
		(path) => !isGeneratedPath(path) && !svgs.has(path),
	);
	if (sources.length) {
		throw new SourceConflictError(
			`Automatic repair stopped: source files have merge conflicts.
This workflow repairs generated files only; it cannot choose between source changes.

Files requiring manual resolution:
${sources.map((path) => `- ${path}`).join("\n")}

Resolve these files manually while merging main into the PR branch locally.
Regenerate plugin outputs with make gen-plugin.
For operational SVGs, run make build and render each matching .pfdsl source with node packages/cli/dist/cli.js render <source> --format svg.
Capture successful output before replacing its matching SVG; see docs/generated-conflict-repair.md.
Finish the merge after regenerating its outputs, then commit and push.
Rerun this workflow if generated files still need repair.
No changes were pushed.`,
		);
	}
	for (const path of conflicts) {
		const ours = spawnSync("git", ["cat-file", "-e", `${head}:${path}`], {
			cwd: root,
		});
		if (ours.status === 0)
			git(root, [
				"restore",
				"--source",
				head,
				"--staged",
				"--worktree",
				"--",
				path,
			]);
		else git(root, ["rm", "-f", "--", path]);
	}
	return conflicts;
}

// The publisher independently reconstructs Git's merge tree. Artifact code is
// never executed; only generated paths may differ from the automatic merge.
export function verifyRepair(root, head, base, repaired) {
	if (![head, base, repaired].every((sha) => SHA.test(sha)))
		throw new Error("Invalid commit identity");
	const integrated =
		spawnSync("git", ["merge-base", "--is-ancestor", base, head], { cwd: root })
			.status === 0;
	const expectedParents = integrated ? [head] : [head, base];
	if (
		git(root, ["show", "-s", "--format=%P", repaired]) !==
		expectedParents.join(" ")
	)
		throw new Error("Unexpected repair commit parents");
	const merged = spawnSync(
		"git",
		["merge-tree", "--write-tree", "--name-only", "-z", head, base],
		{ cwd: root, encoding: "utf8" },
	);
	if (merged.status !== 0 && merged.status !== 1)
		throw new Error(`Cannot reconstruct merge: ${merged.stderr}`);
	const sections = merged.stdout.split("\0");
	const tree = sections.shift();
	if (!SHA.test(tree)) throw new Error("Invalid automatic merge tree");
	const svgs = treeSvgs(root, tree);
	if (merged.status === 1)
		assertRepairPaths(sections.slice(0, sections.indexOf("")), svgs);
	assertRepairPaths(
		nulPaths(
			git(root, ["diff", "--name-only", "-z", tree, `${repaired}^{tree}`]),
		),
		svgs,
	);
	const repairedSvgs = treeSvgs(root, repaired);
	for (const path of svgs)
		if (!repairedSvgs.has(path))
			throw new Error(
				`Repair removed or changed the type of operational SVG: ${path}`,
			);
	return tree;
}

function query(path) {
	return JSON.parse(
		execFileSync("gh", ["api", "--hostname", "github.com", path], {
			encoding: "utf8",
		}),
	);
}

function snapshot(repository, number) {
	const pull = query(`repos/${repository}/pulls/${number}`);
	const value = validatePull(pull, repository, number);
	value.base = query(`repos/${repository}/git/ref/heads/main`).object.sha;
	return value;
}

function readSnapshot(directory) {
	const value = JSON.parse(
		readFileSync(resolve(directory, "snapshot.json"), "utf8"),
	);
	validatePull(
		{
			state: "open",
			head: {
				sha: value.head,
				ref: value.branch,
				repo: { full_name: value.repository },
			},
			base: {
				sha: value.base,
				ref: "main",
				repo: { full_name: value.repository },
			},
		},
		value.repository,
		value.number,
	);
	return value;
}

function run(root, file, args) {
	const env = { ...process.env };
	delete env.GH_TOKEN;
	delete env.GITHUB_TOKEN;
	execFileSync(file, args, { cwd: root, env, stdio: "inherit" });
}

export function prepare(root, directory) {
	const value = readSnapshot(directory);
	const conflicts = mergeGeneratedConflicts(root, value.head, value.base);
	console.log(
		`Generated conflicts: ${conflicts.length}\n${conflicts.join("\n")}`,
	);
	const before = git(root, ["write-tree"]);
	run(root, "pnpm", ["install", "--frozen-lockfile"]);
	run(root, "node", ["scripts/link-repo-skill.mjs"]);
	run(root, "pnpm", ["-r", "build"]);
	run(root, "make", ["gen-plugin"]);
	assertGenerated(nulPaths(git(root, ["diff", "--name-only", "-z", before])));
	assertGenerated(
		nulPaths(git(root, ["ls-files", "--others", "--exclude-standard", "-z"])),
	);
	git(root, ["add", "-A"]);
	const generated = git(root, ["write-tree"]);
	regenerateOperationalSvgs(root, generated);
	git(root, ["add", "-A"]);
	const merging =
		spawnSync("git", ["rev-parse", "--verify", "MERGE_HEAD"], { cwd: root })
			.status === 0;
	if (
		!merging &&
		spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: root }).status ===
			0
	) {
		console.log("No repair needed.");
		if (process.env.GITHUB_OUTPUT)
			appendFileSync(process.env.GITHUB_OUTPUT, "changed=false\n");
		return;
	}
	git(root, [
		"commit",
		"-m",
		`fix(ci): regenerate assets after main integration for PR #${value.number}`,
	]);
	const repaired = git(root, ["rev-parse", "HEAD"]);
	verifyRepair(root, value.head, value.base, repaired);
	run(root, "make", ["test", "lint", "typecheck"]);
	run(root, "node", [
		"scripts/check-generated-drift.mjs",
		"--gen-plugin",
		"terminal",
	]);
	if (git(root, ["status", "--porcelain"]))
		throw new Error("Verification left a dirty checkout");
	git(root, ["update-ref", "refs/heads/generated-repair-result", repaired]);
	git(root, [
		"bundle",
		"create",
		resolve(directory, "repair.bundle"),
		"refs/heads/generated-repair-result",
	]);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, "changed=true\n");
	console.log(`Verified repair commit: ${repaired}`);
}

function publication(root, directory, push) {
	const value = readSnapshot(directory);
	if (
		value.repository !== process.env.GITHUB_REPOSITORY ||
		value.number !== Number(process.env.PR_NUMBER)
	)
		throw new Error("Artifact does not belong to the requested PR");
	const fresh = snapshot(value.repository, value.number);
	if (JSON.stringify(fresh) !== JSON.stringify(value))
		throw new Error("PR or main changed; rerun the workflow");
	git(root, [
		"fetch",
		resolve(directory, "repair.bundle"),
		"refs/heads/generated-repair-result",
	]);
	const repaired = git(root, ["rev-parse", "FETCH_HEAD"]);
	verifyRepair(root, value.head, value.base, repaired);
	git(root, ["check-ref-format", `refs/heads/${value.branch}`]);
	if (push) {
		// Authentication is configured only in this fresh, trusted-code runner.
		execFileSync("gh", ["auth", "setup-git", "--hostname", "github.com"], {
			cwd: root,
			stdio: "inherit",
		});
		git(root, [
			"push",
			`https://github.com/${value.repository}.git`,
			`${repaired}:refs/heads/${value.branch}`,
		]);
		// The PR API may still report the old head immediately after push.
		// Read the published Git ref instead of the derived PR metadata.
		const ref = `refs/heads/${value.branch}`;
		let published;
		try {
			published = git(root, [
				"ls-remote",
				"--exit-code",
				"--refs",
				`https://github.com/${value.repository}.git`,
				ref,
			]);
		} catch (cause) {
			throw new Error(
				"Push succeeded, but remote branch verification failed. Check the PR branch before rerunning the repair.",
				{ cause },
			);
		}
		if (published !== `${repaired}\t${ref}`)
			throw new Error(
				`Push succeeded, but the remote branch does not match repair commit ${repaired}. Check the PR branch before rerunning the repair.`,
			);
	}
	console.log(
		`Validated repair for PR #${value.number}: ${repaired}${push ? " (pushed)" : " (not pushed)"}`,
	);
}

function main() {
	const [mode, first, second] = process.argv.slice(2);
	if (mode === "snapshot") {
		const directory = resolve(process.env.RUNNER_TEMP, "generated-repair");
		mkdirSync(directory, { recursive: true });
		const value = snapshot(first, second);
		writeFileSync(
			resolve(directory, "snapshot.json"),
			`${JSON.stringify(value)}\n`,
		);
		appendFileSync(process.env.GITHUB_OUTPUT, `head=${value.head}\n`);
	} else if (mode === "prepare") prepare(resolve(first), resolve(second));
	else if (mode === "publish" || mode === "verify")
		publication(resolve(first), resolve(second), mode === "publish");
	else
		throw new Error(
			"Usage: repair-generated-conflicts.mjs snapshot <repository> <PR> | prepare|verify|publish <checkout> <artifact-directory>",
		);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
	try {
		main();
	} catch (error) {
		if (!(error instanceof SourceConflictError)) throw error;
		console.error(error.message);
		if (process.env.GITHUB_STEP_SUMMARY) {
			appendFileSync(
				process.env.GITHUB_STEP_SUMMARY,
				`## Generated repair requires manual resolution\n\n${error.message}\n`,
			);
		}
		process.exitCode = 1;
	}
}

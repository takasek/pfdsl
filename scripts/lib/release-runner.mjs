import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseHost } from "../pfdsl/lib/github-rest.mjs";
import {
	bumpVersionInPackageJson,
	RELEASE_KINDS,
	releaseMilestoneCandidateArtifactIds,
	tagName,
} from "./release-config.mjs";
import { runReleaseGates as defaultRunReleaseGates } from "./release-gates.mjs";
import {
	tryRun as defaultTryRun,
	hasGitTargetEnvironment,
} from "./run-exec.mjs";

function assertGitTargetEnvironment() {
	if (hasGitTargetEnvironment()) {
		throw new Error("clear Git target environment overrides before releasing");
	}
}

function defaultRun(root, command, args, options = {}) {
	execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
}

function defaultCapture(root, command, args, options = {}) {
	return execFileSync(command, args, {
		cwd: root,
		encoding: "utf8",
		...options,
	}).trim();
}

function callCapture(capture, root, command, args, options = {}) {
	return capture(command, args, { cwd: root, ...options });
}

function callRun(run, root, command, args, options = {}) {
	return run(command, args, { cwd: root, ...options });
}

function probe(capture, root, command, args) {
	try {
		return callCapture(capture, root, command, args);
	} catch (error) {
		if (error?.status === 1) return null;
		throw error;
	}
}

function assertClean(capture, root) {
	if (callCapture(capture, root, "git", ["status", "--porcelain"]) !== "") {
		throw new Error("working tree has uncommitted changes");
	}
}

function packageVersions(root, kind) {
	return kind.packages.map((relativePath) => {
		const packagePath = resolve(root, relativePath);
		return JSON.parse(readFileSync(packagePath, "utf8")).version;
	});
}

function assertPackageVersions(versions) {
	if (new Set(versions).size !== 1) {
		throw new Error("release package versions do not match");
	}
	if (
		versions.some((version) => typeof version !== "string" || version === "")
	) {
		throw new Error("release package version is missing");
	}
}

function parseRemoteTag(output, tag) {
	let direct;
	let peeled;
	for (const line of output.split("\n")) {
		if (!line) continue;
		const [sha, ref] = line.split(/\s+/, 2);
		if (ref === `refs/tags/${tag}`) direct = sha;
		if (ref === `refs/tags/${tag}^{}`) peeled = sha;
	}
	return peeled ?? direct ?? null;
}

function inspectTag(capture, root, tag, commit) {
	const localRef = probe(capture, root, "git", [
		"show-ref",
		"--verify",
		"--quiet",
		`refs/tags/${tag}`,
	]);
	let localCommit = null;
	if (localRef !== null) {
		localCommit = callCapture(capture, root, "git", [
			"rev-parse",
			"--verify",
			`${`refs/tags/${tag}`}^{commit}`,
		]);
		if (localCommit !== commit) {
			throw new Error(
				`local tag ${tag} points to ${localCommit}, expected ${commit}`,
			);
		}
	}

	const remoteCommit = parseRemoteTag(
		callCapture(capture, root, "git", [
			"ls-remote",
			"--tags",
			"origin",
			`refs/tags/${tag}`,
			`refs/tags/${tag}^{}`,
		]),
		tag,
	);
	if (remoteCommit !== null && remoteCommit !== commit) {
		throw new Error(
			`remote tag ${tag} points to ${remoteCommit}, expected ${commit}`,
		);
	}
	return { localCommit, remoteCommit };
}

function assertMainAtCommit(capture, root, commit) {
	const originMain = callCapture(capture, root, "git", [
		"rev-parse",
		"origin/main",
	]);
	if (originMain !== commit) {
		throw new Error(`origin/main is ${originMain}, expected ${commit}`);
	}
}

function runChecks({ root, run, tryRun, runReleaseGates }) {
	for (const args of [["build"], ["test"], ["check-docs"], ["gen-plugin"]]) {
		callRun(run, root, "make", args);
	}
	callRun(run, root, process.execPath, [
		resolve(root, "scripts/check-generated-drift.mjs"),
		"--",
		"plugin",
	]);

	for (const gate of runReleaseGates(root, {
		mode: "release",
		stopOnFailure: true,
		exec: (file, args, options) =>
			tryRun(file, args, { cwd: root, ...options }),
	})) {
		console[gate.ok ? "log" : "error"](gate.lines.join("\n"));
		if (!gate.ok) throw new Error(`release gate failed: ${gate.id}`);
	}
}

function assertFinalSnapshot(
	capture,
	run,
	root,
	commit,
	{ allowVsix = false } = {},
) {
	callRun(run, root, "git", ["fetch", "origin", "main", "--quiet"]);
	if (callCapture(capture, root, "git", ["rev-parse", "HEAD"]) !== commit) {
		throw new Error("HEAD changed during release checks");
	}
	const status = callCapture(capture, root, "git", ["status", "--porcelain"]);
	if (status !== "") {
		const unexpected = status
			.split("\n")
			.filter(Boolean)
			.filter((line) => !allowVsix || !/^\?\? .*\.vsix$/.test(line));
		if (unexpected.length > 0)
			throw new Error("working tree changed during release checks");
	}
	assertMainAtCommit(capture, root, commit);
}

function assertLocalTagStillPoints(capture, root, tag, commit) {
	if (
		probe(capture, root, "git", [
			"show-ref",
			"--verify",
			"--quiet",
			`refs/tags/${tag}`,
		]) === null
	) {
		throw new Error(`local tag ${tag} disappeared before push`);
	}
	const current = callCapture(capture, root, "git", [
		"rev-parse",
		"--verify",
		`${`refs/tags/${tag}`}^{commit}`,
	]);
	if (current !== commit) {
		throw new Error(`local tag ${tag} moved to ${current} before push`);
	}
}

function ghOptions(capture, root) {
	try {
		const host = parseHost(
			callCapture(capture, root, "git", ["remote", "get-url", "origin"]),
		);
		return host ? { env: { ...process.env, GH_HOST: host } } : {};
	} catch {
		return {};
	}
}

/**
 * Prepare version changes in a release branch. Only package files and the
 * existing CLI generator are touched; no Git mutation is performed.
 */
export function prepareRelease({
	root,
	kindArg,
	version,
	capture = (command, args, options) =>
		defaultCapture(root, command, args, options),
	run = (command, args, options) => defaultRun(root, command, args, options),
}) {
	assertGitTargetEnvironment();
	const kind = RELEASE_KINDS[kindArg];
	const branch = callCapture(capture, root, "git", [
		"rev-parse",
		"--abbrev-ref",
		"HEAD",
	]);
	if (branch === "main" || branch === "HEAD") {
		throw new Error(`prepare requires a work branch (currently on ${branch})`);
	}
	if (callCapture(capture, root, "git", ["status", "--porcelain"]) !== "") {
		throw new Error(
			"working tree has an existing release diff; preserve it and continue through the normal PR",
		);
	}

	for (const relativePath of kind.packages) {
		const packagePath = resolve(root, relativePath);
		const before = readFileSync(packagePath, "utf8");
		writeFileSync(packagePath, bumpVersionInPackageJson(before, version));
	}
	if (kindArg === "cli") callRun(run, root, "make", ["gen-plugin"]);
	console.log(
		`Prepared ${kindArg} release ${version}. Review the diff and open the normal PR; no Git commit or push was created.`,
	);
}

function workflowRun(
	{ root, run, capture, sleep, gh },
	{ workflow, tag, commit, resumeCommand },
) {
	if (!workflow) return;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const output = callCapture(
			capture,
			root,
			"gh",
			[
				"run",
				"list",
				"--workflow",
				workflow,
				"--commit",
				commit,
				"--json",
				"databaseId,headBranch,headSha",
				"--limit",
				"20",
			],
			gh,
		);
		let runs;
		try {
			runs = JSON.parse(output);
		} catch {
			throw new Error(`could not parse GHA runs for ${tag}`);
		}
		const matching = runs.find(
			(runInfo) => runInfo.headBranch === tag && runInfo.headSha === commit,
		);
		if (matching) {
			try {
				callRun(
					run,
					root,
					"gh",
					["run", "watch", String(matching.databaseId), "--exit-status"],
					gh,
				);
			} catch (error) {
				throw new Error(
					`GHA run ${matching.databaseId} for ${tag} failed; the tag may already be published. Inspect it and resume with '${resumeCommand} COMMIT=${commit}'. ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return;
		}
		if (attempt < 2) sleep();
	}
	throw new Error(
		`GHA run not found for ${tag} at ${commit}; the tag may already be published. Inspect its workflow and resume with '${resumeCommand} COMMIT=${commit}' without creating another tag`,
	);
}

export function formatCliCandidateNotice(candidates) {
	return [
		`CLI release candidates: ${candidates.join(", ")}`,
		"Verify the published npm artifact, pipeline acceptance, and plugin tag retrieval.",
		"Then prepare a marketplace pin PR, confirm main retrieves that tag, and use a roadmap PR to synchronize only explicitly confirmed artifacts.",
	].join("\n");
}

export function formatExistingVsixNotice(candidate, commit) {
	return `Existing VSIX candidate found; verify it was packaged from ${commit} before installation/upload. Candidate: ${candidate}`;
}

function showCliCandidates({ root, capture }) {
	try {
		const output = callCapture(capture, root, process.execPath, [
			resolve(root, "packages/cli/dist/cli.js"),
			"status",
			"ready",
			resolve(root, ".pfdsl/roadmap.pfdsl"),
			"--json",
		]);
		const parsed = JSON.parse(output);
		if (
			!Array.isArray(parsed.ready) ||
			parsed.ready.some(
				(item) =>
					item === null ||
					typeof item !== "object" ||
					typeof item.id !== "string" ||
					!Array.isArray(item.outputs) ||
					item.outputs.some((outputId) => typeof outputId !== "string"),
			)
		) {
			throw new Error("invalid status ready output");
		}
		const candidates = releaseMilestoneCandidateArtifactIds(parsed.ready);
		if (candidates.length === 0) {
			console.log(
				"No ready CLI release milestones were found; roadmap state is unchanged.",
			);
			return;
		}
		console.log(formatCliCandidateNotice(candidates));
	} catch {
		console.warn(
			[
				"CLI release candidate listing unavailable; the publish workflow succeeded, but candidates were not confirmed.",
				"Build the CLI, then run `node packages/cli/dist/cli.js status ready .pfdsl/roadmap.pfdsl --json`.",
				"The roadmap is unchanged.",
			].join("\n"),
		);
		return;
	}
}

function assertVsixCandidate(root) {
	const extensionRoot = resolve(root, "packages/vscode-extension");
	const packageJson = JSON.parse(
		readFileSync(resolve(extensionRoot, "package.json"), "utf8"),
	);
	const expected = `${packageJson.name}-${packageJson.version}.vsix`;
	try {
		if (!lstatSync(resolve(extensionRoot, expected)).isFile())
			throw new Error();
	} catch {
		throw new Error(
			`expected VSIX candidate ${expected} is not available as a regular file after packaging or resume; inspect the existing tag and package the candidate before continuing`,
		);
	}
	return expected;
}

function assertRemoteTagStillPoints(capture, root, tag, commit) {
	const remoteCommit = parseRemoteTag(
		callCapture(capture, root, "git", [
			"ls-remote",
			"--tags",
			"origin",
			`refs/tags/${tag}`,
			`refs/tags/${tag}^{}`,
		]),
		tag,
	);
	if (remoteCommit !== commit) {
		throw new Error(
			`remote tag ${tag} points to ${remoteCommit ?? "nothing"} after push, expected ${commit}`,
		);
	}
}

/**
 * Publish an explicit commit without creating commits or pushing a branch.
 */
export function publishRelease({
	root,
	kindArg,
	commit,
	capture = (command, args, options) =>
		defaultCapture(root, command, args, options),
	run = (command, args, options) => defaultRun(root, command, args, options),
	tryRun = defaultTryRun,
	runReleaseGates = defaultRunReleaseGates,
	sleep = () => callRun(run, root, "sleep", ["2"]),
}) {
	assertGitTargetEnvironment();
	const kind = RELEASE_KINDS[kindArg];
	assertClean(capture, root);
	const head = callCapture(capture, root, "git", ["rev-parse", "HEAD"]);
	if (head !== commit) throw new Error(`HEAD is ${head}, expected ${commit}`);

	const versions = packageVersions(root, kind);
	assertPackageVersions(versions);
	const tag = tagName(kind, versions[0]);
	const inspected = inspectTag(capture, root, tag, commit);
	const remoteAlreadyPublished = inspected.remoteCommit === commit;
	let existingVsix;
	if (remoteAlreadyPublished && kindArg === "vscode") {
		existingVsix = assertVsixCandidate(root);
		console.log(formatExistingVsixNotice(existingVsix, commit));
	}

	if (!remoteAlreadyPublished) {
		callRun(run, root, "git", ["fetch", "origin", "main", "--quiet"]);
		assertMainAtCommit(capture, root, commit);
		runChecks({ root, run, tryRun, runReleaseGates });
		assertFinalSnapshot(capture, run, root, commit);

		if (kindArg === "vscode") {
			callRun(run, root, "vsce", ["package", "--no-dependencies"], {
				cwd: resolve(root, "packages/vscode-extension"),
			});
			assertFinalSnapshot(capture, run, root, commit, { allowVsix: true });
			assertVsixCandidate(root);
		}
		if (inspected.localCommit === null) {
			callRun(run, root, "git", ["tag", tag, commit]);
		}
		assertLocalTagStillPoints(capture, root, tag, commit);
		callRun(run, root, "git", ["push", "origin", `${commit}:refs/tags/${tag}`]);
		assertRemoteTagStillPoints(capture, root, tag, commit);
	}

	workflowRun(
		{
			root,
			run,
			capture,
			sleep,
			gh: kind.workflow ? ghOptions(capture, root) : {},
		},
		{
			workflow: kind.workflow,
			tag,
			commit,
			resumeCommand: kindArg === "libs" ? "make release-libs" : "make release",
		},
	);
	if (kindArg === "cli") showCliCandidates({ root, capture });
}

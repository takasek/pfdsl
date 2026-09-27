import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const sha = "[0-9a-f]{40}";
const pinLine = new RegExp(
	`^(\\s*-?\\s*uses:\\s*)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)@(${sha})(\\s+#\\s+v[0-9][A-Za-z0-9_.-]*)?\\s*$`,
);

export function selectBatch(
	pulls,
	{ now, repository, quietMinutes, excludedNumbers = new Set() },
) {
	const eligible = pulls
		.filter(
			(p) =>
				p.state === "open" &&
				!p.draft &&
				p.user?.login === "dependabot[bot]" &&
				p.base?.ref === "main" &&
				!excludedNumbers.has(p.number) &&
				p.head?.repo?.full_name === repository &&
				p.head?.ref?.startsWith("dependabot/github_actions/") &&
				/^[0-9a-f]{40}$/.test(p.head?.sha ?? ""),
		)
		.sort((a, b) => a.number - b.number);
	if (eligible.length === 0) return { status: "empty", pulls: [] };
	const newest = Math.max(...eligible.map((p) => Date.parse(p.created_at)));
	if (!Number.isFinite(newest) || now - newest < quietMinutes * 60_000)
		return { status: "waiting", pulls: eligible };
	return { status: "ready", pulls: eligible };
}

export function batchBranchName(pulls) {
	if (pulls.length === 0) throw new Error("empty batch");
	return `codex/dependabot-actions-${pulls[0].number}-${pulls.at(-1).number}`;
}

export function validateDependencyPrFiles(files) {
	if (files.length === 0) throw new Error("PR has no files");
	for (const file of files) {
		if (
			!/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(file.filename) ||
			file.status !== "modified" ||
			!file.patch
		) {
			throw new Error(`Unsupported Dependabot file: ${file.filename}`);
		}
		let removed = [];
		let added = [];
		let removedCount = 0;
		let addedCount = 0;
		const checkBlock = () => {
			if (removed.length === 0 && added.length === 0) return;
			if (removed.length === 0 || removed.length !== added.length)
				throw new Error(`Moved action or unexpected diff: ${file.filename}`);
			for (let i = 0; i < removed.length; i++) {
				const before = removed[i].match(pinLine);
				const after = added[i].match(pinLine);
				if (
					!before ||
					!after ||
					before[1] !== after[1] ||
					before[2] !== after[2] ||
					before[3] === after[3]
				)
					throw new Error(`Non-pin diff: ${file.filename}`);
			}
			removed = [];
			added = [];
		};
		for (const line of file.patch.split("\n")) {
			if (line.startsWith("@@") || line.startsWith(" ")) {
				checkBlock();
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				removed.push(line.slice(1));
				removedCount++;
			} else if (line.startsWith("+") && !line.startsWith("+++")) {
				added.push(line.slice(1));
				addedCount++;
			}
		}
		checkBlock();
		if (removedCount === 0 || removedCount !== addedCount)
			throw new Error(`Unexpected diff: ${file.filename}`);
		if (
			(file.deletions !== undefined && file.deletions !== removedCount) ||
			(file.additions !== undefined && file.additions !== addedCount)
		)
			throw new Error(`Truncated diff: ${file.filename}`);
	}
}

export function updateWorkflowPinExpectations(source, pins) {
	let result = source;
	for (const [action, newSha] of Object.entries(pins)) {
		if (!/^[0-9a-f]{40}$/.test(newSha))
			throw new Error(`Invalid pin for ${action}`);
		const pattern = new RegExp(
			`${action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@${sha}`,
			"g",
		);
		if (!pattern.test(result))
			throw new Error(`Missing pin assertion: ${action}`);
		result = result.replace(pattern, `${action}@${newSha}`);
	}
	return result;
}

function run(file, args, options = {}) {
	return execFileSync(file, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 32 * 1024 * 1024,
		...options,
	}).trim();
}

function ghJson(args) {
	return JSON.parse(run("gh", args));
}

function allPages(route) {
	return ghJson(["api", "--paginate", "--slurp", route]).flat();
}

function updatedPins(files) {
	const pins = {};
	for (const file of files) {
		for (const line of file.patch.split("\n")) {
			if (!line.startsWith("+") || line.startsWith("+++")) continue;
			const match = line.slice(1).match(pinLine);
			if (match) {
				if (pins[match[2]] && pins[match[2]] !== match[3])
					throw new Error(`Conflicting pins for ${match[2]}`);
				pins[match[2]] = match[3];
			}
		}
	}
	return pins;
}

export function batchNumbers(body) {
	const match = body?.match(/^batch-includes: ([0-9]+(?:,[0-9]+)*)$/m);
	return match ? match[1].split(",").map(Number) : [];
}

export function isOwnBatchPull(pull, repository) {
	return (
		pull.head?.repo?.full_name === repository &&
		pull.head?.ref?.startsWith("codex/dependabot-actions-")
	);
}

export function createFinalPr(
	branch,
	numbers,
	{ execute = run, query = ghJson, wait = () => run("sleep", ["5"]) } = {},
) {
	const refs = numbers.map((number) => `#${number}`).join(", ");
	const body = `Combines Dependabot GitHub Actions updates ${refs} and refreshes generated mirrors and pin assertions.\n\nno-issue: automated dependency maintenance\n\nbatch-includes: ${numbers.join(",")}`;
	const args = [
		"pr",
		"create",
		"--base",
		"main",
		"--head",
		branch,
		"--title",
		`chore(ci): integrate Dependabot Actions updates ${refs}`,
		"--body",
		body,
	];
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			execute("gh", args);
			return;
		} catch (error) {
			try {
				const existing = query([
					"pr",
					"list",
					"--state",
					"open",
					"--head",
					branch,
					"--json",
					"number",
				]);
				if (existing.length) return;
			} catch {
				// An API outage can affect both calls. Retry the create request.
			}
			if (attempt === 3) throw error;
			wait();
		}
	}
}

function assertNoOrphanBranch() {
	const refs = run("git", [
		"ls-remote",
		"--heads",
		"origin",
		"refs/heads/codex/dependabot-actions-*",
	]);
	for (const line of refs.split("\n").filter(Boolean)) {
		const branch = line.split("\trefs/heads/")[1];
		if (!branch) throw new Error("Invalid batch branch ref");
		const existing = ghJson([
			"pr",
			"list",
			"--state",
			"all",
			"--head",
			branch,
			"--json",
			"number",
			"--limit",
			"100",
		]);
		if (existing.length) continue;
		throw new Error(
			`Batch branch ${branch} has no PR; review it before continuing`,
		);
	}
}

function main() {
	const repository = process.env.GITHUB_REPOSITORY;
	if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
		throw new Error("Invalid GITHUB_REPOSITORY");
	run("gh", ["auth", "setup-git"]);
	const pulls = allPages(`repos/${repository}/pulls?state=open&per_page=100`);
	const pendingBatch = pulls.find((p) => isOwnBatchPull(p, repository));
	if (pendingBatch) {
		console.log(`Waiting for batch PR #${pendingBatch.number}`);
		return;
	}
	assertNoOrphanBranch();
	const closed = allPages(
		`repos/${repository}/pulls?state=closed&per_page=100`,
	);
	const cancelledNumbers = new Set(
		closed
			.filter((p) => !p.merged_at && isOwnBatchPull(p, repository))
			.flatMap((p) => batchNumbers(p.body)),
	);
	if (
		pulls.some(
			(p) =>
				p.user?.login === "dependabot[bot]" && cancelledNumbers.has(p.number),
		)
	) {
		throw new Error(
			"A closed, unmerged batch still contains open Dependabot PRs; review it before continuing",
		);
	}
	const excludedNumbers = new Set(
		closed
			.filter((p) => p.merged_at && isOwnBatchPull(p, repository))
			.flatMap((p) => batchNumbers(p.body)),
	);
	const batch = selectBatch(pulls, {
		now: Date.now(),
		repository,
		quietMinutes: 15,
		excludedNumbers,
	});
	if (batch.status !== "ready") {
		console.log(`Dependabot Actions batch: ${batch.status}`);
		return;
	}
	const files = batch.pulls.flatMap((pull) => {
		const current = allPages(
			`repos/${repository}/pulls/${pull.number}/files?per_page=100`,
		);
		validateDependencyPrFiles(current);
		return current;
	});
	const branch = batchBranchName(batch.pulls);
	const remoteExists = Boolean(
		run("git", ["ls-remote", "--heads", "origin", `refs/heads/${branch}`]),
	);
	const noToken = { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "" };
	if (remoteExists) throw new Error(`Batch branch already exists: ${branch}`);
	for (const pull of batch.pulls) {
		const fresh = ghJson(["api", `repos/${repository}/pulls/${pull.number}`]);
		if (
			fresh.head.sha !== pull.head.sha ||
			fresh.base.ref !== "main" ||
			fresh.state !== "open"
		)
			throw new Error(`PR #${pull.number} changed during selection`);
	}
	const base = ghJson(["api", `repos/${repository}/git/ref/heads/main`]).object
		.sha;
	if (run("git", ["rev-parse", "HEAD"]) !== base)
		throw new Error("main advanced since checkout");
	run("git", ["switch", "-c", branch]);
	run("git", ["config", "user.name", "dependabot-actions-batch[bot]"]);
	run("git", [
		"config",
		"user.email",
		"dependabot-actions-batch[bot]@users.noreply.github.com",
	]);
	for (const pull of batch.pulls) {
		run("git", [
			"fetch",
			"--no-tags",
			"origin",
			`refs/pull/${pull.number}/head`,
		]);
		if (run("git", ["rev-parse", "FETCH_HEAD"]) !== pull.head.sha)
			throw new Error(`PR #${pull.number} changed during fetch`);
		run(
			"git",
			[
				"merge",
				"--no-ff",
				"-m",
				`chore(ci): merge Dependabot PR #${pull.number}`,
				"FETCH_HEAD",
			],
			{ env: noToken },
		);
	}
	const sourcePath = "scripts/check-commit-subjects.test.mjs";
	const source = readFileSync(sourcePath, "utf8");
	const asserted = Object.fromEntries(
		Object.entries(updatedPins(files)).filter(([action]) =>
			source.includes(`${action}@`),
		),
	);
	if (Object.keys(asserted).length)
		writeFileSync(sourcePath, updateWorkflowPinExpectations(source, asserted));
	run("make", ["gen-plugin"], { env: noToken });
	run("make", ["test"], { env: noToken });
	run("git", ["add", "-A"]);
	if (run("git", ["diff", "--cached", "--name-only"])) {
		run(
			"git",
			[
				"commit",
				"-m",
				"fix(ci): synchronize generated assets for Dependabot Actions batch",
			],
			{ env: noToken },
		);
	}
	run("git", ["push", "origin", branch]);
	createFinalPr(
		branch,
		batch.pulls.map((p) => p.number),
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main();

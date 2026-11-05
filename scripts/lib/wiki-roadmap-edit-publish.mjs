import {
	lstatSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git as runGit, withoutGitTargetEnvironment } from "./run-exec.mjs";
import { generate, publish } from "./wiki-roadmap-generate.mjs";

const inputs = ["roadmap.pfdsl", "roadmap.md"];
const gitOutput = (cwd, ...args) =>
	runGit(["-C", cwd, ...args], {
		env: withoutGitTargetEnvironment(process.env),
		captureStderr: true,
	});
const git = (cwd, ...args) => gitOutput(cwd, ...args).trim();
const status = (wiki) =>
	gitOutput(wiki, "status", "--porcelain", "-z", "--untracked-files=all");
function readInputs(wiki) {
	return inputs.map((name) => {
		const path = join(wiki, name);
		if (!lstatSync(path).isFile())
			throw new Error(`Expected a regular file: ${name}`);
		return readFileSync(path);
	});
}

/** Validate unpublished editor changes, then publish source + generated view together. */
export function publishEdit({
	wiki,
	repository,
	cli,
	expectedRevision,
	expectedRemote = `https://github.com/${repository}.wiki.git`,
	temporaryRoot = tmpdir(),
	message = "docs(wiki): update the trial roadmap",
	roadmapSource,
	localSources,
}) {
	if (!/^[\w-]+\/[\w.-]+$/.test(repository ?? ""))
		throw new Error("Expected repository owner/name");
	wiki = realpathSync(wiki);
	if (realpathSync(git(wiki, "rev-parse", "--show-toplevel")) !== wiki)
		throw new Error("Wiki must be the checkout root");
	const baseRevision = git(wiki, "rev-parse", "HEAD");
	if (expectedRevision && expectedRevision !== baseRevision)
		throw new Error("Wiki revision conflict");
	if (git(wiki, "diff", "--cached", "--name-only"))
		throw new Error(
			"Wiki index must be clean; unstage edits before publishing",
		);
	const initialStatus = status(wiki);
	const changes = initialStatus.split("\0").filter(Boolean);
	if (
		changes.some(
			(entry) => !entry.startsWith(" M ") || !inputs.includes(entry.slice(3)),
		)
	)
		throw new Error("Edit only roadmap.pfdsl or roadmap.md before publishing");
	const bytes = readInputs(wiki);
	if (
		git(wiki, "remote", "get-url", "origin") !== expectedRemote ||
		git(wiki, "remote", "get-url", "--push", "origin") !== expectedRemote
	)
		throw new Error("Unexpected Wiki remote");
	const branch = git(wiki, "symbolic-ref", "--short", "HEAD");
	const remoteHead = git(wiki, "ls-remote", "--symref", "origin", "HEAD").match(
		/^ref: refs\/heads\/(.+)\tHEAD$/m,
	)?.[1];
	if (!remoteHead || branch !== remoteHead)
		throw new Error("Publish from the Wiki default branch");
	git(wiki, "fetch", "origin", branch);
	if (git(wiki, "rev-parse", "FETCH_HEAD") !== baseRevision)
		throw new Error(
			"Wiki remote conflict: refresh the published base without discarding your edits",
		);
	if (!changes.length)
		return { status: "unchanged", revision: baseRevision, localUpdated: true };
	const name = git(wiki, "config", "user.name"),
		email = git(wiki, "config", "user.email");
	if (!name || !email)
		throw new Error("Configure Git user.name and user.email before publishing");
	const root = mkdtempSync(join(temporaryRoot, "pfdsl-wiki-edit-"));
	const prepared = join(root, "wiki");
	let retain = false;
	let outcome;
	let failure;
	const unchanged = () =>
		git(wiki, "rev-parse", "HEAD") === baseRevision &&
		status(wiki) === initialStatus &&
		readInputs(wiki).every((value, index) => value.equals(bytes[index]));
	try {
		git(root, "clone", "--no-local", "--no-checkout", wiki, prepared);
		git(prepared, "switch", branch);
		if (git(prepared, "rev-parse", "HEAD") !== baseRevision)
			throw new Error("Wiki revision conflict during preparation");
		git(prepared, "remote", "set-url", "origin", expectedRemote);
		git(prepared, "config", "user.name", name);
		git(prepared, "config", "user.email", email);
		inputs.forEach((file, index) => {
			writeFileSync(join(prepared, file), bytes[index]);
		});
		git(prepared, "add", "--", ...inputs);
		git(prepared, "commit", "-m", message);
		const sourceRevision = git(prepared, "rev-parse", "HEAD");
		const result = generate({
			wiki: prepared,
			repository,
			cli,
			expectedRevision: sourceRevision,
			roadmapSource,
			localSources,
		});
		let publication;
		try {
			publication = publish({
				wiki: prepared,
				result,
				expectedRemote,
				expectedRemoteRevision: baseRevision,
				transportWiki: wiki,
			});
		} catch (error) {
			retain = true;
			error.recovery = {
				path: prepared,
				baseRevision,
				sourceRevision,
				preparedRevision: git(prepared, "rev-parse", "HEAD"),
			};
			throw error;
		}
		const localPending = (reason) => {
			retain = true;
			return {
				...publication,
				sourceRevision,
				baseRevision,
				localUpdated: false,
				localUpdateReason: reason,
				recoveryPath: prepared,
			};
		};
		try {
			if (!unchanged())
				return localPending(
					"Local edits changed during publication; preserved without updating the checkout",
				);
			// Matching staged input lets Git fast-forward without discarding editor work.
			git(wiki, "add", "--", ...inputs);
			git(wiki, "merge", "--ff-only", publication.revision);
		} catch (error) {
			return localPending(
				`Published successfully, but the local checkout needs synchronization: ${error.message}`,
			);
		}
		outcome = {
			...publication,
			sourceRevision,
			baseRevision,
			localUpdated: true,
		};
		return outcome;
	} catch (error) {
		failure = error;
		throw error;
	} finally {
		if (!retain) {
			try {
				rmSync(root, { recursive: true, force: true });
			} catch (error) {
				// Cleanup must not replace a known publication result or its primary error.
				Object.assign(outcome ?? failure, {
					cleanupWarning: `Temporary checkout cleanup failed: ${error.message}`,
					cleanupPath: root,
				});
			}
		}
	}
}

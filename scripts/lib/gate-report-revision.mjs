import { splitNulSeparated } from "./run-exec.mjs";

/** Resolve once: a ref moving during a report must not change its inputs. */
export function resolveReportRevision({ exec, base }) {
	const read = (args) => {
		const result = exec("git", args);
		if (!result.ok) throw new Error(result.out.trim());
		const sha = result.out.trim();
		if (!/^[0-9a-f]{40,64}$/.test(sha))
			throw new Error(`unresolved report revision: ${sha}`);
		return sha;
	};
	const head = read(["rev-parse", "--verify", "HEAD^{commit}"]);
	const baseTip = read(["rev-parse", "--verify", `origin/${base}^{commit}`]);
	const mergeBase = read(["merge-base", baseTip, head]);
	return { base, head, baseTip, mergeBase };
}

export function pinRevisionExec(exec, { base, head, baseTip }) {
	const refs = new Map([
		["HEAD", head],
		[`origin/${base}`, baseTip],
	]);
	const pin = (arg) => {
		if (refs.has(arg)) return refs.get(arg);
		for (const [ref, sha] of refs) {
			if (arg.startsWith(`${ref}:`)) return `${sha}${arg.slice(ref.length)}`;
		}
		for (const [left, leftSha] of refs) {
			for (const [right, rightSha] of refs) {
				for (const operator of ["..", "..."]) {
					if (arg === `${left}${operator}${right}`)
						return `${leftSha}${operator}${rightSha}`;
				}
			}
		}
		return arg;
	};
	return (file, args, input) => {
		if (file !== "git") return exec(file, args, input);
		const separator = args.indexOf("--");
		return exec(
			file,
			args.map((arg, index) =>
				separator >= 0 && index > separator ? arg : pin(arg),
			),
			input,
		);
	};
}

/** Zero bytes are valid only after the tree confirms that the path is absent. */
export function readRevisionBlob({ exec, ref, path }) {
	const listing = exec("git", [
		"ls-tree",
		"--name-only",
		"-z",
		ref,
		"--",
		path,
	]);
	if (!listing.ok)
		return { ok: false, error: `${ref}:${path}: ${listing.out.trim()}` };
	if (!splitNulSeparated(listing.out).includes(path))
		return { ok: true, exists: false, text: "" };
	const blob = exec("git", ["show", `${ref}:${path}`]);
	return blob.ok
		? { ok: true, exists: true, text: blob.out }
		: { ok: false, error: `${ref}:${path}: ${blob.out.trim()}` };
}

export function revisionPfdReaders({ exec, head }) {
	const read = (args) => {
		const result = exec("git", args);
		if (!result.ok) throw new Error(result.out.trim());
		return result.out;
	};
	return {
		readdirSync: (dir) =>
			splitNulSeparated(
				read(["ls-tree", "--name-only", "-z", `${head}:${dir}`]),
			),
		readFile: (path) => read(["show", `${head}:${path}`]),
	};
}

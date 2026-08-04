// The reviewed-state record for the distributed prompts: which bundled
// markdown is under review, where a finding in it must be fixed, and what has
// changed since the last approval.
//
// The bundle ships prose written by people sitting in this repository to
// people who are not. That prose keeps acquiring assumptions only an upstream
// reader can discharge — a path under .claude/ that the plugin cache has no
// equivalent of, an action ("promote this to the distributed layer") whose
// only doer is upstream. The class recurs through its own fixes: the PR that
// closed #340 introduced the wording that #674 later filed.
//
// So the record is a commit hash, advanced only by a review that simulated an
// adopting reader against the changed prose, and `make release` refuses to tag
// while the bundle has moved past it.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PLUGIN_MIRRORS } from "./gen-plugin.mjs";
import { git, tryGit } from "./run-exec.mjs";

/** git's empty tree — the diff base when nothing has been reviewed yet. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const DIST_ROOT = "plugin/pfdsl/";

/**
 * Bundled markdown held out of review, each with why. These three are
 * generated verbatim from documents whose subject is the DSL itself — its
 * grammar and its worked examples — not how to operate a repository with it.
 * They carry 3,308 of the bundle's 4,389 markdown lines, and reviewing them
 * against "can an adopter discharge this?" spends the review's whole budget on
 * text that never makes a claim about this repo's workbench.
 */
export const SCOPE_EXCLUSIONS = {
	"plugin/pfdsl/skills/pfdsl/references/spec.md":
		"the DSL grammar, generated from docs/spec/spec.md",
	"plugin/pfdsl/skills/pfdsl/references/examples.md":
		"worked .pfdsl examples, generated from docs/examples/",
	"plugin/pfdsl/skills/pfdsl/references/samples.md":
		"sample .pfdsl catalogue, generated from docs/samples/",
};

// Bundled files that are rendered rather than mirrored: the copy in the bundle
// is output, and editing it is editing something `make gen-plugin` overwrites.
const GENERATED_SOURCES = {
	"plugin/pfdsl/skills/pfdsl/SKILL.md": "scripts/skill-template/SKILL.md",
	"plugin/pfdsl/skills/pfdsl/references/spec.md": "docs/spec/spec.md",
	"plugin/pfdsl/skills/pfdsl/references/quality-guide.md":
		"docs/quality-guide.md",
	"plugin/pfdsl/skills/pfdsl/references/review-perspectives.md":
		"docs/review-perspectives.md",
	// Aggregated from many files, so the pointer is the directory: no single
	// source file answers "where does this line come from".
	"plugin/pfdsl/skills/pfdsl/references/examples.md": "docs/examples/",
	"plugin/pfdsl/skills/pfdsl/references/samples.md": "docs/samples/",
};

/** Where the reviewed-state record lives, relative to the repo root. */
export const RECORD_PATH = "docs/distribution-review/reviewed.json";

/** Is this path a distributed prompt that a review is answerable for? */
export function inScope(path) {
	if (!path.startsWith(DIST_ROOT)) return false;
	if (!path.endsWith(".md")) return false;
	return !(path in SCOPE_EXCLUSIONS);
}

/**
 * Where a finding in a bundled file must be fixed. The bundle is assembled, so
 * the file a reviewer reads is never the file they edit.
 *
 * Throws for a bundled file with no known origin. That is the interesting
 * case: it means the bundle grew a member this map does not know how to
 * attribute, and sending a reviewer to edit the generated copy would lose the
 * fix at the next `make gen-plugin`.
 */
export function canonicalSourceOf(distPath) {
	const generated = GENERATED_SOURCES[distPath];
	if (generated) return generated;

	// The inverse of the assembly's own manifest: find the bundle root this
	// path sits under, check the file is one gen-plugin actually copies there,
	// and swap the root back. Nothing about the layout is restated here.
	if (distPath.startsWith(DIST_ROOT)) {
		const [dir, ...tail] = distPath.slice(DIST_ROOT.length).split("/");
		const mirror = PLUGIN_MIRRORS.find((m) => m.dest === dir);
		const relative = tail.join("/");
		if (mirror && relative) {
			const members = mirror.trees ?? mirror.files;
			// A whole-tree mirror has no member list: everything under it ships.
			if (!members || members.includes(mirror.trees ? tail[0] : relative)) {
				return `${mirror.src}/${relative}`;
			}
		}
	}

	throw new Error(
		`no canonical source for ${distPath} — teach canonicalSourceOf where it is assembled from`,
	);
}

/** The in-scope subset of a `git diff --name-only` listing. */
export function unreviewedFiles(changedPaths) {
	return changedPaths.filter(inScope);
}

/** The commit to diff the working tree against, given the record. */
export function diffBase(record) {
	return record?.commit ?? EMPTY_TREE;
}

/**
 * The gate itself. Deps are injected so the decision can be tested without a
 * repository: readRecord returns the parsed record (null if there is none),
 * commitExists answers whether a hash is in this clone, and changedSince lists
 * paths that differ between a base and HEAD.
 *
 * Every failure path here is fail-closed. An absent record, an unreachable
 * commit and a moved prompt all block, because the alternative in each case is
 * to ship prose on the strength of a record that says nothing about it.
 */
export function runDistributionReviewCheck({
	readRecord,
	commitExists,
	changedSince,
}) {
	const record = readRecord();
	const base = diffBase(record);

	if (base !== EMPTY_TREE && !commitExists(base)) {
		return {
			ok: false,
			message: [
				`The reviewed commit ${base} is not in this clone.`,
				"Run git fetch (or git fetch --unshallow) and try again — the gate cannot",
				"tell what has changed since a commit it cannot read.",
			].join("\n"),
		};
	}

	const files = unreviewedFiles(changedSince(base));
	if (files.length === 0)
		return {
			ok: true,
			base,
			files,
			message: `Distribution review is current (base ${base}).`,
		};
	return {
		ok: false,
		base,
		files,
		message: formatGateFailure({ base, files }),
	};
}

/**
 * The real-repository deps for runDistributionReviewCheck. Exported so the
 * blocking check and the non-blocking status line reach the same verdict —
 * a second hand-rolled reading of the record would let status report "current"
 * where `make release` refuses, which is the surprise the status line exists
 * to prevent.
 * @param {string} root
 */
export function repoDeps(root) {
	return {
		readRecord: () => {
			const abs = resolve(root, RECORD_PATH);
			return existsSync(abs) ? JSON.parse(readFileSync(abs, "utf-8")) : null;
		},
		// A probe expected to fail when the record points somewhere this clone
		// cannot see, so its stderr is captured rather than printed as if
		// something broke — the gate's own message says it better.
		commitExists: (sha) =>
			tryGit(["cat-file", "-e", `${sha}^{commit}`], {
				cwd: root,
				captureStderr: true,
			}).ok,
		// HEAD, not the working tree: the record names a commit, so the
		// comparison that decides whether it still holds has to be against one
		// too. A release refuses to run on a dirty tree anyway (release.mjs).
		changedSince: (base) =>
			git(["diff", "--name-only", base, "HEAD", "--", "plugin/pfdsl"], {
				cwd: root,
			})
				.trim()
				.split("\n")
				.filter(Boolean),
	};
}

export function formatGateFailure({ base, files }) {
	const preface =
		base === EMPTY_TREE
			? "The distributed bundle has never been reviewed."
			: `Distributed prompts have changed since the reviewed commit ${base}.`;
	const rows = files.map(
		(file) => `  ${file}\n    fix in: ${canonicalSourceOf(file)}`,
	);
	return [
		preface,
		`${files.length} file(s) are not covered by the review record:`,
		...rows,
		"",
		"Run the distribution-review skill (diff mode) to review them, fix what it finds,",
		"and record the reviewed commit in docs/distribution-review/reviewed.json.",
	].join("\n");
}

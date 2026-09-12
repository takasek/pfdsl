import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validateCapabilityContract } from "./harness-capability-contract.mjs";
import { HARNESS_CAPABILITY_CONTRACT } from "./harness-inventory.mjs";
import { decodeHarnessSources } from "./harness-source-decoder.mjs";

const ROOT = "/fixture";
const REPOSITORY_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const FIXTURE_SOURCE_EXCLUSIONS = {
	root: { "pfd-ops-install-manifest.json": "fixture install manifest" },
	skills: {},
	commands: {},
	agents: {},
};

const FIXTURE_SOURCE_FILES = {
	"CLAUDE.md": "repository instructions\n",
	".claude/commands/pfd-cycle.md":
		"---\ndescription: Run the cycle.\n---\n\ncommand body\n",
	".claude/agents/pfd-lens.md":
		"---\nname: pfd-lens\ndescription: Inspect a graph.\ntools: Read, Grep, Bash\nmodel: sonnet\n---\n\nagent body\n",
	".claude/skills/pfd-ops/SKILL.md":
		"---\nname: pfd-ops\nsummary: fixture operations\ndescription: fixture\n---\nbody\n",
	".claude/pfd-ops-install-manifest.json": '{"files": []}\n',
	".claude/settings.json":
		'{"permissions":{"allow":["Bash(node scripts/*)"]},"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node hook.mjs","timeout":10}]}]}}\n',
	"hooks/hooks.json":
		'{"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node hook.mjs","timeout":10}]}]}}\n',
	"packages/cli/package.json": '{"version":"1.2.3"}\n',
};

const GENERATED_SKILL_SOURCE =
	"---\nname: pfdsl\nsummary: fixture syntax\ndescription: fixture\n---\nbody\n";

function source(id, kind, encoding, path, extra = {}) {
	return { id, kind, source: { encoding, path, ...extra }, mappings: [] };
}

const CONTRACT = [
	source("skill:pfd-ops", "skill", "claude-skill", ".claude/skills/pfd-ops", {
		files: ["SKILL.md"],
	}),
	source("skill:pfdsl", "skill", "claude-skill", ".claude/skills/pfdsl", {
		generated: {
			reason: "generated symlink",
			target: "generated/skills/pfdsl",
		},
	}),
	source(
		"command:pfd-cycle",
		"command",
		"claude-command",
		".claude/commands/pfd-cycle.md",
	),
	source(
		"agent:pfd-lens",
		"agent",
		"claude-agent",
		".claude/agents/pfd-lens.md",
	),
	source(
		"repository-instructions",
		"repository-instructions",
		"claude-root-instructions",
		"CLAUDE.md",
	),
	source(
		"repository-hooks",
		"repository-hooks",
		"claude-settings",
		".claude/settings.json",
	),
	source("plugin-hooks", "hook", "plugin-hooks", "hooks/hooks.json"),
	source(
		"plugin-metadata",
		"plugin-metadata",
		"cli-package-metadata",
		"packages/cli/package.json",
		{
			identity: {
				name: "pfdsl",
				author: { name: "takasek" },
				homepage: "https://github.com/takasek/pfdsl",
				license: "MIT",
			},
		},
	),
];

function fixture() {
	const nodes = new Map();
	const directories = new Set([ROOT]);

	function addParents(path) {
		const parts = path.split("/");
		for (let index = 2; index < parts.length; index += 1) {
			directories.add(parts.slice(0, index).join("/"));
		}
	}

	function addFile(relativePath, content) {
		const path = `${ROOT}/${relativePath}`;
		addParents(path);
		nodes.set(path, { type: "file", content });
	}

	function addDirectory(relativePath) {
		const path = `${ROOT}/${relativePath}`;
		addParents(path);
		directories.add(path);
	}

	function addSymlink(relativePath) {
		const path = `${ROOT}/${relativePath}`;
		addParents(path);
		nodes.set(path, { type: "symlink" });
	}

	for (const [relativePath, content] of Object.entries(FIXTURE_SOURCE_FILES)) {
		addFile(relativePath, content);
	}
	addDirectory(".claude/skills/pfd-ops");
	addSymlink(".claude/skills/pfdsl");
	addFile(".claude/skills/pfdsl/SKILL.md", GENERATED_SKILL_SOURCE);

	return {
		addFile,
		addDirectory,
		addSymlink,
		fs: {
			lstatSync(path) {
				const node = nodes.get(path);
				if (node) {
					return {
						isDirectory: () => false,
						isFile: () => node.type === "file",
						isSymbolicLink: () => node.type === "symlink",
					};
				}
				if (directories.has(path)) {
					return {
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					};
				}
				throw new Error(`missing fixture path ${path}`);
			},
			readFileSync(path) {
				const node = nodes.get(path);
				if (!node || node.type !== "file") {
					throw new Error(`fixture path is not a file ${path}`);
				}
				return node.content;
			},
			readdirSync(path) {
				if (!directories.has(path)) {
					throw new Error(`fixture path is not a directory ${path}`);
				}
				const prefix = `${path}/`;
				const candidates = [...directories, ...nodes.keys()];
				return [
					...new Set(
						candidates
							.filter((candidate) => candidate.startsWith(prefix))
							.map((candidate) => candidate.slice(prefix.length))
							.filter((candidate) => !candidate.includes("/")),
					),
				].sort();
			},
		},
	};
}

function expectTopologyFailure(subject, relativePath, name) {
	assert.throws(
		() => decodeFixture(subject),
		(error) => {
			assert.match(error.message, /source-topology/);
			assert.match(error.message, new RegExp(`${ROOT}/${relativePath}`));
			assert.match(error.message, new RegExp(name));
			return true;
		},
	);
}

function expectSchemaFailure(subject, relativePath, surface, name) {
	assert.throws(
		() => decodeFixture(subject),
		(error) => {
			assert.match(error.message, /source-schema/);
			assert.match(error.message, new RegExp(`${ROOT}/${relativePath}`));
			assert.match(error.message, new RegExp(surface));
			assert.match(error.message, new RegExp(name));
			return true;
		},
	);
}

function decodeFixture({ root, contract, fs, isIgnored }) {
	return decodeHarnessSources({
		root,
		contract,
		fs,
		sourceExclusions: FIXTURE_SOURCE_EXCLUSIONS,
		...(isIgnored === undefined ? {} : { isIgnored }),
	});
}

/**
 * The same sources `fixture()` describes, written to disk inside a throwaway
 * Git repository, so the default ignore oracle answers from real `git
 * check-ignore` output instead of an injected stub.
 */
function onDiskFixture({ gitignore = "dist/\n", repository = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "harness-source-decoder-"));
	if (repository) execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, ".gitignore"), gitignore);
	for (const [relativePath, content] of Object.entries(FIXTURE_SOURCE_FILES)) {
		const path = join(root, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
	const generatedSkill = join(root, "generated/skills/pfdsl");
	mkdirSync(generatedSkill, { recursive: true });
	writeFileSync(join(generatedSkill, "SKILL.md"), GENERATED_SKILL_SOURCE);
	symlinkSync(
		"../../generated/skills/pfdsl",
		join(root, ".claude/skills/pfdsl"),
		"dir",
	);
	return root;
}

function decodeOnDisk(root) {
	return decodeHarnessSources({
		root,
		contract: CONTRACT,
		sourceExclusions: FIXTURE_SOURCE_EXCLUSIONS,
	});
}

function commitAll(root) {
	execFileSync("git", ["add", "-A", "-f"], { cwd: root });
	execFileSync(
		"git",
		[
			"-c",
			"user.email=t@example.com",
			"-c",
			"user.name=t",
			"commit",
			"-qm",
			"f",
		],
		{ cwd: root },
	);
}

function recordFor(records, id) {
	const record = records.find((candidate) => candidate.id === id);
	assert.ok(record, `expected record ${id}`);
	return record;
}

describe("harness source decoder", () => {
	it("rejects every unclassified maintained source topology entry", () => {
		const cases = [
			{
				add: (subject) => subject.addDirectory(".claude/new-surface"),
				path: ".claude/new-surface",
				name: "new-surface",
			},
			{
				add: (subject) => subject.addDirectory(".claude/skills/new-skill"),
				path: ".claude/skills/new-skill",
				name: "new-skill",
			},
			{
				add: (subject) =>
					subject.addFile(".claude/commands/new-command.md", "body\n"),
				path: ".claude/commands/new-command.md",
				name: "new-command.md",
			},
			{
				add: (subject) =>
					subject.addFile(".claude/agents/new-agent.md", "body\n"),
				path: ".claude/agents/new-agent.md",
				name: "new-agent.md",
			},
			{
				add: (subject) => subject.addFile(".claude/unclassified.json", "{}\n"),
				path: ".claude/unclassified.json",
				name: "unclassified.json",
			},
		];

		for (const testCase of cases) {
			const subject = fixture();
			testCase.add(subject);
			expectTopologyFailure(
				{ root: ROOT, contract: CONTRACT, fs: subject.fs },
				testCase.path,
				testCase.name,
			);
		}
	});

	it("tolerates the developer-local entries under .claude/, present or absent", () => {
		// These are gitignored, so they are neither a distributed source nor a
		// maintained artifact, and a checkout may or may not have them. Listing
		// them in SOURCE_EXCLUSIONS.root would not do: that loop asserts each entry
		// exists, and asserts it is a file — which rules out `worktrees/`.
		const outcome = (subject) => {
			try {
				decodeFixture({ root: ROOT, contract: CONTRACT, fs: subject.fs });
				return "ok";
			} catch (error) {
				return error.message;
			}
		};

		const present = fixture();
		present.addFile(".claude/settings.local.json", "{}\n");
		// A directory, which is why the file-typed exclusion set cannot hold it.
		present.addDirectory(".claude/worktrees/scratch");
		const absent = fixture();

		// Both decode, so the file is invisible rather than merely failing the same
		// way twice — asserting only equality would pass on two identical failures.
		assert.equal(outcome(absent), "ok");
		assert.equal(outcome(present), "ok");
	});

	it("tolerates OS-generated .DS_Store files throughout maintained source topology", () => {
		const paths = [
			".claude/.DS_Store",
			".claude/skills/.DS_Store",
			".claude/commands/.DS_Store",
			".claude/agents/.DS_Store",
			".claude/skills/pfd-ops/.DS_Store",
		];

		for (const path of paths) {
			const subject = fixture();
			subject.addFile(path, "Finder metadata\n");
			assert.doesNotThrow(
				() => decodeFixture({ root: ROOT, contract: CONTRACT, fs: subject.fs }),
				path,
			);
		}
	});

	it("rejects .DS_Store near misses in maintained source topology", () => {
		const subject = fixture();
		subject.addFile(
			".claude/skills/pfd-ops/.DS_Store.backup",
			"maintained content\n",
		);

		expectTopologyFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/skills/pfd-ops/.DS_Store.backup",
			".DS_Store.backup",
		);
	});

	it("skips unclassified entries the repository's Git ignores, at every depth", () => {
		const cases = [
			{
				add: (subject) => subject.addDirectory(".claude/dist"),
				query: ".claude/dist/",
			},
			{
				add: (subject) => subject.addDirectory(".claude/skills/dist"),
				query: ".claude/skills/dist/",
			},
			{
				add: (subject) => subject.addDirectory(".claude/skills/pfd-ops/dist"),
				query: ".claude/skills/pfd-ops/dist/",
			},
			{
				add: (subject) =>
					subject.addFile(".claude/skills/pfd-ops/scratch.log", "scratch\n"),
				query: ".claude/skills/pfd-ops/scratch.log",
			},
			{
				add: (subject) =>
					subject.addFile(".claude/commands/scratch.log", "scratch\n"),
				query: ".claude/commands/scratch.log",
			},
			{
				add: (subject) =>
					subject.addFile(".claude/agents/scratch.log", "scratch\n"),
				query: ".claude/agents/scratch.log",
			},
			{
				add: (subject) => subject.addFile(".claude/scratch.log", "scratch\n"),
				query: ".claude/scratch.log",
			},
		];

		for (const testCase of cases) {
			const subject = fixture();
			testCase.add(subject);
			const asked = [];
			const isIgnored = (queryPath) => {
				asked.push(queryPath);
				return queryPath === testCase.query;
			};

			assert.doesNotThrow(
				() =>
					decodeFixture({
						root: ROOT,
						contract: CONTRACT,
						fs: subject.fs,
						isIgnored,
					}),
				testCase.query,
			);
			// One question, about the one entry classification could not place:
			// a tree with nothing stray never reaches Git at all. Directories
			// carry the trailing "/" that tells `check-ignore` the queried path
			// is a directory, which is what a directory-only rule (`dist/`) needs
			// to match the entry itself rather than only files below it.
			assert.deepEqual(asked, [testCase.query]);
		}
	});

	it("reports an unclassified entry the repository does not ignore", () => {
		const subject = fixture();
		subject.addDirectory(".claude/skills/pfd-ops/dist");

		expectTopologyFailure(
			{
				root: ROOT,
				contract: CONTRACT,
				fs: subject.fs,
				isIgnored: () => false,
			},
			".claude/skills/pfd-ops/dist",
			"dist",
		);
	});

	it("asks the real Git which unclassified entries the repository ignores", () => {
		const root = onDiskFixture();
		try {
			mkdirSync(join(root, ".claude/skills/pfd-ops/dist"), { recursive: true });
			writeFileSync(
				join(root, ".claude/skills/pfd-ops/dist/x.txt"),
				"build output\n",
			);
			assert.doesNotThrow(() => decodeOnDisk(root));

			writeFileSync(
				join(root, ".claude/skills/pfd-ops/claude-only.md"),
				"maintained content\n",
			);
			assert.throws(() => decodeOnDisk(root), /source-topology: .*claude-only/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports a tracked entry even when an ignore rule matches its name", () => {
		// `git check-ignore` consults the index, so a force-added `dist/` reads
		// as tracked rather than ignored. Without that distinction the oracle
		// would wave through a maintained source whose name happens to collide
		// with an ignore rule.
		const root = onDiskFixture();
		try {
			mkdirSync(join(root, ".claude/skills/pfd-ops/dist"), { recursive: true });
			writeFileSync(
				join(root, ".claude/skills/pfd-ops/dist/x.txt"),
				"maintained content\n",
			);
			commitAll(root);

			assert.throws(() => decodeOnDisk(root), /source-topology: .*dist/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports an unclassified entry when Git cannot answer at all", () => {
		// Outside a repository there is no ignore state to consult, so the entry
		// stays unclassified rather than passing on an unanswered question.
		const root = onDiskFixture({ repository: false });
		try {
			mkdirSync(join(root, ".claude/skills/pfd-ops/dist"), { recursive: true });
			writeFileSync(join(root, ".claude/skills/pfd-ops/dist/x.txt"), "junk\n");

			assert.throws(() => decodeOnDisk(root), /source-topology: .*dist/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects an unknown maintained skill descendant instead of silently shipping it", () => {
		const subject = fixture();
		subject.addFile(
			".claude/skills/pfd-ops/claude-only.md",
			"Claude-only behavior\n",
		);

		expectTopologyFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/skills/pfd-ops/claude-only.md",
			"claude-only.md",
		);
	});

	it("uses each schema-validated source value exactly once for semantic decoding", () => {
		const subject = fixture();
		const secondRead = new Map([
			[
				`${ROOT}/.claude/commands/pfd-cycle.md`,
				"---\ndescription: Run the cycle.\nallowed-tools: Bash\n---\n\ncommand body\n",
			],
			[
				`${ROOT}/.claude/agents/pfd-lens.md`,
				"---\nname: pfd-lens\ndescription: Inspect a graph.\ntools: Read, Grep, Bash\nmodel: sonnet\nallowed-tools: Bash\n---\n\nagent body\n",
			],
			[
				`${ROOT}/.claude/settings.json`,
				'{"permissions":{"allow":["Bash(node scripts/*)"]},"hooks":{},"allowed-tools":"Bash"}\n',
			],
			[`${ROOT}/hooks/hooks.json`, '{"hooks":{},"allowed-tools":"Bash"}\n'],
		]);
		const reads = new Map();
		const changingFs = {
			...subject.fs,
			readFileSync(path) {
				if (!secondRead.has(path)) return subject.fs.readFileSync(path);
				const count = (reads.get(path) ?? 0) + 1;
				reads.set(path, count);
				return count === 1
					? subject.fs.readFileSync(path)
					: secondRead.get(path);
			},
		};

		decodeFixture({ root: ROOT, contract: CONTRACT, fs: changingFs });

		assert.deepEqual(Object.fromEntries(reads), {
			[`${ROOT}/.claude/commands/pfd-cycle.md`]: 1,
			[`${ROOT}/.claude/agents/pfd-lens.md`]: 1,
			[`${ROOT}/.claude/settings.json`]: 1,
			[`${ROOT}/hooks/hooks.json`]: 1,
		});
	});

	it("rejects unknown command frontmatter instead of omitting a command behavior", () => {
		const subject = fixture();
		subject.addFile(
			".claude/commands/pfd-cycle.md",
			"---\ndescription: Run the cycle.\nunknown: true\n---\n\ncommand body\n",
		);

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/commands/pfd-cycle.md",
			"claude-command",
			"unknown",
		);
	});

	it("rejects unknown agent frontmatter instead of omitting an agent behavior", () => {
		const subject = fixture();
		subject.addFile(
			".claude/agents/pfd-lens.md",
			"---\nname: pfd-lens\ndescription: Inspect a graph.\ntools: Read, Grep, Bash\nmodel: sonnet\nunknown: true\n---\n\nagent body\n",
		);

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/agents/pfd-lens.md",
			"claude-agent",
			"unknown",
		);
	});

	it("rejects an unknown settings field instead of dropping repository configuration", () => {
		const subject = fixture();
		subject.addFile(
			".claude/settings.json",
			'{"permissions":{"allow":["Bash(node scripts/*)"]},"hooks":{},"unknown":true}\n',
		);

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/settings.json",
			"claude-settings",
			"unknown",
		);
	});

	it("rejects an unknown permissions field instead of dropping a permission", () => {
		const subject = fixture();
		subject.addFile(
			".claude/settings.json",
			'{"permissions":{"allow":["Bash(node scripts/*)"],"unknown":true},"hooks":{}}\n',
		);

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/settings.json",
			"claude-settings",
			"unknown",
		);
	});

	it("rejects an unknown hook event instead of omitting a lifecycle handler", () => {
		const subject = fixture();
		subject.addFile(
			".claude/settings.json",
			'{"permissions":{"allow":["Bash(node scripts/*)"]},"hooks":{"UnknownEvent":[]}}\n',
		);

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/settings.json",
			"claude-settings",
			"UnknownEvent",
		);
	});

	it("rejects an unknown matcher entry field instead of weakening hook selection", () => {
		const subject = fixture();
		subject.addFile(
			".claude/settings.json",
			'{"permissions":{"allow":["Bash(node scripts/*)"]},"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[],"unknown":true}]}}\n',
		);

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/settings.json",
			"claude-settings",
			"unknown",
		);
	});

	it("rejects an unknown hook command field instead of changing hook execution", () => {
		const subject = fixture();
		subject.addFile(
			".claude/settings.json",
			'{"permissions":{"allow":["Bash(node scripts/*)"]},"hooks":{"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"node hook.mjs","timeout":10,"unknown":true}]}]}}\n',
		);

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			".claude/settings.json",
			"claude-settings",
			"unknown",
		);
	});

	it("rejects an unknown plugin hooks root field instead of dropping plugin behavior", () => {
		const subject = fixture();
		subject.addFile("hooks/hooks.json", '{"hooks":{},"unknown":true}\n');

		expectSchemaFailure(
			{ root: ROOT, contract: CONTRACT, fs: subject.fs },
			"hooks/hooks.json",
			"plugin-hooks",
			"unknown",
		);
	});

	it("decodes hand-calculated source semantics without adapter output text", () => {
		const subject = fixture();
		const records = decodeFixture({
			root: ROOT,
			contract: CONTRACT,
			fs: subject.fs,
		});

		assert.deepEqual(recordFor(records, "skill:pfd-ops").semantic, {
			files: ["SKILL.md"],
			summary: "fixture operations",
		});
		assert.deepEqual(recordFor(records, "command:pfd-cycle").semantic, {
			description: "Run the cycle.",
			body: "\ncommand body\n",
		});
		assert.deepEqual(recordFor(records, "agent:pfd-lens").semantic, {
			name: "pfd-lens",
			description: "Inspect a graph.",
			tools: "Read, Grep, Bash",
			model: "sonnet",
			body: "\nagent body\n",
		});
		assert.deepEqual(recordFor(records, "repository-instructions").semantic, {
			body: "repository instructions\n",
		});
		assert.deepEqual(recordFor(records, "repository-hooks").semantic, {
			permissions: { allow: ["Bash(node scripts/*)"] },
			hooks: {
				PostToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "node hook.mjs", timeout: 10 }],
					},
				],
			},
		});
		assert.deepEqual(recordFor(records, "plugin-hooks").semantic, {
			hooks: {
				PostToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "node hook.mjs", timeout: 10 }],
					},
				],
			},
		});
		assert.deepEqual(recordFor(records, "plugin-metadata").semantic, {
			version: "1.2.3",
			identity: {
				name: "pfdsl",
				author: { name: "takasek" },
				homepage: "https://github.com/takasek/pfdsl",
				license: "MIT",
			},
		});
	});

	it("fails closed when a skill summary is absent or unsupported", () => {
		for (const summaryLine of ["", "summary:\n  - unsupported"]) {
			const subject = fixture();
			subject.addFile(
				".claude/skills/pfd-ops/SKILL.md",
				`---\nname: pfd-ops\n${summaryLine}\ndescription: fixture\n---\nbody\n`,
			);
			assert.throws(
				() => decodeFixture({ root: ROOT, contract: CONTRACT, fs: subject.fs }),
				/source-schema: claude-skill: .*SKILL\.md: .*summary/,
			);
		}
	});

	it("decodes the real maintained sources into contract-valid semantic records", () => {
		const records = decodeHarnessSources({ root: REPOSITORY_ROOT });

		assert.equal(records.length, HARNESS_CAPABILITY_CONTRACT.length);
		assert.equal(
			typeof recordFor(records, "command:pfd-cycle").semantic.description,
			"string",
		);
		assert.equal(
			typeof recordFor(records, "agent:pfd-lens").semantic.model,
			"string",
		);
		assert.equal(
			typeof recordFor(records, "repository-hooks").semantic.hooks,
			"object",
		);
		assert.doesNotThrow(() =>
			validateCapabilityContract(records, {
				probeKinds: new Set([
					"claude-repository-consumer",
					"claude-plugin-consumer",
					"codex-repository-consumer",
					"codex-plugin-consumer",
				]),
			}),
		);
	});

	it("freezes semantic records so adapters cannot mutate decoded source data", () => {
		const records = decodeFixture({
			root: ROOT,
			contract: CONTRACT,
			fs: fixture().fs,
		});

		assert.equal(Object.isFrozen(records), true);
		assert.equal(
			Object.isFrozen(recordFor(records, "command:pfd-cycle")),
			true,
		);
		assert.equal(
			Object.isFrozen(recordFor(records, "command:pfd-cycle").semantic),
			true,
		);
		assert.throws(() => {
			recordFor(
				records,
				"repository-hooks",
			).semantic.hooks.PostToolUse[0].matcher = "Edit";
		}, TypeError);
	});

	it("returns the same records when filesystem enumeration order changes", () => {
		const forward = fixture();
		const reverse = fixture();
		const reverseFs = {
			...reverse.fs,
			readdirSync(path) {
				return reverse.fs.readdirSync(path).reverse();
			},
		};

		assert.deepEqual(
			decodeFixture({ root: ROOT, contract: CONTRACT, fs: forward.fs }),
			decodeFixture({ root: ROOT, contract: CONTRACT, fs: reverseFs }),
		);
	});
});

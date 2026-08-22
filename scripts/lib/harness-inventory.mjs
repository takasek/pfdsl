// The maintained product inventory is harness-neutral; adapters decide how
// each source entry is rendered for their target harness.
export const DISTRIBUTED_SKILLS = Object.freeze([
	"pfd-grill",
	"pfd-ops",
	"pfd-retro",
	"pfd-ecosystem",
]);

export const DISTRIBUTED_COMMANDS = Object.freeze([
	"pfd-cycle.md",
	"pfd-init.md",
	"pfd-retro.md",
]);

export const DISTRIBUTED_AGENTS = Object.freeze([
	"pfd-lens.md",
	"pfd-implementer.md",
]);

export const SOURCE_EXCLUSIONS = Object.freeze({
	skills: Object.freeze({
		"distribution-review": "maintainer-only review workflow for this bundle",
		"prose-mechanization-audit": "audits this repository's prose assets",
		"retro-pattern-sweep": "audits this repository's retro pattern ledger",
		"spec-history-finalize": "finalizes this repository's release history",
		"spec-stress-test": "hardens this repository's normative specification",
		"vscode-ext-debug": "debugs the extension this repository builds",
	}),
	commands: Object.freeze({}),
	agents: Object.freeze({
		"ci-triage.md": "reads this repo's GitHub Actions logs",
		"issue-worker.md": "encodes this repo's worktree and PR conventions",
		"local-check-triage.md":
			"triages this repo's make/pre-commit/test failures",
		"vscode-ext-debugger.md": "debugs the extension this repo builds",
	}),
});

export const GENERATED_SOURCES = Object.freeze({
	skills: Object.freeze({
		pfdsl: Object.freeze({
			reason: "generated symlink to the rendered plugin skill tree",
			source: ".claude/skills/pfdsl",
			target: "plugin/pfdsl/skills/pfdsl",
		}),
	}),
	commands: Object.freeze({}),
	agents: Object.freeze({}),
});

export const SKILL_EXCLUSIONS = SOURCE_EXCLUSIONS.skills;
export const COMMAND_EXCLUSIONS = SOURCE_EXCLUSIONS.commands;
export const AGENT_EXCLUSIONS = SOURCE_EXCLUSIONS.agents;
export const GENERATED_SKILLS = GENERATED_SOURCES.skills;
export const GENERATED_COMMANDS = GENERATED_SOURCES.commands;
export const GENERATED_AGENTS = GENERATED_SOURCES.agents;

export const CLAUDE_PLUGIN_MIRRORS = Object.freeze([
	Object.freeze({
		dest: "skills",
		src: ".claude/skills",
		trees: DISTRIBUTED_SKILLS,
	}),
	Object.freeze({
		dest: "commands",
		src: ".claude/commands",
		files: DISTRIBUTED_COMMANDS,
	}),
	Object.freeze({
		dest: "agents",
		src: ".claude/agents",
		files: DISTRIBUTED_AGENTS,
	}),
	Object.freeze({ dest: "hooks", src: "hooks", whole: true }),
]);

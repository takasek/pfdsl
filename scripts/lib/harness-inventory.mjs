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

export const AGENT_EXCLUSIONS = Object.freeze({
	"ci-triage.md": "reads this repo's GitHub Actions logs",
	"issue-worker.md": "encodes this repo's worktree and PR conventions",
	"local-check-triage.md": "triages this repo's make/pre-commit/test failures",
	"vscode-ext-debugger.md": "debugs the extension this repo builds",
});

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

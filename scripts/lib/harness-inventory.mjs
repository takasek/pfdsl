// The maintained product inventory is harness-neutral; adapters decide how
// each source entry is rendered for their target harness.
const PROBES = Object.freeze({
	claudeRepository: "claude-repository-consumer",
	claudePlugin: "claude-plugin-consumer",
	codexRepository: "codex-repository-consumer",
	codexPlugin: "codex-plugin-consumer",
});

function mapping(target, disposition, outputs, probe) {
	return Object.freeze({
		target,
		disposition,
		outputs: Object.freeze(outputs),
		probe: Object.freeze({ kind: probe }),
	});
}

const SKILL_SOURCE_FILES = Object.freeze({
	"pfd-ecosystem": Object.freeze(["SKILL.md", "references/kind-taxonomy.md"]),
	"pfd-grill": Object.freeze(["SKILL.md"]),
	"pfd-ops": Object.freeze([
		"SKILL.md",
		"install/.github/workflows/pfdsl-flow-on-issue-close.yml",
		"install/scripts/pfdsl/audit-issues-flow.mjs",
		"install/scripts/pfdsl/lib/gh-compat.mjs",
		"install/scripts/pfdsl/lib/gh-exec.mjs",
		"install/scripts/pfdsl/lib/github-rest.mjs",
		"install/scripts/pfdsl/lib/issues-flow-audit.mjs",
		"install/scripts/pfdsl/lib/proxy-fetch-worker.mjs",
		"install/scripts/pfdsl/lib/proxy-fetch.mjs",
		"install/scripts/pfdsl/lib/yaml-require.mjs",
		"install/scripts/pfdsl/normalize-pfdsl.mjs",
		"references/architecture.md",
		"references/file-based-tracker-backend.md",
		"references/github-issues-backend.md",
		"references/scaffold/bindings/pfd-ops.md",
		"references/scaffold/bindings/pfd-retro-patterns/sample-pattern.md",
		"references/scaffold/bindings/pfd-retro.md",
		"references/scaffold/review-perspectives.md",
		"references/scaffold/roadmap.md",
		"references/scaffold/roadmap.pfdsl",
		"references/scaffold/runtime-pipeline.md",
		"references/scaffold/runtime-pipeline.pfdsl",
		"references/scaffold/workflow.md",
		"references/scaffold/workflow.pfdsl",
		"references/work-cycle.md",
		"scripts/check-install-sync.mjs",
		"scripts/collect-report-environment.mjs",
		"scripts/plugin-version-check.mjs",
	]),
	"pfd-retro": Object.freeze(["SKILL.md"]),
});

function exclusion(target, reason, impact) {
	return Object.freeze({
		target,
		disposition: "intentional-exclusion",
		reason,
		impact,
	});
}

function fourTargetMappings(
	claudeRepository,
	claudePlugin,
	codexRepository,
	codexPlugin,
) {
	return Object.freeze([
		claudeRepository,
		claudePlugin,
		codexRepository,
		codexPlugin,
	]);
}

function capability(id, kind, source, mappings) {
	return Object.freeze({
		id,
		kind,
		source: Object.freeze(source),
		mappings,
	});
}

function skillCapability(name, source = {}) {
	const files = SKILL_SOURCE_FILES[name];
	return capability(
		`skill:${name}`,
		"skill",
		{
			encoding: "claude-skill",
			path: `.claude/skills/${name}`,
			...(files ? { files } : {}),
			...source,
		},
		fourTargetMappings(
			mapping(
				"claude-repository",
				"native",
				[`.claude/skills/${name}`],
				PROBES.claudeRepository,
			),
			mapping(
				"claude-plugin",
				"native",
				[`skills/${name}`],
				PROBES.claudePlugin,
			),
			mapping(
				"codex-repository",
				"transform",
				[`.agents/skills/${name}`],
				PROBES.codexRepository,
			),
			mapping(
				"codex-plugin",
				"transform",
				[`skills/${name}`],
				PROBES.codexPlugin,
			),
		),
	);
}

function commandCapability(name) {
	const codexSkillName =
		name === "pfd-retro" ? "source-command-pfd-retro" : name;
	return capability(
		`command:${name}`,
		"command",
		{ encoding: "claude-command", path: `.claude/commands/${name}.md` },
		fourTargetMappings(
			mapping(
				"claude-repository",
				"native",
				[`.claude/commands/${name}.md`],
				PROBES.claudeRepository,
			),
			mapping(
				"claude-plugin",
				"native",
				[`commands/${name}.md`],
				PROBES.claudePlugin,
			),
			mapping(
				"codex-repository",
				"transform",
				[`.agents/skills/${codexSkillName}`],
				PROBES.codexRepository,
			),
			mapping(
				"codex-plugin",
				"transform",
				[`skills/${codexSkillName}`],
				PROBES.codexPlugin,
			),
		),
	);
}

function agentCapability(name) {
	return capability(
		`agent:${name}`,
		"agent",
		{ encoding: "claude-agent", path: `.claude/agents/${name}.md` },
		fourTargetMappings(
			mapping(
				"claude-repository",
				"native",
				[`.claude/agents/${name}.md`],
				PROBES.claudeRepository,
			),
			mapping(
				"claude-plugin",
				"native",
				[`agents/${name}.md`],
				PROBES.claudePlugin,
			),
			mapping(
				"codex-repository",
				"transform",
				[`.codex/agents/${name}.toml`],
				PROBES.codexRepository,
			),
			exclusion(
				"codex-plugin",
				"Codex plugin manifests do not support subagent declarations.",
				"Codex plugin users cannot invoke the repository's pfd subagents.",
			),
		),
	);
}

export const HARNESS_CAPABILITY_CONTRACT = Object.freeze([
	skillCapability("pfd-grill"),
	skillCapability("pfd-ops"),
	skillCapability("pfd-retro"),
	skillCapability("pfd-ecosystem"),
	skillCapability("pfdsl", {
		generated: Object.freeze({
			reason: "generated symlink to the neutral rendered skill tree",
			target: "generated/skills/pfdsl",
		}),
	}),
	commandCapability("pfd-cycle"),
	commandCapability("pfd-init"),
	commandCapability("pfd-retro"),
	agentCapability("pfd-lens"),
	agentCapability("pfd-implementer"),
	capability(
		"repository-instructions",
		"repository-instructions",
		{ encoding: "claude-root-instructions", path: "CLAUDE.md" },
		fourTargetMappings(
			mapping(
				"claude-repository",
				"native",
				["CLAUDE.md"],
				PROBES.claudeRepository,
			),
			exclusion(
				"claude-plugin",
				"Repository instructions are not bundled with a Claude plugin.",
				"Claude plugin users do not receive repository maintainer instructions.",
			),
			mapping(
				"codex-repository",
				"transform",
				["AGENTS.md"],
				PROBES.codexRepository,
			),
			exclusion(
				"codex-plugin",
				"Repository instructions are not bundled with a Codex plugin.",
				"Codex plugin users do not receive repository maintainer instructions.",
			),
		),
	),
	capability(
		"repository-hooks",
		"repository-hooks",
		{ encoding: "claude-settings", path: ".claude/settings.json" },
		fourTargetMappings(
			mapping(
				"claude-repository",
				"native",
				[".claude/settings.json"],
				PROBES.claudeRepository,
			),
			exclusion(
				"claude-plugin",
				"Claude plugin hooks are declared by the plugin hook capability.",
				"Claude plugin users receive only plugin-scoped hook registration.",
			),
			mapping(
				"codex-repository",
				"transform",
				[".codex/config.toml", ".codex/hooks.json"],
				PROBES.codexRepository,
			),
			exclusion(
				"codex-plugin",
				"Repository hook settings are not bundled with a Codex plugin.",
				"Codex plugin users receive only plugin-scoped hook registration.",
			),
		),
	),
	capability(
		"plugin-hooks",
		"hook",
		{ encoding: "plugin-hooks", path: "hooks/hooks.json" },
		fourTargetMappings(
			exclusion(
				"claude-repository",
				"Plugin hooks are not installed as repository hooks.",
				"Repository users receive only the repository hook capability.",
			),
			mapping("claude-plugin", "native", ["hooks"], PROBES.claudePlugin),
			exclusion(
				"codex-repository",
				"Plugin hooks are not installed as repository hooks.",
				"Repository users receive only the repository hook capability.",
			),
			mapping("codex-plugin", "transform", ["hooks"], PROBES.codexPlugin),
		),
	),
	capability(
		"plugin-metadata",
		"plugin-metadata",
		{
			encoding: "cli-package-metadata",
			path: "packages/cli/package.json",
			identity: Object.freeze({
				name: "pfdsl",
				author: Object.freeze({ name: "takasek" }),
				homepage: "https://github.com/takasek/pfdsl",
				license: "MIT",
			}),
		},
		fourTargetMappings(
			exclusion(
				"claude-repository",
				"Plugin metadata is not installed in a Claude repository.",
				"Claude repository users do not receive a plugin manifest.",
			),
			mapping(
				"claude-plugin",
				"transform",
				[
					"manifest:.claude-plugin/plugin.json:name",
					"manifest:.claude-plugin/plugin.json:description",
					"manifest:.claude-plugin/plugin.json:version",
					"manifest:.claude-plugin/plugin.json:author",
					"manifest:.claude-plugin/plugin.json:homepage",
					"manifest:.claude-plugin/plugin.json:license",
				],
				PROBES.claudePlugin,
			),
			exclusion(
				"codex-repository",
				"Plugin metadata is not installed in a Codex repository.",
				"Codex repository users do not receive a plugin manifest.",
			),
			mapping(
				"codex-plugin",
				"transform",
				[
					"manifest:.codex-plugin/plugin.json:name",
					"manifest:.codex-plugin/plugin.json:version",
					"manifest:.codex-plugin/plugin.json:description",
					"manifest:.codex-plugin/plugin.json:author",
					"manifest:.codex-plugin/plugin.json:homepage",
					"manifest:.codex-plugin/plugin.json:repository",
					"manifest:.codex-plugin/plugin.json:license",
					"manifest:.codex-plugin/plugin.json:skills",
					"manifest:.codex-plugin/plugin.json:interface",
				],
				PROBES.codexPlugin,
			),
		),
	),
]);

function sourceName({ source }) {
	return source.path.slice(source.path.lastIndexOf("/") + 1);
}

function distributedCapabilities(kind) {
	return HARNESS_CAPABILITY_CONTRACT.filter(
		(capability) => capability.kind === kind && !capability.source.generated,
	);
}

export const DISTRIBUTED_SKILLS = Object.freeze(
	distributedCapabilities("skill").map(sourceName),
);

export const DISTRIBUTED_COMMANDS = Object.freeze(
	distributedCapabilities("command").map(sourceName),
);

export const DISTRIBUTED_AGENTS = Object.freeze(
	distributedCapabilities("agent").map(sourceName),
);

/**
 * Developer-local entries under `.claude/` that this repo gitignores. They are
 * neither a distributed source nor a maintained artifact, and a checkout may or
 * may not have them — so every surface that enumerates `.claude/` has to pass
 * over them rather than classify them.
 *
 * They cannot go in `SOURCE_EXCLUSIONS.root`: entries there are asserted to
 * exist, and as files, which would move the failure to every checkout lacking
 * one and could not hold a directory at all.
 */
export const LOCAL_CLAUDE_ROOT_ENTRIES = Object.freeze({
	"settings.local.json": "per-developer harness settings overlay",
	worktrees: "per-developer git worktrees",
});

export const SOURCE_EXCLUSIONS = Object.freeze({
	root: Object.freeze({
		"pfd-ops-install-manifest.json":
			"install provenance for the repository-local pfd-ops skill",
	}),
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
	skills: Object.freeze(
		Object.fromEntries(
			HARNESS_CAPABILITY_CONTRACT.filter(
				(capability) =>
					capability.kind === "skill" && capability.source.generated,
			).map((capability) => [
				sourceName(capability),
				Object.freeze({
					reason: capability.source.generated.reason,
					source: capability.source.path,
					target: capability.source.generated.target,
				}),
			]),
		),
	),
	commands: Object.freeze({}),
	agents: Object.freeze({}),
});

export const SKILL_EXCLUSIONS = SOURCE_EXCLUSIONS.skills;
export const COMMAND_EXCLUSIONS = SOURCE_EXCLUSIONS.commands;
export const AGENT_EXCLUSIONS = SOURCE_EXCLUSIONS.agents;
export const GENERATED_SKILLS = GENERATED_SOURCES.skills;
export const GENERATED_COMMANDS = GENERATED_SOURCES.commands;
export const GENERATED_AGENTS = GENERATED_SOURCES.agents;

function claudePluginEntries(kind, prefix) {
	return distributedCapabilities(kind).map((capability) => {
		const mapping = capability.mappings.find(
			({ target }) => target === "claude-plugin",
		);
		const output = mapping.outputs.find((surface) =>
			surface.startsWith(prefix),
		);
		return output.slice(prefix.length);
	});
}

export const CLAUDE_PLUGIN_MIRRORS = Object.freeze([
	Object.freeze({
		dest: "skills",
		src: ".claude/skills",
		trees: Object.freeze(claudePluginEntries("skill", "skills/")),
	}),
	Object.freeze({
		dest: "commands",
		src: ".claude/commands",
		files: Object.freeze(claudePluginEntries("command", "commands/")),
	}),
	Object.freeze({
		dest: "agents",
		src: ".claude/agents",
		files: Object.freeze(claudePluginEntries("agent", "agents/")),
	}),
	Object.freeze({
		dest: "hooks",
		src: "hooks",
		whole: HARNESS_CAPABILITY_CONTRACT.find(
			(capability) => capability.id === "plugin-hooks",
		).mappings.some(
			(mapping) =>
				mapping.target === "claude-plugin" &&
				mapping.outputs?.includes("hooks"),
		),
	}),
]);

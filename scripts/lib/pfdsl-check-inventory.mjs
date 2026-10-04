// Only tracked .pfdsl files. The existence set comes from git, never from
// these classifications or the generator's output declarations (#1185).
const sourceRoot =
	"scripts/harness-template/skills/pfd-ops/references/scaffold/";
export const PFD_CHECK_RULES = [
	{
		id: "operational",
		pattern: /^\.pfdsl\/[^/]+\.pfdsl$/,
		checks: ["check", "fmt", "links"],
	},
	{ id: "docs", pattern: /^docs\/.*\.pfdsl$/s, checks: ["check", "render"] },
	{
		id: "scaffold",
		pattern:
			/^scripts\/harness-template\/skills\/pfd-ops\/references\/scaffold\/.*\.pfdsl$/s,
		checks: ["strict", "fmt"],
	},
	{
		id: "generated-scaffold",
		pattern:
			/^(?:\.claude|\.agents|plugin\/pfdsl|plugin\/pfdsl-codex)\/skills\/pfd-ops\/references\/scaffold\/(.*\.pfdsl)$/s,
		checks: [],
		owner:
			"check-gen-plugin.yml regeneration and generated-drift; validated source scaffold",
		source: (match) => `${sourceRoot}${match[1]}`,
	},
	{
		id: "core-fixture",
		pattern: /^packages\/core\/src\/__fixtures__\/pipeline-scale\.pfdsl$/,
		required: true,
		checks: [],
		owner:
			"packages/core/src/index.test.ts parse/normalize/validateGraph; changed-file gate additionally checks the CLI root, not repo-wide multi-file coverage",
	},
];

export function classifyTrackedPfdsl(paths, rules = PFD_CHECK_RULES) {
	const tracked = new Set(paths.filter((path) => path.endsWith(".pfdsl")));
	const entries = [];
	const errors = [];
	const used = new Set();
	for (const path of [...tracked].sort()) {
		const matches = rules.flatMap((rule) => {
			const match = path.match(rule.pattern);
			return match ? [{ rule, match }] : [];
		});
		if (matches.length !== 1) {
			errors.push(
				`${matches.length === 0 ? "unclassified" : "ambiguous"} .pfdsl path: ${path}`,
			);
			continue;
		}
		const { rule, match } = matches[0];
		used.add(rule.id);
		const source = rule.source?.(match);
		if (source && !tracked.has(source))
			errors.push(`missing tracked source ${source} for ${path}`);
		entries.push({
			path,
			role: rule.id,
			checks: rule.checks,
			...(rule.owner ? { owner: rule.owner } : {}),
			...(source ? { source } : {}),
		});
	}
	for (const rule of rules) {
		if (rule.required && !used.has(rule.id))
			errors.push(`stale .pfdsl assignment: ${rule.id}`);
	}
	return { entries, errors };
}

export function pfdslCheckPlan(inventory, scope) {
	if (inventory.errors.length) throw new Error(inventory.errors.join("\n"));
	if (!["operational", "docs", "scaffold", "fmt", "links"].includes(scope))
		throw new Error(`unknown scope: ${scope}`);
	const selected = inventory.entries.filter((entry) =>
		scope === "fmt" || scope === "links"
			? entry.checks.includes(scope)
			: entry.role === scope,
	);
	if (selected.length === 0)
		throw new Error(`no classified .pfdsl paths for ${scope}`);
	return selected.flatMap(({ path, checks }) => {
		const actions =
			scope === "fmt" || scope === "links"
				? [scope]
				: checks.filter((check) => !["fmt", "links"].includes(check));
		return actions.map((action) => ({
			path,
			args: CHECK_COMMANDS[action](path),
		}));
	});
}

const CHECK_COMMANDS = {
	check: (path) => ["check", path],
	strict: (path) => ["check", path, "--strict"],
	fmt: (path) => ["fmt", path, "--check"],
	links: (path) => ["meta", "check-links", path],
	render: (path) => ["render", path, "--format", "dot"],
};

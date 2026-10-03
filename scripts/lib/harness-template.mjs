const CONTEXTS = Object.freeze({
	claude: {
		repoSkillRoot: ".claude/skills",
		rootInstructionsFile: "CLAUDE.md",
		pluginRootExpression: `\${CLAUDE_PLUGIN_ROOT}`,
		pluginRootName: "CLAUDE_PLUGIN_ROOT",
	},
	codex: {
		repoSkillRoot: ".agents/skills",
		rootInstructionsFile: "AGENTS.md",
		pluginRootExpression: `\${PLUGIN_ROOT}`,
		pluginRootName: "PLUGIN_ROOT",
	},
});

// Validate the entire token stream before selecting sections. Unknown tags in
// omitted branches must fail too; permissive template engines silently drop them.
export function renderHarnessTemplate(source, target, path = "<template>") {
	const fail = (detail) => {
		throw new Error(`harness-template: ${path}: ${detail}.`);
	};
	if (!Object.hasOwn(CONTEXTS, target)) fail(`unsupported target ${target}`);
	const context = CONTEXTS[target];
	const stack = [];
	let cursor = 0;
	let output = "";
	const selected = () => stack.every((section) => section === target);
	for (const match of source.matchAll(/\{\{[\s\S]*?\}\}\}?/g)) {
		if (source.slice(cursor, match.index).includes("{{"))
			fail("unterminated tag");
		if (selected()) output += source.slice(cursor, match.index);
		const token = match[0];
		const variable = token.match(/^\{\{\{([A-Za-z]+)\}\}\}$/)?.[1];
		const section = token.match(/^\{\{([#/])(claude|codex)\}\}$/);
		if (variable && Object.hasOwn(context, variable)) {
			if (selected()) output += context[variable];
		} else if (section?.[1] === "#") {
			stack.push(section[2]);
		} else if (section?.[1] === "/" && stack.pop() === section[2]) {
			// The closing tag ends exactly the currently open section.
		} else fail(`unsupported or mismatched tag ${token}`);
		cursor = match.index + token.length;
	}
	if (source.slice(cursor).includes("{{")) fail("unterminated tag");
	if (stack.length) fail("unclosed section");
	output += source.slice(cursor);
	return output;
}

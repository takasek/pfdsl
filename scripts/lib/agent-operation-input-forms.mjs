import inputForms from "./agent-operation-option-table.json" with {
	type: "json",
};

// Only option names, arity and aggregate counts; no transcript text or paths.
export const AGENT_OPERATION_INPUT_FORMS = inputForms;

export function parseInputForm(tokens, name) {
	const options = AGENT_OPERATION_INPUT_FORMS[name];
	const operands = [],
		values = [],
		issues = [],
		unknownOptions = [];
	const flags = new Set();
	let afterDash = false;
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!afterDash && token.value === "--") {
			afterDash = true;
			continue;
		}
		if (afterDash || !token.value.startsWith("-") || token.value === "-") {
			operands.push({ ...token, positionalOnly: afterDash });
			if (
				name === "git config" &&
				operands.length === 1 &&
				token.value.includes(".")
			)
				afterDash = true;
			continue;
		}
		const equal = token.value.indexOf("=");
		const attached =
			!token.value.startsWith("--") &&
			token.value.length > 2 &&
			options?.[token.value.slice(0, 2)]?.arity === "required";
		const flag = attached
			? token.value.slice(0, 2)
			: equal > 0
				? token.value.slice(0, equal)
				: token.value;
		flags.add(flag);
		const arity = options?.[flag]?.arity;
		if (!arity) {
			issues.push("unknown-option");
			if (/^--?[A-Za-z0-9][A-Za-z0-9-]*$/.test(flag)) unknownOptions.push(flag);
			continue;
		}
		if (arity === "required" || (arity === "optional" && equal > 0)) {
			const value = attached
				? { ...token, value: token.value.slice(2) }
				: equal > 0
					? { ...token, value: token.value.slice(equal + 1) }
					: tokens[++i];
			if (value) values.push({ flag, ...value });
			else issues.push("missing-option-value");
		}
	}
	return {
		operands,
		flags,
		values,
		issues: [...new Set(issues)],
		unknownOptions: [...new Set(unknownOptions)],
	};
}

export function decisionArgumentIssues(
	parsed,
	argumentsToInspect,
	indirectFlags = [],
) {
	const issues = [...parsed.issues];
	const sources = new Map([
		["--input", "indirect-file"],
		["--stdin", "indirect-stdin"],
	]);
	for (const selector of indirectFlags)
		if (parsed.flags.has(selector)) issues.push(sources.get(selector));
	for (const token of argumentsToInspect.filter(Boolean)) {
		if (token.dynamic) issues.push("dynamic-argument");
		else if (token.value === "-" || token.value === "@-")
			issues.push("indirect-stdin");
		else if (token.value.startsWith("@")) issues.push("indirect-file");
	}
	return [...new Set(issues)];
}

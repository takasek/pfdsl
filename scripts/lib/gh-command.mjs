// Locates the group and verb of a `gh` call, for the guards that decide on one
// (delegation-guard and command-usage-guard).
//
// Reading `tokens[1]` as the group is wrong as soon as a global flag comes
// first: `gh -R owner/repo pr create` has "-R" there, and every guard that
// indexed positionally treated the call as unrecognised — which for a deny
// guard means failing open (review finding, #650). The value of a
// value-taking global flag has to be skipped too, or `owner/repo` reads as
// the group.
//
// Literal quoting does not change the argv values; dynamic markers remain
// available for guards that must inspect selectors before allowing a command.

// Global flags that consume the following token. `-R`/`--repo` are the only
// value-taking flags gh accepts before the group: measured against gh 2.96.0
// on 2026-08-03, `gh --repo owner/repo issue view <n>` runs, while
// `gh --hostname github.com issue view <n>` is rejected with "unknown flag"
// (--hostname is a command flag, valid only after the group, e.g. `gh api
// --hostname ...`). If gh ever promotes another value-taking flag to
// persistent, its value would read as the group here.
export const GLOBAL_FLAGS_WITH_VALUE = new Set(["-R", "--repo"]);

/**
 * The group and next operand tokens of a `gh` call, retaining dynamic markers.
 * An unresolved option is also a selector: expansion can introduce operands.
 * @param {Array<{value: string, quoted: boolean, dynamic?: boolean}>} tokens command words from the shell syntax tree
 * @returns {Array<{value: string, quoted: boolean, dynamic?: boolean} | null> | null}
 */
export function ghCommandSelectorTokens(tokens) {
	if (tokens.length === 0) return null;
	const head = tokens[0];
	if (head.dynamic || head.value !== "gh") return null;

	/** The index of the next token that is not a flag or a flag's value. */
	const nextOperand = (from) => {
		for (let i = from; i < tokens.length; i++) {
			const { value, dynamic } = tokens[i];
			if (
				(!dynamic && value.startsWith("-R") && value.length > 2) ||
				[...GLOBAL_FLAGS_WITH_VALUE].some((flag) =>
					value.startsWith(`${flag}=`),
				)
			)
				continue;
			if (dynamic) return i;
			if (!value.startsWith("-")) return i;
			if (GLOBAL_FLAGS_WITH_VALUE.has(value)) i++;
		}
		return -1;
	};

	const groupIndex = nextOperand(1);
	if (groupIndex === -1) return null;
	const verbIndex = nextOperand(groupIndex + 1);

	return [tokens[groupIndex], verbIndex === -1 ? null : tokens[verbIndex]];
}

/** Group/verb values and every argument after the executable. */
export function parseGhCommand(tokens) {
	const selectors = ghCommandSelectorTokens(tokens);
	if (!selectors) return null;
	return {
		group: selectors[0].value,
		verb: selectors[1]?.value ?? null,
		args: tokens.slice(1).map((token) => token.value),
	};
}

/**
 * The values given to any of `flags`, in order — covering both `--flag value`
 * and `--flag=value`. A flag at the end of the line, or one followed by another
 * flag, contributes nothing.
 * @param {string[]} args parseGhCommand()'s args
 * @param {string[]} flags e.g. ["--label", "-l"]
 * @returns {string[]}
 */
export function flagValues(args, flags) {
	const values = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const inline = flags.find((flag) => arg.startsWith(`${flag}=`));
		if (inline) {
			values.push(arg.slice(inline.length + 1));
			continue;
		}
		if (!flags.includes(arg)) continue;
		const next = args[i + 1];
		if (next === undefined || next.startsWith("-")) continue;
		values.push(next);
		i++;
	}
	return values;
}

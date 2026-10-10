import { executableName } from "./shell-commands.mjs";

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

// Built-in command namespaces checked against gh 2.96's command reference.
// Configured aliases cannot shadow a built-in or be nested under a runnable
// command (cli/cli pkg/cmd/alias/shared/validations.go). Unknown names at any
// namespace depth stay opaque; neither alias nor extension code is executed.
const GH_BUILTIN_CHILDREN = new Map(
	Object.entries({
		alias: "delete import list ls set",
		attestation: "download trusted-root verify",
		auth: "login logout refresh setup-git status switch token",
		cache: "delete list ls",
		codespace:
			"code cp create delete edit jupyter list ls logs ports rebuild ssh stop view",
		config: "clear-cache get list ls set",
		extension:
			"browse create exec install list ls remove uninstall search upgrade",
		gist: "clone create new delete edit list ls rename view",
		"gpg-key": "add delete list ls",
		issue:
			"close comment create new delete develop edit list ls lock pin reopen status transfer unlock unpin view",
		label: "clone create delete edit list ls",
		org: "list ls",
		pr: "checkout co checks close comment create new diff edit list ls lock merge ready reopen revert review status unlock update-branch view",
		project:
			"close copy create delete edit field-create field-delete field-list item-add item-archive item-create item-delete item-edit item-list link list ls mark-template unlink view",
		preview: "prompter",
		release:
			"create new delete delete-asset download edit list ls upload verify verify-asset view",
		repo: "archive autolink clone create new delete deploy-key edit fork gitignore license list ls rename set-default sync unarchive view",
		"repo autolink": "create new delete list ls view",
		"repo deploy-key": "add delete list ls",
		"repo gitignore": "list ls view",
		"repo license": "list ls view",
		ruleset: "check list ls view",
		run: "cancel delete download list ls rerun view watch",
		search: "code commits issues prs repos",
		secret: "delete remove list ls set",
		"ssh-key": "add delete list ls",
		variable: "delete remove get list ls set",
		workflow: "disable enable list ls run view",
	}).map(([path, names]) => [path, new Set(names.split(" "))]),
);
const GH_BUILTIN_LEAVES = new Set([
	"api",
	"browse",
	"completion",
	"licenses",
	"status",
	"version",
]);
// Cobra installs implicit `help` after gh registers aliases, so `gh help`
// can execute a configured shell alias. Use a built-in command's --help.
const GH_GROUP_ALIASES = {
	at: "attestation",
	cs: "codespace",
	ext: "extension",
	extensions: "extension",
	rs: "ruleset",
};

function nextGhOperand(tokens, from) {
	for (let i = from; i < tokens.length; i++) {
		const { value, dynamic } = tokens[i];
		if (
			(!dynamic && value.startsWith("-R") && value.length > 2) ||
			[...GLOBAL_FLAGS_WITH_VALUE].some((flag) => value.startsWith(`${flag}=`))
		)
			continue;
		if (dynamic || !value.startsWith("-")) return i;
		if (GLOBAL_FLAGS_WITH_VALUE.has(value)) i++;
	}
	return -1;
}

export function isBuiltinGhCommand(tokens) {
	let index = nextGhOperand(tokens, 1);
	if (index === -1) return true; // Bare gh or root help/version flags.
	let path = GH_GROUP_ALIASES[tokens[index].value] ?? tokens[index].value;
	if (GH_BUILTIN_LEAVES.has(path)) return true;
	while (GH_BUILTIN_CHILDREN.has(path)) {
		index = nextGhOperand(tokens, index + 1);
		if (index === -1) return true; // A namespace's usage/help.
		if (!GH_BUILTIN_CHILDREN.get(path).has(tokens[index].value)) return false;
		path += ` ${tokens[index].value}`;
		if (!GH_BUILTIN_CHILDREN.has(path)) return true;
	}
	return false;
}

/**
 * The group and next operand tokens of a `gh` call, retaining dynamic markers.
 * An unresolved option is also a selector: expansion can introduce operands.
 * @param {Array<{value: string, quoted: boolean, dynamic?: boolean}>} tokens command words from the shell syntax tree
 * @returns {Array<{value: string, quoted: boolean, dynamic?: boolean} | null> | null}
 */
export function ghCommandSelectorTokens(tokens) {
	if (tokens.length === 0) return null;
	const head = tokens[0];
	if (head.dynamic || executableName(head.value) !== "gh") return null;

	const groupIndex = nextGhOperand(tokens, 1);
	if (groupIndex === -1) return null;
	const verbIndex = nextGhOperand(tokens, groupIndex + 1);

	return [tokens[groupIndex], verbIndex === -1 ? null : tokens[verbIndex]];
}

/** Group/verb values and every argument after the executable. */
export function parseGhCommand(tokens) {
	const selectors = ghCommandSelectorTokens(tokens);
	if (!selectors) return null;
	const group = GH_GROUP_ALIASES[selectors[0].value] ?? selectors[0].value;
	const verb = selectors[1]?.value ?? null;
	return {
		group,
		verb:
			verb === "ls" && GH_BUILTIN_CHILDREN.get(group)?.has("ls")
				? "list"
				: verb,
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

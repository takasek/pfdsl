/**
 * Detects forbidden child_process imports and re-exports, and literal shell
 * options that turn a shell on (`shell: true` or a non-empty string).
 *
 * `execSync` hands its argument to a shell, so any value spliced into it is
 * parsed as shell syntax: a space word-splits and a semicolon starts another
 * command. Refs, artifact keys, tags and paths all reach these scripts from
 * argv or from other commands' output (takasek/pfdsl#571, #572).
 *
 * The rule is the *import*, not the argument. An earlier version tried to flag
 * only interpolated command lines and let constant ones through, which meant
 * deciding what a call's first argument was by scanning characters. Every way
 * of writing the vulnerable code that did not look like the expected shape
 * slipped past it: assigning the template to a variable one line earlier, a
 * `)` inside a `--format="%h)"` string, an aliased import, `{shell: true}` on
 * a call that otherwise takes argv. Banning the import needs no such analysis
 * — `scripts/lib/run-exec.mjs` covers every use in this repo.
 * Parsing syntax also covers whole-module imports and re-exports, including
 * the `default` specifier, re-exports of exec / execSync, and quoted property
 * names without treating examples in comments or strings as executable code.
 * This is a syntax gate, not data-flow analysis of computed module names or
 * option values.
 */

import ts from "typescript";

/** Names that execute through a shell when imported from child_process. */
const SHELL_EXECUTORS = new Set(["exec", "execSync"]);

function isChildProcess(node) {
	if (node) node = unwrap(node);
	return (
		node &&
		ts.isStringLiteralLike(node) &&
		(node.text === "child_process" || node.text === "node:child_process")
	);
}

function unwrap(node) {
	while (ts.isParenthesizedExpression(node)) node = node.expression;
	return node;
}

/**
 * Files the gate leaves alone. Everything else tracked as `.mjs` is scanned:
 * enumerating the directories to scan instead means a new one is only covered
 * when someone remembers to add it, and `hooks/` — which runs on every Bash
 * tool call in an adopting repo — went uncovered that way (#605).
 */
function isExcluded(file) {
	// The detector and its tests hold the offending patterns as data.
	if (file.endsWith(".test.mjs")) return true;
	if (file === "scripts/lib/check-no-shell-strings.mjs") return true;
	// Generated mirror of hooks/ and .claude/skills/ — the sources are scanned,
	// and scripts/gen-plugin.mjs' identity gate keeps the copy equal to them.
	return file.startsWith("plugin/");
}

/**
 * @param {string[]} trackedFiles - repo-relative paths, e.g. `git ls-files` output
 * @returns {string[]} the subset the gate scans
 */
export function selectScannedFiles(trackedFiles) {
	return trackedFiles.filter(
		(file) => file.endsWith(".mjs") && !isExcluded(file),
	);
}

/**
 * @param {string} source
 * @returns {Array<{line: number, reason: string}>}
 */
export function findShellExecutors(source) {
	const findings = [];
	const file = ts.createSourceFile(
		"script.mjs",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS,
	);
	const report = (node, reason) =>
		findings.push({
			line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
			reason,
		});
	function visit(node) {
		if (ts.isImportDeclaration(node) && isChildProcess(node.moduleSpecifier)) {
			const clause = node.importClause;
			const bindings = clause?.namedBindings;
			if (clause?.name || (bindings && ts.isNamespaceImport(bindings))) {
				report(node, "imports the child_process module");
			} else if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					const imported = (element.propertyName ?? element.name).text;
					// `default` is the module itself, as in `import cp from`.
					if (imported === "default")
						report(node, "imports the child_process module");
					else if (SHELL_EXECUTORS.has(imported))
						report(node, `imports ${imported} from child_process`);
				}
			}
		} else if (
			ts.isExportDeclaration(node) &&
			isChildProcess(node.moduleSpecifier)
		) {
			const clause = node.exportClause;
			if (!clause || ts.isNamespaceExport(clause)) {
				report(node, "re-exports the child_process module");
			} else {
				for (const element of clause.elements) {
					const exported = (element.propertyName ?? element.name).text;
					if (exported === "default")
						report(node, "re-exports the child_process module");
					else if (SHELL_EXECUTORS.has(exported))
						report(node, `re-exports ${exported} from child_process`);
				}
			}
		} else if (ts.isCallExpression(node) && isChildProcess(node.arguments[0])) {
			const expression = unwrap(node.expression);
			if (
				expression.kind === ts.SyntaxKind.ImportKeyword ||
				(ts.isIdentifier(expression) && expression.text === "require")
			) {
				report(node, "loads the child_process module");
			}
		} else if (ts.isPropertyAssignment(node)) {
			const name = ts.isComputedPropertyName(node.name)
				? unwrap(node.name.expression)
				: node.name;
			if (
				(ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
				name.text === "shell"
			) {
				const value = unwrap(node.initializer);
				if (value.kind === ts.SyntaxKind.TrueKeyword)
					report(node, "uses shell: true");
				// Node runs through the named shell for any truthy value; only the
				// empty string and false mean no shell.
				else if (ts.isStringLiteralLike(value) && value.text !== "")
					report(node, "uses a string shell option");
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return findings;
}

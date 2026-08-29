import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import { planGhRestCall } from "./gh-compat.mjs";

const REPRESENTATIVES = {
	color: "ededed",
	description: "not tracked",
	issueNumber: "612",
	name: "flow:exempt",
	number: "612",
	pr: "612",
	targetIssue: "612",
};

function representativeForName(name) {
	return REPRESENTATIVES[name] ?? "representative";
}

function literalValue(node) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return node.text;
	if (ts.isNumericLiteral(node)) return node.text;
	if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
	if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
	if (ts.isIdentifier(node)) return representativeForName(node.text);
	if (ts.isPropertyAccessExpression(node))
		return representativeForName(node.name.text);
	if (ts.isElementAccessExpression(node)) return "representative";
	if (ts.isCallExpression(node)) {
		if (
			ts.isIdentifier(node.expression) &&
			node.expression.text === "String" &&
			node.arguments.length === 1
		)
			return literalValue(node.arguments[0]);
		return undefined;
	}
	if (ts.isTemplateExpression(node)) {
		let value = node.head.text;
		for (const span of node.templateSpans) {
			value += literalValue(span.expression) ?? "representative";
			value += span.literal.text;
		}
		return value;
	}
	return undefined;
}

function literalArgs(node) {
	if (!ts.isArrayLiteralExpression(node)) return undefined;
	const args = [];
	for (const element of node.elements) {
		if (ts.isSpreadElement(element)) return undefined;
		const value = literalValue(element);
		if (value === undefined) return undefined;
		args.push(value);
	}
	return args;
}

/**
 * A shape is identified by its command, subcommand, selector class, literal
 * flags, and the set of fields requested by --json. Positional runtime values
 * (issue/PR numbers, label names, and similar data) are representatives for
 * execution and do not create a new fallback shape.
 */
export function shapeIdentity(args) {
	const flags = [];
	const fields = new Set();
	for (let i = 2; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith("-")) continue;
		flags.push(arg);
		if (arg === "--json" && args[i + 1] !== undefined)
			for (const field of args[++i].split(",")) fields.add(field);
	}
	return JSON.stringify({
		command: args[0],
		subcommand: args[1],
		selector:
			args[2] !== undefined && !args[2].startsWith("-")
				? "explicit"
				: "implicit",
		flags: [...new Set(flags)].sort(),
		jsonFields: [...fields].sort(),
	});
}

/**
 * Extract direct execGh calls whose first argument is a literal argv array.
 * Calls accepting an injected argv (or a builder such as GraphQL query
 * construction) are intentionally excluded: they do not declare a literal
 * emitted shape at the call site.
 */
export function discoverLiteralExecGhShapes({ sources }) {
	const shapes = [];
	for (const source of sources) {
		const file = source.file;
		const ast = ts.createSourceFile(
			file,
			source.text,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.JS,
		);
		function visit(node) {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "execGh"
			) {
				const args = literalArgs(node.arguments[0]);
				if (args) {
					const position = ast.getLineAndCharacterOfPosition(
						node.getStart(ast),
					);
					shapes.push({
						file,
						line: position.line + 1,
						args,
						identity: shapeIdentity(args),
					});
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(ast);
	}
	return shapes;
}

function productionFiles(root) {
	const files = [];
	function walk(directory) {
		for (const name of readdirSync(directory)) {
			const path = join(directory, name);
			const stat = statSync(path);
			if (stat.isDirectory()) walk(path);
			else if (
				name.endsWith(".mjs") &&
				!name.endsWith(".test.mjs") &&
				name !== "gh-exec.mjs" &&
				name !== "gh-fallback-coverage.mjs"
			)
				files.push({
					file: relative(root, path),
					text: readFileSync(path, "utf-8"),
				});
		}
	}
	walk(join(root, "scripts"));
	return files;
}

export function discoverProductionLiteralExecGhShapes(root) {
	return discoverLiteralExecGhShapes({ sources: productionFiles(root) });
}

export function assertFallbackPlansCoverShapes(shapes, plan = planGhRestCall) {
	for (const shape of shapes) {
		if (!plan(shape.args))
			throw new Error(
				`${shape.file}:${shape.line} ${shape.args.join(" ")} has no REST fallback plan`,
			);
	}
	return shapes;
}

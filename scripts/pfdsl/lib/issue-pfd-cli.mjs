import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

export const ISSUE_PFD_COMMANDS = Object.freeze({
	create: "create <issue> <file.pfdsl> --dir <dir> [--write]",
	pull: "pull <issue> --dir <dir> [--artifact <n>] [--version <v>] [--diagram <n>]",
	check: "check <dir>",
	render: "render <dir> --out <file>",
	publish: "publish <dir> [--diagram <n>] [--write]",
	"publish-diagram":
		"publish-diagram <issue> [--artifact <n>] [--version <v>] [--diagram <n>] [--dir <dir>] [--write]",
	restore: "restore <dir> --version <v> [--diagram <n>] [--write]",
	resolve: "resolve <dir> --abandon <op>",
	status: "status <issue> [--artifact <n>] [--diagram <n>] [--dir <dir>]",
	show: "show <issue> --artifact <n> --version <v> [--out <file>]",
});

export function formatIssuePfdHelp(command) {
	const usages = command
		? [ISSUE_PFD_COMMANDS[command]]
		: Object.values(ISSUE_PFD_COMMANDS);
	const descriptions = {
		write: "Send publication requests to GitHub (default: dry run).",
		dir: "Working directory; explicit status/diagram directories must contain issue-pfd.json.",
		artifact:
			"Source artifact number; required by show, otherwise select automatically when unique.",
		version:
			"Artifact version; pull and publish-diagram default to the current version.",
		diagram: "Select a diagram artifact when multiple diagrams exist.",
		out: "Write output to this file; show defaults to exact raw source on stdout.",
		abandon:
			"Record abandonment of an operation UUID; this does not cancel the request.",
	};
	const options = [
		...new Set(
			usages.flatMap((usage) =>
				[...usage.matchAll(/--([a-z-]+)/g)].map((match) => match[1]),
			),
		),
	];
	return [
		"Issue artifact PFD",
		"",
		"Usage:",
		...usages.map((usage) => `  node scripts/pfdsl/issue-pfd.mjs ${usage}`),
		"  node scripts/pfdsl/issue-pfd.mjs [<command>] --help",
		"",
		"Options:",
		...options.map((option) => `  --${option}: ${descriptions[option]}`),
		"  --help: Show help and exit successfully without accessing GitHub or the CLI.",
		"",
		"Defaults: create, publish, publish-diagram and restore are dry runs unless --write is supplied.",
		"pull creates local state; render and show --out write local output; resolve records abandonment.",
		"check/render reference context is generated automatically; do not pass a context JSON.",
		"restore requires a clean model.pfdsl after reconciliation; save unpublished edits first. Applied restore retires the directory: publish/restore require a fresh pull; model.pfdsl is preserved.",
		"",
		"Exit codes: 0 success/help; 1 model or operation failure; 2 invalid arguments or unavailable GitHub transport; 3 incompatible CLI environment.",
	].join("\n");
}

export function parseIssuePfdArgs(args) {
	const { values, positionals } = parseArgs({
		args,
		strict: true,
		allowPositionals: true,
		options: {
			help: { type: "boolean" },
			write: { type: "boolean" },
			dir: { type: "string" },
			artifact: { type: "string" },
			version: { type: "string" },
			diagram: { type: "string" },
			out: { type: "string" },
			abandon: { type: "string" },
		},
	});
	const [command, first, second] = positionals;
	const allowed = Object.fromEntries(
		Object.entries(ISSUE_PFD_COMMANDS).map(([name, usage]) => [
			name,
			[...usage.matchAll(/--([a-z-]+)/g)].map((match) => match[1]),
		]),
	);
	if (values.help && command === undefined && positionals.length === 0)
		return { help: true };
	if (!Object.hasOwn(allowed, command))
		throw new Error(
			"Expected command: create, pull, check, render, publish, publish-diagram, restore, resolve, status, or show",
		);
	if (values.help) return { help: true, command };
	if (positionals.length !== (command === "create" ? 3 : 2))
		throw new Error(`Unexpected arguments for ${command}`);
	for (const key of Object.keys(values))
		if (!allowed[command].includes(key))
			throw new Error(`--${key} is not supported by ${command}`);
	if (["create", "pull"].includes(command) && !values.dir)
		throw new Error(`${command} requires --dir`);
	if (command === "render" && !values.out)
		throw new Error("render requires --out");
	if (command === "restore" && !values.version)
		throw new Error("restore requires --version");
	if (command === "show" && (!values.artifact || !values.version))
		throw new Error("show requires --artifact and --version");
	if (values.out !== undefined && values.out.length === 0)
		throw new Error("--out must not be empty");
	if (command === "resolve" && !values.abandon)
		throw new Error("resolve requires --abandon <op>");
	if (
		values.abandon &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			values.abandon,
		)
	)
		throw new Error("abandon must be an operation UUID");
	const positive = (value, label) => {
		if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
			throw new Error(`${label} must be a positive integer`);
		return Number(value);
	};
	const result = { command, ...values, write: values.write === true };
	for (const key of ["artifact", "version", "diagram"])
		if (values[key] !== undefined) result[key] = positive(values[key], key);
	if (["check", "render", "publish", "restore", "resolve"].includes(command))
		result.dir = first;
	else result.issue = positive(first, "issue");
	if (command === "create") result.file = second;
	return result;
}

export class IssuePfdEnvironmentError extends Error {
	constructor(message) {
		super(`CLI environment error: ${message}`);
		this.exitCode = 3;
	}
}

/** Invoke the existing CLI against a private immutable input, never the editable file. */
export function createIssuePfdCli({
	root,
	spawn = spawnSync,
	temporaryRoot = tmpdir(),
	env = process.env,
}) {
	const candidates = env.PFDSL_CLI
		? [resolve(env.PFDSL_CLI)]
		: [
				resolve(root, "packages/cli/dist/cli.js"),
				resolve(root, "node_modules/@pfdsl/cli/dist/cli.js"),
			];
	const cli = candidates.find((path) => existsSync(path));
	if (!cli)
		throw new IssuePfdEnvironmentError(
			"Could not resolve pfdsl CLI; build the repository, install @pfdsl/cli, or set PFDSL_CLI to its JavaScript entry point",
		);
	const maxBuffer = 32 * 1024 * 1024;
	function requireExit(result, target) {
		const signal = result.signal ? ` (${result.signal})` : "";
		if (result.error)
			throw new IssuePfdEnvironmentError(
				result.error.code === "ENOBUFS"
					? `${target}: CLI response exceeded ${maxBuffer} bytes${signal}`
					: `${target}: ${result.error.message}${signal}`,
			);
		if (result.signal || !Number.isInteger(result.status))
			throw new IssuePfdEnvironmentError(
				`${target}: CLI terminated ${result.signal ? `by ${result.signal}` : "without an exit code"}`,
			);
	}
	const invoke = async ({ command, model, context, out }) => {
		await invoke.preflight();
		const cliVersion = invoke.cliVersion;
		const dir = mkdtempSync(resolve(temporaryRoot, ".issue-pfd-cli-"));
		try {
			const file = resolve(dir, "model.pfdsl");
			const contextFile = resolve(dir, "context.json");
			writeFileSync(file, model);
			writeFileSync(contextFile, JSON.stringify(context));
			const args = [
				cli,
				command,
				file,
				"--reference-context",
				contextFile,
				...(command === "render" ? ["--format", "svg"] : []),
			];
			const result = spawn(process.execPath, args, {
				cwd: root,
				encoding: "utf8",
				maxBuffer,
				env,
			});
			requireExit(result, `${command} ${out ?? file}`);
			return {
				exitCode: result.status,
				stdout: result.stdout ?? "",
				stderr: result.stderr ?? "",
				cliVersion,
			};
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};
	invoke.preflight = async () => {
		if (!invoke.cliVersion) {
			const help = spawn(process.execPath, [cli, "check", "--help"], {
				cwd: root,
				encoding: "utf8",
				env,
			});
			requireExit(help, `${cli} check --help`);
			if (
				help.error ||
				help.status !== 0 ||
				// Probe the resolved CLI's help text for the option, not our own argv.
				!/(?:^|\s)--reference-context\b/m.test(help.stdout)
			)
				throw new IssuePfdEnvironmentError(
					"Resolved pfdsl CLI does not support --reference-context; use a compatible build via PFDSL_CLI. Nothing was written.",
				);
			const result = spawn(process.execPath, [cli, "--version"], {
				cwd: root,
				encoding: "utf8",
				env,
			});
			requireExit(result, `${cli} --version`);
			if (result.error || result.status !== 0)
				throw new IssuePfdEnvironmentError(
					`Cannot determine CLI version: ${result.error?.message ?? result.stderr}`,
				);
			invoke.cliVersion = result.stdout.trim();
		}
	};
	return invoke;
}

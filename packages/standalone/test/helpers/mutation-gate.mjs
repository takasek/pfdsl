// Mutation gate for the lifecycle invariants. Run by hand, not by `make test`:
//
//   node packages/standalone/test/helpers/mutation-gate.mjs [M1 M4 ...]
//
// Every mutation is applied to a COPY of the standalone package in a temporary
// tree (src, test, index.html, package.json; node_modules is linked), the
// selected witnesses run there, and the worktree itself is never modified.
// Every selected case must run in the green baseline and each mutant run.
// A mutation is caught only when each of its named witnesses fails with an
// invariant tag, rather than only a status text. The full matrices still run
// in the normal test suite; this gate checks these specific semantic faults.
// Mutation texts match the current sources; update them with the sources.
// Each mutation names the guarantee it removes and where that guarantee lives.
import { spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { isCliEntrypoint } from "../../../../scripts/lib/cli-entrypoint.mjs";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const standalone = join(repo, "packages/standalone");
const INVARIANT_TAGS = new Set([
	"L",
	"R",
	"A",
	"C",
	"U",
	"K",
	"T",
	"P",
	"O",
	"V",
	"D",
	"N2",
	"I1",
	"I2",
	"I2'",
	"I3",
	"I4",
	"I5",
	"I6",
]);

/**
 * [file, search text, replacement] steps per mutation. `guarantee` is what the
 * mutation removes and `where` is where that guarantee lives in the sources.
 * M1-M10 are the semantic mutations of the pre-ADR-0049 session, restated for
 * the observation/plan model; M11-M13 remove the guarantees behind the cells
 * that were known to fail before it (F1, F2, N2).
 */
export const MUTATIONS = {
	M1: {
		what: "review no longer required for a version the document has not acknowledged",
		guarantee:
			"Replacing a disk version the document has not acknowledged shows a review",
		where: "workspace-controller.ts saveEntry: the review condition",
		steps: [
			[
				"src/workspace-controller.ts",
				"(observed || !session.acknowledges(selected))",
				"(observed)",
			],
		],
	},
	M2: {
		what: "a clean editor is decided by the text alone, not by unsaved state",
		guarantee:
			"A tab that shows unsaved state (failed read, deletion, recovery) is never reloaded",
		where: "document-session.ts observe: the clean test",
		steps: [
			[
				"src/document-session.ts",
				"const clean = !this.isDirty();",
				"const clean = this.view.getSource() === this.acknowledged.source;",
			],
		],
	},
	M3: {
		what: "the original counts as acknowledged while a Save As recovery is pending",
		guarantee:
			"Saving the original after a failed Save As still reviews a changed original",
		where: "document-session.ts acknowledges",
		steps: [
			[
				"src/document-session.ts",
				"disk && disk.id === snapshot.id && sameDiskContent(disk, snapshot),",
				"disk && disk.id === snapshot.id && (this.recovery !== null || sameDiskContent(disk, snapshot)),",
			],
		],
	},
	M4: {
		what: "operation plans are not checked when executed",
		guarantee:
			"An approval applies only to the state it was given for; Use Disk refuses a changed editor or disk",
		where: "document-session.ts save and adopt: holds(plan)",
		steps: [
			[
				"src/document-session.ts",
				'if (!this.holds(plan)) return { saved: false, stale: true, message: "" };',
				"",
			],
			[
				"src/document-session.ts",
				"if (!plan.target || !this.holds(plan)) return false;",
				"if (!plan.target) return false;",
			],
		],
	},
	M5: {
		what: "the recovery target is read only after the original succeeds",
		guarantee:
			"Every unresolved target is read, and one failing read never skips another",
		where: "document-session.ts readTargets",
		steps: [
			[
				"src/document-session.ts",
				"const results = await Promise.allSettled(\n\t\t\ttargets.map((target) => read(target.id)),\n\t\t);",
				"const first = (await Promise.allSettled([read(targets[0].id)]))[0];\n\t\tconst results = [first];\n\t\tif (targets.length > 1) results.push(first.status === 'fulfilled' ? (await Promise.allSettled([read(targets[1].id)]))[0] : first);",
			],
		],
	},
	M6: {
		what: "the panel preview shows editor content, not the observation",
		guarantee:
			"The panel compares against the same snapshot its buttons act on",
		where: "application.ts renderConflict: the preview text",
		steps: [
			[
				"src/application.ts",
				'text.textContent = observed\n\t\t\t\t? (observed.source ?? "File is missing")\n\t\t\t\t: "The current disk content could not be confirmed.";',
				"text.textContent = entry.tab.getSource();",
			],
		],
	},
	M7: {
		what: "a second unreadable target is not a new state",
		guarantee:
			"Another target becoming unreadable invalidates a decision taken before",
		where:
			"document-session.ts observe: epoch advance on a changed classification",
		steps: [
			[
				"src/document-session.ts",
				"const moved = differs(previous, next);",
				'const moved = differs(previous, next) && !(next.state === "unreadable" && [...this.observations.values()].some((item) => item.state === "unreadable"));',
			],
		],
	},
	M8: {
		what: "the unresolved save target's observation is not recorded",
		guarantee:
			"The recovery target is observed like the document's own file, whatever read started it",
		where: "document-session.ts observe: storing the observation",
		steps: [
			[
				"src/document-session.ts",
				"this.observations.set(target.id, next);",
				"if (target.id === this.acknowledged.disk?.id) this.observations.set(target.id, next);",
			],
		],
	},
	M9: {
		what: "closeDocuments final re-read removed",
		guarantee:
			"Close checks every target again after the last decision, before disposing tabs",
		where: "document-session.ts closeDocuments",
		steps: [
			[
				"src/document-session.ts",
				"\tfor (const document of documents) await document.prepareClose?.();\n\tif (",
				"\tif (",
			],
		],
	},
	M10: {
		what: "closeEntries prepareClose re-read removed",
		guarantee: "Close starts a fresh read of every target before the decision",
		where: "workspace-controller.ts closeEntries: prepareClose",
		steps: [
			[
				"src/workspace-controller.ts",
				"\t\t\t\t\tawait entry.record.session\n\t\t\t\t\t\t.checkExternal((id) => files.inspect(id))\n\t\t\t\t\t\t.catch(report);\n",
				"",
			],
		],
	},
	M11: {
		what: "a close Save is not checked against the decision it follows",
		guarantee:
			"A Save decision applies to the text shown when it was asked (F1)",
		where: "workspace-controller.ts saveEntry: the confirmation plan check",
		steps: [
			[
				"src/workspace-controller.ts",
				'if (confirmation && !session.holds(confirmation, "editor")) {',
				"if (false) {",
			],
		],
	},
	M12: {
		what: "a failed pre-save read is not remembered",
		guarantee:
			"A failed read protects the tab whichever entry point saw it (F2)",
		where: "workspace-controller.ts saveEntry: the pre-save inspection failure",
		steps: [
			[
				"src/workspace-controller.ts",
				"session.observe(remembered, { error }, scope);",
				"",
			],
		],
	},
	M13: {
		what: "close keeps the version from before its successful Save",
		guarantee:
			"A save that succeeds during a close confirmation leaves the close one attempt (N2)",
		where:
			"document-session.ts closeDocuments: capturing the post-decision version",
		steps: [
			[
				"src/document-session.ts",
				"await document.prepareClose?.();\n\t\tif (document.isDirty()) {",
				"await document.prepareClose?.();\n\t\tconst versionBeforeDecision = document.closeVersion?.();\n\t\tif (document.isDirty()) {",
			],
			[
				"src/document-session.ts",
				"version: document.closeVersion?.(),",
				"version: versionBeforeDecision,",
			],
		],
	},
	M14: {
		what: "a Close Save no-op bypasses its editor-version check",
		guarantee:
			"An edit back to acknowledged text during the pre-save read requires a new close decision",
		where:
			"workspace-controller.ts saveEntry: confirmation check before no-op exits",
		steps: [
			[
				"src/workspace-controller.ts",
				"if (disposed || !isOpen(entry) || !checkConfirmation()) return false;",
				"if (disposed || !isOpen(entry)) return false;",
			],
		],
	},
	M15: {
		what: "rename recovery uses the acknowledged inode instead of the observed inode",
		guarantee:
			"A same-content replacement can be recovered at its renamed leaf after the old leaf is inspected missing",
		where: "document-session.ts location: target observation identity",
		steps: [
			[
				"src/document-session.ts",
				"identity: identityOf(observation) ?? disk.identity",
				"identity: disk.identity",
			],
		],
	},
	M16: {
		what: "the panel treats two capabilities for one binding as distinct targets",
		guarantee:
			"The original is not also changed when it is the recovery target; hard-link leaves remain separate",
		where: "document-session.ts panel: original target relation",
		steps: [
			[
				"src/document-session.ts",
				"recovery.target.binding !== disk.binding",
				"recovery.target.id !== disk.id",
			],
		],
	},
	M17: {
		what: "rebind relabels a plan's target without advancing its epoch",
		guarantee:
			"A plan cannot execute after its capability or displayed path changes",
		where: "document-session.ts rebindDisk: epoch advance",
		steps: [
			[
				"src/document-session.ts",
				"\t\tif (plan.acknowledged !== this.acknowledged) return false;",
				"",
			],
			[
				"src/document-session.ts",
				"\t\tif (\n\t\t\tprevious.id !== current.id ||\n\t\t\tprevious.binding !== current.binding ||\n\t\t\tthis.location?.path !== current.path\n\t\t)\n\t\t\tthis.epoch++;",
				"",
			],
		],
	},
};

const invariant = (name) => ({
	file: "document-lifecycle-invariants.test.mjs",
	name,
});
const recovery = (name) => ({
	file: "document-lifecycle-recovery.test.mjs",
	name,
});
const memory = (name) => ({ file: "document-lifecycle-memory.test.mjs", name });
const session = (name) => ({ file: "document-session.test.mjs", name });

// These witnesses were observed to fail in the full, green-baseline mutation
// run before moving the matrices. The presenter witness keeps the UI boundary.
export const MUTATION_CASES = {
	M1: [invariant("clean | deleted | drift | cmd-s")],
	M2: [invariant("clean | deleted | drift | cmd-s")],
	M3: [
		recovery("save-as-conflict | A content-changed | B none | polled | cmd-s"),
	],
	M4: [
		memory("plan lifetime | review | edit-undo"),
		memory("plan lifetime | adopt | edit-undo"),
	],
	M5: [recovery("save-as-conflict | A unreadable | B none | polled | cmd-s")],
	M6: [
		{
			file: "document-presenter.test.mjs",
			name: "presenter | recovery preview and review use the observed target",
		},
	],
	M7: [
		recovery(
			"save-as-b-unreadable | A unreadable | B none | during-confirm | close-discard",
		),
	],
	M8: [memory("moved target | Use Current Disk Version before 0 poll(s)")],
	M9: [invariant("clean | none | polled | quit-save")],
	M10: [invariant("clean | none | polled | close-save")],
	M11: [memory("lifetime | pending-inspect | edit | close-save")],
	M12: [invariant("clean | unreadable | unpolled | cmd-s")],
	M13: [invariant("dirty | metadata-only | polled | close-save")],
	M14: [
		memory("lifetime | pending-inspect | revert-to-acknowledged | close-save"),
	],
	M15: [
		memory(
			"rename recovery | same-content replacement observed before leaf rename | missing polls: 0",
		),
	],
	M16: [
		memory("recovery panel | same-binding new capability after failed Save As"),
	],
	M17: [
		session("plan rebind | save | new capability"),
		session("plan rebind | adopt | moved path"),
	],
};

function copyTree() {
	const tree = mkdtempSync(join(tmpdir(), "pfdsl-mutation-"));
	const target = join(tree, "packages/standalone");
	mkdirSync(target, { recursive: true });
	for (const name of ["src", "test", "index.html", "package.json"])
		cpSync(join(standalone, name), join(target, name), { recursive: true });
	symlinkSync(join(repo, "node_modules"), join(tree, "node_modules"));
	symlinkSync(join(standalone, "node_modules"), join(target, "node_modules"));
	// This helper imports the repository's shared CLI entrypoint check.
	mkdirSync(join(tree, "scripts"));
	symlinkSync(join(repo, "scripts/lib"), join(tree, "scripts/lib"));
	return tree;
}

function apply(tree, mutation) {
	for (const [file, search, replacement] of mutation.steps) {
		const path = join(tree, "packages/standalone", file);
		const text = readFileSync(path, "utf8");
		const count = text.split(search).length - 1;
		if (count !== 1)
			throw new Error(
				`${file}: expected one match, found ${count} for ${JSON.stringify(search.slice(0, 60))}`,
			);
		writeFileSync(
			path,
			text.replace(search, () => replacement),
		);
	}
}

function runSuite(tree, cases) {
	const pattern = `^(?:${cases.map(({ name }) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`;
	const files = [
		...new Set(cases.map(({ file }) => `packages/standalone/test/${file}`)),
	];
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				"--test",
				"--test-reporter=spec",
				`--test-name-pattern=${pattern}`,
				...files,
			],
			{ cwd: tree, stdio: ["ignore", "pipe", "pipe"] },
		);
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ output, code }));
	});
}

/** Failing cells and the invariant tags in their messages. */
function failures(output) {
	const section = output.split("✖ failing tests:").at(-1);
	if (!output.includes("✖ failing tests:")) return [];
	return section
		.split(/\ntest at /)
		.map((block) => {
			const label = /✖ (.+?) \(\d[\d.]*ms\)/.exec(block)?.[1];
			const tags = [
				...new Set(
					[...block.matchAll(/^\s+\+\s+['"]([A-Za-z][A-Za-z0-9']*): /gm)].map(
						(match) => match[1],
					),
				),
			].filter((tag) => INVARIANT_TAGS.has(tag));
			return label ? { label, tags } : undefined;
		})
		.filter(Boolean);
}

export function selectNames(wanted, available = Object.keys(MUTATIONS)) {
	return [
		"baseline",
		...new Set(
			(wanted.length ? wanted : available).filter(
				(name) => name !== "baseline",
			),
		),
	];
}
export function newlyTagged(cells, baselineCells) {
	const existing = new Set(baselineCells.map((cell) => cell.label));
	return cells.filter(
		(cell) => cell.tags.length > 0 && !existing.has(cell.label),
	);
}
export function selectedCases(wanted, available = MUTATION_CASES) {
	const selected = new Map();
	for (const name of wanted.length ? wanted : Object.keys(available)) {
		if (!Object.hasOwn(available, name))
			throw new Error(`Unknown mutation: ${name}`);
		for (const item of available[name])
			selected.set(`${item.file}\0${item.name}`, item);
	}
	return [...selected.values()];
}
export function completeSelection(total, labels, wanted) {
	return (
		total === wanted.length &&
		labels.length === wanted.length &&
		new Set(labels).size === wanted.length &&
		wanted.every(({ name }) => labels.includes(name))
	);
}
async function runMutation(name, selected) {
	const start = performance.now();
	const tree = copyTree();
	try {
		if (name !== "baseline") apply(tree, MUTATIONS[name]);
		const { output, code } = await runSuite(tree, selected);
		const total = Number(/^ℹ tests (\d+)/m.exec(output)?.[1] ?? 0);
		const failed = Number(/^ℹ fail (\d+)/m.exec(output)?.[1] ?? 0);
		const cells = failures(output);
		const tagged = cells.filter((cell) => cell.tags.length > 0);
		const labels = [
			...output
				.split("✖ failing tests:")[0]
				.matchAll(/^[✔✖] (.+?) \(\d[\d.]*ms\)$/gm),
		].map((match) => match[1]);
		const durationMs = performance.now() - start;
		console.log(
			`completed ${name}: ${failed}/${total} failing, ${tagged.length} invariant-labelled, ${durationMs.toFixed(1)}ms`,
		);
		return { name, total, failed, tagged, cells, code, labels, durationMs };
	} finally {
		rmSync(tree, { recursive: true, force: true });
	}
}

async function main() {
	const start = performance.now();
	const names = selectNames(process.argv.slice(2));
	for (const name of names)
		if (name !== "baseline" && !Object.hasOwn(MUTATIONS, name))
			throw new Error(`Unknown mutation: ${name}`);
	const selected = selectedCases(names.filter((name) => name !== "baseline"));
	// Each suite already runs test files concurrently; bound the number of copied suites.
	const baseline = await runMutation("baseline", selected);
	if (
		baseline.failed ||
		baseline.code !== 0 ||
		!completeSelection(baseline.total, baseline.labels, selected)
	) {
		console.error(
			"GATE FAILED: selected baseline must execute every named witness exactly once and pass.",
		);
		process.exit(1);
	}
	const results = [baseline];
	for (let offset = 1; offset < names.length; offset += 2)
		results.push(
			...(await Promise.all(
				names
					.slice(offset, offset + 2)
					.map((name) => runMutation(name, selected)),
			)),
		);

	let missed = false;
	for (const { name, total, failed, cells, code, labels } of results) {
		const tagged =
			name === "baseline"
				? cells.filter((cell) => cell.tags.length > 0)
				: newlyTagged(cells, baseline.cells);
		const what =
			name === "baseline" ? "unmodified suite" : MUTATIONS[name].what;
		const tags = [...new Set(tagged.flatMap((cell) => cell.tags))].join(",");
		console.log(
			`${name.padEnd(8)} ${what}\n         failing ${failed}/${total}, invariant-labelled ${tagged.length} [${tags}]`,
		);
		if (name !== "baseline")
			console.log(
				`         removes: ${MUTATIONS[name].guarantee} (${MUTATIONS[name].where})`,
			);
		for (const cell of tagged.slice(0, 3))
			console.log(`         e.g. ${cell.label} :: ${cell.tags.join(",")}`);
		if (
			!completeSelection(total, labels, selected) ||
			(name === "baseline"
				? failed !== 0 || code !== 0
				: !MUTATION_CASES[name].every(({ name: label }) =>
						tagged.some((cell) => cell.label === label),
					) ||
					failed === 0 ||
					code !== 1)
		)
			missed = true;
		if (name !== "baseline" && tagged.length === 0 && cells.length > 0)
			console.log(
				`         only untagged: ${cells
					.slice(0, 2)
					.map((cell) => cell.label)
					.join("; ")}`,
			);
	}
	if (!existsSync(standalone)) process.exit(2);
	console.log(
		`${missed ? "GATE FAILED" : "gate passed"} (${selected.length} selected witnesses; ${(performance.now() - start).toFixed(1)}ms)`,
	);
	process.exit(missed ? 1 : 0);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) await main();

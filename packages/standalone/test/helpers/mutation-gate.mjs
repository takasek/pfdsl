// Mutation gate for the lifecycle invariants. Run by hand, not by `make test`:
//
//   node packages/standalone/test/helpers/mutation-gate.mjs [M1 M4 ...]
//
// Every mutation is applied to a COPY of the standalone package in a temporary
// tree (src, test, index.html, package.json; node_modules is linked), the
// standalone suite runs there, and the worktree itself is never modified. A
// mutation is caught when at least one failing cell reports an invariant tag
// (L, R, A, C, U, K, T, P, O, V, D, N2, I1..I6) rather than only a status text.
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
import { fileURLToPath } from "node:url";

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

// The suites that exercise the document lifecycle. The editor tests need
// packages outside the copied tree and say nothing about these mutations.
const SUITE = [
	"close-guard.test.mjs",
	"document-host-recovery.test.mjs",
	"document-lifecycle-invariants.test.mjs",
	"document-lifecycle-memory.test.mjs",
	"document-lifecycle-recovery.test.mjs",
	"document-lifecycle-relations.test.mjs",
	"document-lifecycle-scenarios.test.mjs",
	"document-session.test.mjs",
];

/**
 * [file, search text, replacement] steps per mutation. `guarantee` is what the
 * mutation removes and `where` is where that guarantee lives in the sources.
 * M1-M10 are the semantic mutations of the pre-ADR-0047 session, restated for
 * the observation/plan model; M11-M13 remove the guarantees behind the cells
 * that were known to fail before it (F1, F2, N2).
 */
const MUTATIONS = {
	M1: {
		what: "review no longer required for a version the document has not acknowledged",
		guarantee:
			"Replacing a disk version the document has not acknowledged shows a review",
		where: "main.ts saveEntry: the review condition",
		steps: [
			[
				"src/main.ts",
				"(chosen || observed || !session.acknowledges(selected))",
				"(chosen || observed)",
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
		what: "the panel preview shows the acknowledged baseline, not the observation",
		guarantee:
			"The panel compares against the same snapshot its buttons act on",
		where: "main.ts renderConflict: the preview text",
		steps: [
			[
				"src/main.ts",
				'text.textContent = observed\n\t\t\t? (observed.source ?? "File is missing")\n\t\t\t: "The current disk content could not be confirmed.";',
				'text.textContent = entry.session.disk?.source ?? "The current disk content could not be confirmed.";',
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
		where: "main.ts closeEntries: prepareClose",
		steps: [
			[
				"src/main.ts",
				'\t\t\t\t\tawait entry.session\n\t\t\t\t\t\t.checkExternal((id) =>\n\t\t\t\t\t\t\tinvoke<DiskSnapshot>("inspect_document", { id }),\n\t\t\t\t\t\t)\n\t\t\t\t\t\t.catch(report);\n',
				"",
			],
		],
	},
	M11: {
		what: "a close Save is not checked against the decision it follows",
		guarantee:
			"A Save decision applies to the text shown when it was asked (F1)",
		where: "main.ts saveEntry: the confirmation plan check",
		steps: [
			[
				"src/main.ts",
				'if (confirmation && !session.holds(confirmation, "editor")) {',
				"if (false) {",
			],
		],
	},
	M12: {
		what: "a failed pre-save read is not remembered",
		guarantee:
			"A failed read protects the tab whichever entry point saw it (F2)",
		where: "main.ts saveEntry: the pre-save inspection failure",
		steps: [
			["src/main.ts", "session.observe(remembered, { error }, scope);", ""],
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
};

function copyTree() {
	const tree = mkdtempSync(join(tmpdir(), "pfdsl-mutation-"));
	const target = join(tree, "packages/standalone");
	mkdirSync(target, { recursive: true });
	for (const name of ["src", "test", "index.html", "package.json"])
		cpSync(join(standalone, name), join(target, name), { recursive: true });
	symlinkSync(join(repo, "node_modules"), join(tree, "node_modules"));
	symlinkSync(join(standalone, "node_modules"), join(target, "node_modules"));
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

function runSuite(tree) {
	return new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["--test", ...SUITE.map((file) => `packages/standalone/test/${file}`)],
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

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : ["baseline", ...Object.keys(MUTATIONS)];
for (const name of names)
	if (name !== "baseline" && !Object.hasOwn(MUTATIONS, name))
		throw new Error(`Unknown mutation: ${name}`);
async function runMutation(name) {
	const tree = copyTree();
	try {
		if (name !== "baseline") apply(tree, MUTATIONS[name]);
		const { output, code } = await runSuite(tree);
		const total = Number(/^ℹ tests (\d+)/m.exec(output)?.[1] ?? 0);
		const failed = Number(/^ℹ fail (\d+)/m.exec(output)?.[1] ?? 0);
		const cells = failures(output);
		const tagged = cells.filter((cell) => cell.tags.length > 0);
		console.log(
			`completed ${name}: ${failed}/${total} failing, ${tagged.length} invariant-labelled`,
		);
		return { name, total, failed, tagged, cells, code };
	} finally {
		rmSync(tree, { recursive: true, force: true });
	}
}

// Each suite already runs test files concurrently; bound the number of copied suites.
const results = [];
for (let offset = 0; offset < names.length; offset += 2)
	results.push(
		...(await Promise.all(names.slice(offset, offset + 2).map(runMutation))),
	);
const baseline = results.find((result) => result.name === "baseline");

let missed = false;
for (const { name, total, failed, tagged, cells, code } of results) {
	const what = name === "baseline" ? "unmodified suite" : MUTATIONS[name].what;
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
		total === 0 ||
		(baseline && total !== baseline.total) ||
		(name === "baseline"
			? failed !== 0 || code !== 0
			: tagged.length === 0 || failed === 0 || code !== 1)
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
console.log(missed ? "GATE FAILED" : "gate passed");
process.exit(missed ? 1 : 0);

// Mutation gate for the lifecycle invariants. Run by hand, not by `make test`:
//
//   node packages/standalone/test/helpers/mutation-gate.mjs [M1 M4 ...]
//
// Every mutation is applied to a COPY of the standalone package in a temporary
// tree (src, test, index.html, package.json; node_modules is linked), the
// standalone suite runs there, and the worktree itself is never modified. A
// mutation is caught when at least one failing cell reports an invariant tag
// (L, R, A, C, U, K, T, P, O, V, D, I1..I6) rather than only a status text.
// Mutation texts match the current sources; update them with the sources.
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

// The suites that exercise the document lifecycle. The editor tests need
// packages outside the copied tree and say nothing about these mutations.
const SUITE = [
	"close-guard.test.mjs",
	"document-host-recovery.test.mjs",
	"document-lifecycle-invariants.test.mjs",
	"document-lifecycle-recovery.test.mjs",
	"document-lifecycle-scenarios.test.mjs",
	"document-session.test.mjs",
];

/** [description, file, search text, replacement] steps per mutation. */
const MUTATIONS = {
	M1: {
		what: "review condition without observed/conflict",
		steps: [
			[
				"src/main.ts",
				"(chosen || observed || changed || entry.session.conflict)",
				"(chosen || changed)",
			],
		],
	},
	M2: {
		what: "followDiskIfClean back to text === savedSource",
		steps: [
			[
				"src/document-session.ts",
				"if (this.isDirty() || this.saveFailure || this.pendingTarget) return null;",
				"if (this.view.getSource() !== this.savedSource || this.saveFailure || this.pendingTarget) return null;",
			],
		],
	},
	M3: {
		what: "recordTarget recovery branch returns false",
		steps: [
			[
				"src/document-session.ts",
				"this.sourceConflict = changed ? fresh : null;\n\t\t\t\treturn changed;",
				"this.sourceConflict = changed ? fresh : null;\n\t\t\t\treturn false;",
			],
		],
	},
	M4: {
		what: "remove changedDuringReview()",
		steps: [
			[
				"src/main.ts",
				'if (decision !== "replace" || changedDuringReview()) return false;',
				'if (decision !== "replace") return false;',
			],
			[
				"src/main.ts",
				'if (decision !== "create" || changedDuringReview()) return false;',
				'if (decision !== "create") return false;',
			],
		],
	},
	M5: {
		what: "read the recovery target only after the original succeeds",
		steps: [
			[
				"src/document-session.ts",
				"const [original, target] = await Promise.allSettled([\n\t\t\tbaseline ? read(baseline.id) : Promise.resolve(null),\n\t\t\tread(recovery.id),\n\t\t]);",
				"const [original] = await Promise.allSettled([baseline ? read(baseline.id) : Promise.resolve(null)]);\n\t\tconst [target] = original.status === 'fulfilled' ? await Promise.allSettled([read(recovery.id)]) : [original];",
			],
		],
	},
	M6: {
		what: "panel preview from conflict instead of observed",
		steps: [
			[
				"src/main.ts",
				'text.textContent = observed\n\t\t\t? (observed.source ?? "File is missing")\n\t\t\t: "The current disk content could not be confirmed.";',
				'text.textContent = entry.session.conflict?.source ?? "The current disk content could not be confirmed.";',
			],
		],
	},
	M7: {
		what: "unreadable tracking as a single flag",
		steps: [
			[
				"src/document-session.ts",
				"if (this.unreadable.has(id)) return;\n\t\tthis.unreadable.add(id);\n\t\tthis.observationVersion++;",
				"const first = this.unreadable.size === 0;\n\t\tthis.unreadable.add(id);\n\t\tif (first) this.observationVersion++;",
			],
		],
	},
	M8: {
		what: "drop readable/unreadable tracking of the recovery observation",
		steps: [
			[
				"src/document-session.ts",
				'\t\tif (baseline)\n\t\t\tif (original.status === "fulfilled") this.markReadable(baseline.id);\n\t\t\telse this.markUnreadable(baseline.id);\n\t\tif (target.status === "fulfilled") this.markReadable(recovery.id);\n\t\telse this.markUnreadable(recovery.id);\n',
				"",
			],
		],
	},
	M9: {
		what: "closeDocuments final re-read removed",
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
		steps: [
			[
				"src/main.ts",
				'\t\t\t\t\tawait entry.session\n\t\t\t\t\t\t.checkExternal((id) =>\n\t\t\t\t\t\t\tinvoke<DiskSnapshot>("inspect_document", { id }),\n\t\t\t\t\t\t)\n\t\t\t\t\t\t.catch(report);\n',
				"",
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
	return new Promise((resolve) => {
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
		child.on("close", () => resolve(output));
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
			];
			return label ? { label, tags } : undefined;
		})
		.filter(Boolean);
}

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : ["baseline", ...Object.keys(MUTATIONS)];
const results = await Promise.all(
	names.map(async (name) => {
		const tree = copyTree();
		try {
			if (name !== "baseline") apply(tree, MUTATIONS[name]);
			const output = await runSuite(tree);
			const total = Number(/^ℹ tests (\d+)/m.exec(output)?.[1] ?? 0);
			const failed = Number(/^ℹ fail (\d+)/m.exec(output)?.[1] ?? 0);
			const cells = failures(output);
			const tagged = cells.filter((cell) => cell.tags.length > 0);
			return { name, total, failed, tagged, cells };
		} finally {
			rmSync(tree, { recursive: true, force: true });
		}
	}),
);

let missed = false;
for (const { name, total, failed, tagged, cells } of results) {
	const what = name === "baseline" ? "unmodified suite" : MUTATIONS[name].what;
	const tags = [...new Set(tagged.flatMap((cell) => cell.tags))].join(",");
	console.log(
		`${name.padEnd(8)} ${what}\n         failing ${failed}/${total}, invariant-labelled ${tagged.length} [${tags}]`,
	);
	for (const cell of tagged.slice(0, 3))
		console.log(`         e.g. ${cell.label} :: ${cell.tags.join(",")}`);
	if (name === "baseline" ? failed !== 0 : tagged.length === 0) missed = true;
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

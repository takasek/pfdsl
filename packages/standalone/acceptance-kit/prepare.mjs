// Copy-only preparation into a NEW disposable directory; no user settings change.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.argv[2];
if (!target || !isAbsolute(target))
	throw new Error("Provide an absolute NEW directory path.");
await mkdir(target); // EEXIST deliberately refuses to overwrite an earlier run.
const samples = new URL("../../../docs/samples/", import.meta.url);
await cp(samples, join(target, "samples"), { recursive: true });
for (const path of [
	"one",
	"two",
	"compare",
	"external",
	"output",
	"references",
	"references/empty",
])
	await mkdir(join(target, path), { recursive: true });
const graph = `---
title: Acceptance neighbors
artifact:
  a: { label: "入力 日本語と長いラベルで表示を確認する", location: "references/note.txt" }
  b: { label: Result, criteria: "Verify the actual result" }
  c: { label: Downstream, criteria: "Check downstream" }
  d: { label: Other, criteria: "Check other branch" }
  lone: { label: "孤立ノード" }
process:
  p: { label: "工程 日本語の長い説明と接続を確認する", description: "First line. Second line.", command: "printf 'acceptance only\\n'" }
  q: { label: Next }
  r: { label: Parallel }
---
a >> p -> b
b >>? p
b >> q -> c
a >> r -> d
`;
const fixtures = {
	"one/same.pfdsl": graph.replace(
		"references/note.txt",
		"../references/note.txt",
	),
	"two/same.pfdsl": graph
		.replace("references/note.txt", "../references/note.txt")
		.replace("Acceptance neighbors", "Different document B")
		.replace("-> d", "-> lone"),
	"neighbors.pfdsl": graph,
	"undefined.pfdsl": "a >> p -> b\nb >>? p\nb >> q -> c\na >> r -> d\n",
	"日本語の長い文書名と長いラベルを確認する資料.pfdsl": graph,
	"quoted-crlf.pfdsl":
		'---\r\nartifact: { "a a": { label: "日本語 😀" }, b: { label: Output, criteria: Verify } }\r\nprocess: { "p p": { label: Process } }\r\n---\r\n"a a" >> "p p" -> b\r\n',
	"error.pfdsl": "---\nartifact: [\n---\na >> p -> b\n",
	"lexer-error.pfdsl": "a @ p\n",
	"quoted-undefined.pfdsl": '"a a" >> "p p" -> b\r\n',
	"external/current.pfdsl": graph.replace(
		"references/note.txt",
		"../references/note.txt",
	),
	"external/replacement.pfdsl": graph
		.replace("references/note.txt", "../references/note.txt")
		.replace("Acceptance neighbors", "External replacement"),
	"compare/base.pfdsl": graph.replace(
		"references/note.txt",
		"../references/note.txt",
	),
	"compare/metadata.pfdsl": graph
		.replace("references/note.txt", "../references/note.txt")
		.replace("label: Result", "label: Changed metadata"),
	"compare/edges.pfdsl": graph
		.replace("references/note.txt", "../references/note.txt")
		.replace("a >> r -> d", "a >> r -> lone"),
	"references/note.txt": "Disposable external file for GUI-30.\n",
	"references/child.pfdsl": "x >> task -> y\n",
	"missing-extends.pfdsl": "---\nextends: not-present.yaml\n---\na >> p -> b\n",
	"cyclic-a.pfdsl": "---\nextends: cyclic-b.pfdsl\n---\na >> p -> b\n",
	"cyclic-b.pfdsl": "---\nextends: cyclic-a.pfdsl\n---\na >> p -> b\n",
};
for (const [path, source] of Object.entries(fixtures))
	await writeFile(join(target, path), source);
const longComparison =
	graph.replace("references/note.txt", "../references/note.txt") +
	Array.from(
		{ length: 180 },
		(_, i) =>
			`# Comparison line ${i}: ${"Long Japanese comparison 日本語 ".repeat(i === 90 ? 120 : 2)}`,
	).join("\n") +
	"\n";
await writeFile(join(target, "compare/long-base.pfdsl"), longComparison);
await writeFile(
	join(target, "compare/long-current.pfdsl"),
	longComparison
		.replace("line 3:", "changed line 3:")
		.replace("line 90:", "changed line 90:")
		.replace("line 175:", "changed line 175:"),
);
const many = `${Array.from(
	{ length: 40 },
	(_, i) => `input_${i} >> hub -> output_${i}`,
).join("\n")}\noutput_0 >>? hub\n`;
await writeFile(join(target, "many.pfdsl"), many);
await writeFile(
	join(target, "wide.pfdsl"),
	`${Array.from({ length: 80 }, (_, i) => `a${i} >> p${i} -> a${i + 1}`).join(
		"\n",
	)}\n`,
);
await writeFile(
	join(target, "oversize.pfdsl"),
	'---\nlayout: { direction: LR }\nartifact:\n  a: { label: "' +
		"W".repeat(15000) +
		'" }\n---\na >> p -> b\n',
);
for (const name of ["RECORDS.csv", "README.md"])
	await cp(new URL(name, import.meta.url), join(target, name));
const large = await readFile(
	join(target, "samples/pfdsl_implementation_flow.pfdsl"),
	"utf8",
);
await writeFile(
	join(target, "INPUTS.json"),
	`${JSON.stringify(
		{
			preparedFrom: fileURLToPath(new URL("../../..", import.meta.url)),
			largeDiagramLines:
				large.split("\n").length - Number(large.endsWith("\n")),
			generated: Object.keys(fixtures),
			oversizedLabelCharacters: 15000,
		},
		null,
		2,
	)}\n`,
);
console.log(target);

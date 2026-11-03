import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fromMarkdown } from "mdast-util-from-markdown";

// dump supplies resolved links and their physical lines. A list block's text
// has no blank lines, so it cannot tell us which item owns a link.
async function regomarkJson(args, allowedStatus) {
	const child = spawn("regomark", args, {
		stdio: ["ignore", "pipe", "inherit"],
	});
	const done = new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", resolve);
	});
	const chunks = [];
	child.stdout.on("data", (chunk) => chunks.push(chunk));
	const status = await done;
	if (!allowedStatus.includes(status)) process.exit(status ?? 2);
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const findings = await regomarkJson(
	["check", "--no-judge", "--format", "json"],
	[0, 1],
);
const { documents } = await regomarkJson(["dump"], [0]);
const targets = new Map(
	documents
		.filter((doc) => doc.name !== "README.md")
		.map((doc) => [`ADR-${doc.name.split("-")[0]}`, doc.path]),
);

function textOnLine(node, line) {
	const { start, end } = node.position;
	if (line < start.line || line > end.line) return "";
	if (node.children)
		return node.children.map((child) => textOnLine(child, line)).join("");
	return (node.value ?? "").split(/\r\n?|\n/)[line - start.line] ?? "";
}

function collectReplacementLines(node, lines) {
	if (node.type === "paragraph") {
		for (
			let line = node.position.start.line;
			line <= node.position.end.line;
			line++
		) {
			const text = textOnLine(node, line);
			if (
				/^(partially )?supersedes:/i.test(text) ||
				(/^Status:/.test(text) &&
					/superseded (?:in part )?by|で部分上書き/i.test(text))
			)
				lines.add(line);
		}
	} else {
		for (const child of node.children ?? [])
			collectReplacementLines(child, lines);
	}
}

for (const doc of documents) {
	if (doc.name === "README.md") continue;
	const replacementLines = new Set();
	collectReplacementLines(
		fromMarkdown(readFileSync(doc.path, "utf8")),
		replacementLines,
	);
	for (const link of doc.links) {
		const refs = link.text.match(/ADR-[0-9]+/g) ?? [];
		const mismatch = refs.some(
			(id) =>
				targets.has(id) &&
				(link.kind !== "file" || link.target !== targets.get(id)),
		);
		if (
			!mismatch ||
			!doc.blocks.some(
				(b) =>
					(b.kind === "list" || b.kind === "paragraph") &&
					b.line <= link.line &&
					link.line <= b.end_line,
			)
		)
			continue;
		if (replacementLines.has(link.line)) {
			findings.push({
				rule: "adr-replacement",
				severity: "deny",
				path: doc.path,
				line: link.line,
				message: "Replacement link does not resolve to the named ADR",
			});
		}
	}
}
if (process.argv.includes("--json")) {
	console.log(JSON.stringify(findings));
} else {
	for (const { path, line, rule, message } of findings) {
		console.error(`${path}:${line}: [${rule}] ${message}`);
	}
}
if (findings.some((hit) => hit.severity === "deny")) process.exitCode = 1;

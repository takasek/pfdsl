import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	globSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeFullDocumentFormatOutput } from "@pfdsl/editor";
import { renderDotToSvg } from "@pfdsl/preview-engine/renderer";
import { preparePreviewForDocument } from "../../vscode-extension/dist/analysis-host.cjs";

const target = process.argv[2];
if (!target || !isAbsolute(target))
	throw new Error("Pass a new absolute corpus directory");
const executable = process.argv[3];
if (!executable || !isAbsolute(executable))
	throw new Error("Pass the absolute path of the native executable to verify");
mkdirSync(target);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const sha256 = (file) =>
	createHash("sha256").update(readFileSync(file)).digest("hex");
const build = {
	frontend: globSync("packages/standalone/dist/**/*", {
		cwd: repo,
	})
		.filter((file) => statSync(join(repo, file)).isFile())
		.sort()
		.map((file) => ({ file, sha256: sha256(join(repo, file)) })),
	nativeExecutable: { path: executable, sha256: sha256(executable) },
};
cpSync(join(repo, "docs/samples"), join(target, "docs/samples"), {
	recursive: true,
});
cpSync(join(repo, ".pfdsl"), join(target, ".pfdsl"), { recursive: true });
const files = globSync("docs/samples/*.pfdsl", { cwd: target })
	.sort()
	.concat([
		".pfdsl/roadmap.pfdsl",
		".pfdsl/workflow.pfdsl",
		".pfdsl/pipeline.pfdsl",
	]);
const json = (value) =>
	JSON.stringify(value, (_key, value) =>
		value instanceof Map ? [...value] : value,
	);
const entries = [];
for (const file of files) {
	const path = join(target, file);
	const source = readFileSync(path, "utf8");
	const result = preparePreviewForDocument({
		uri: { scheme: "file", fsPath: path, toString: () => `file://${path}` },
		version: 1,
		getText: () => source,
	});
	entries.push({
		file,
		path,
		source,
		sha256: createHash("sha256").update(source).digest("hex"),
		expected: {
			model: json(result.model),
			frontmatter: json(result.frontmatter),
			presetDiagnostics: json(result.presetDiagnostics),
			message: json(result.message),
			formatOutput: computeFullDocumentFormatOutput(source, "flows"),
			svg:
				result.message.type === "render"
					? await renderDotToSvg(result.message.dot)
					: null,
		},
	});
}
writeFileSync(
	join(target, "baseline.json"),
	JSON.stringify({
		reference: execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: repo,
			encoding: "utf8",
		}).trim(),
		build,
		entries,
	}),
);
console.log(
	`Prepared ${entries.length} documents at ${target}; source hashes record the working-tree inputs.`,
);

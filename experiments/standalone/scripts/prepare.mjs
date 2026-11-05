import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	analyze,
	format,
	loadExtendsChain,
	resolveEffectiveFrontmatter,
	wrapPresetSource,
} from "../../../packages/core/dist/index.js";
import { exportDot } from "../../../packages/graphviz-exporter/dist/index.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workspace = process.argv[2];
if (!workspace || !path.isAbsolute(workspace) || fs.existsSync(workspace))
	throw new Error("Pass a new absolute directory for disposable sample copies");
fs.mkdirSync(workspace, { recursive: true });
for (const directory of ["docs/samples", ".pfdsl"])
	fs.cpSync(path.join(root, directory), path.join(workspace, directory), {
		recursive: true,
	});
fs.mkdirSync(path.join(workspace, "exports"));
const paths = fs
	.readdirSync(path.join(root, "docs/samples"))
	.filter((name) => name.endsWith(".pfdsl"))
	.sort()
	.map((name) => `docs/samples/${name}`);
paths.push(
	...["roadmap", "pipeline", "workflow"].map((name) => `.pfdsl/${name}.pfdsl`),
);
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: root,
	encoding: "utf8",
}).trim();
const cases = paths.map((file) => {
	const source = fs.readFileSync(path.join(root, file), "utf8");
	const result = analyze(source);
	const entry = `/${file}`;
	const loader = (virtual) => {
		if (virtual === entry) return result;
		try {
			return analyze(
				wrapPresetSource(
					virtual,
					fs.readFileSync(path.join(root, virtual.slice(1)), "utf8"),
				),
			);
		} catch {
			return null;
		}
	};
	const fm = resolveEffectiveFrontmatter(entry, result.frontmatter, loader);
	return {
		path: file,
		source,
		dot: exportDot(result.graph, fm),
		formatted: format(source).output,
		diagnostics: [
			...result.diagnostics,
			...loadExtendsChain(entry, loader).diagnostics,
		].map((d) => [d.code, d.severity, d.message]),
	};
});
const generated = fileURLToPath(new URL("../generated", import.meta.url));
fs.mkdirSync(generated, { recursive: true });
fs.writeFileSync(
	path.join(generated, "baseline.json"),
	JSON.stringify({ sourceCommit, cases }),
);
console.log(
	JSON.stringify({ workspace, sourceCommit, documents: cases.length }),
);

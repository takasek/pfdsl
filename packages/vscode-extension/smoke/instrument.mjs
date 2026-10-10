import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const runtimePath = fileURLToPath(
	new URL("./trace-runtime.cjs", import.meta.url),
);
export function instrumentSource(source, file) {
	const sites = [];
	const contents = source.replace(
		/vscode\.window\.showTextDocument\s*\(/g,
		(_match, offset) => {
			const site = `${file}:${source.slice(0, offset).split("\n").length}`;
			sites.push(site);
			return `pfdslSmokeShowTextDocument(${JSON.stringify(site)}, `;
		},
	);
	return {
		sites,
		contents: sites.length
			? `import { traceShowTextDocument as pfdslSmokeShowTextDocument } from ${JSON.stringify(runtimePath)};\n${contents}`
			: contents,
	};
}

export async function buildDiagnosticExtension(repoRoot, runDir) {
	const sourceRoot = join(repoRoot, "packages/vscode-extension");
	const destination = join(runDir, "diagnostic-extension");
	await cp(sourceRoot, destination, {
		recursive: true,
		filter: (name) => !name.includes("/node_modules"),
	});
	const sites = [];
	await build({
		entryPoints: [join(sourceRoot, "src/extension.ts")],
		bundle: true,
		outfile: join(destination, "dist/extension.cjs"),
		platform: "node",
		format: "cjs",
		target: "node18",
		sourcemap: true,
		external: ["vscode"],
		plugins: [
			{
				name: "smoke-source-open-trace",
				setup(builder) {
					builder.onLoad({ filter: /\.ts$/ }, async (args) => {
						if (!args.path.startsWith(`${sourceRoot}/src/`)) return null;
						const transformed = instrumentSource(
							await readFile(args.path, "utf8"),
							relative(sourceRoot, args.path),
						);
						sites.push(...transformed.sites);
						return {
							contents: transformed.contents,
							loader: "ts",
							resolveDir: dirname(args.path),
						};
					});
				},
			},
		],
	});
	await mkdir(join(runDir, "trace"), { recursive: true });
	await writeFile(
		join(runDir, "trace/show-sites.json"),
		JSON.stringify(sites.sort(), null, 2),
	);
	return destination;
}

import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	run,
	runCheck,
	runCheckLinks,
	runGet,
	runGraphDescribe,
	runRender,
} from "./index.js";

let directory: string;
let file: string;
let contextFile: string;
let basis: string;
let main: string;
let develop: string;
const source = `---
type: roadmap
basePath: ..
baseRef: { source: repository, revision: main }
artifact:
  input: { location: docs/plan.md, status: done }
  output:
    status: todo
    location: docs/plan.md
    ref: { source: repository, revision: develop }
process:
  work: { location: scripts/review.mjs, command: review }
---
input >> work -> output
`;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "pfdsl-reference-context-"));
	file = join(directory, "extracted.pfdsl");
	contextFile = join(directory, "context.json");
	basis = join(directory, "basis");
	main = join(directory, "main");
	develop = join(directory, "develop");
	for (const root of [basis, main, develop]) {
		mkdirSync(join(root, "docs"), { recursive: true });
		mkdirSync(join(root, ".pfdsl"));
		mkdirSync(join(root, "scripts"));
	}
	writeFileSync(join(main, "docs/plan.md"), "main contents");
	writeFileSync(join(develop, "docs/plan.md"), "develop contents");
	writeFileSync(join(basis, "scripts/review.mjs"), "// model basis");
	writeFileSync(file, source);
	writeFileSync(
		contextFile,
		JSON.stringify({
			adapter: "fixture:git-snapshot-v1",
			model: {
				source: "wiki",
				fixedRevision: "W",
				documentId: "roadmap.pfdsl",
				extractionId: "whole-file",
			},
			logicalPath: ".pfdsl/roadmap.pfdsl",
			basis: { source: "repository", fixedRevision: "C0", root: basis },
			targets: [
				{
					source: "repository",
					revision: "main",
					fixedRevision: "C1",
					root: main,
				},
				{
					source: "repository",
					revision: "develop",
					fixedRevision: "C2",
					root: develop,
				},
			],
		}),
	);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("fixed reference context", () => {
	it("rejects scalar writes to the structured artifact ref before changing the file", async () => {
		const before = readFileSync(file, "utf8");
		const result = await run(["meta", "set", file, "output", "ref", "main"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("not a scalar field");
		expect(readFileSync(file, "utf8")).toBe(before);
	});
	it("does not resolve explicit targets against a same-name local file", () => {
		mkdirSync(join(directory, "docs"));
		writeFileSync(join(directory, "docs/plan.md"), "not target evidence");
		const result = runGet(file, { id: "input", field: "location", json: true });
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("unsupported");
		expect(result.stdout).not.toContain(join(directory, "docs/plan.md"));
	});

	it("resolves model default, whole artifact override and process basis independently", () => {
		const result = runGet(file, {
			id: "input,output,work",
			json: true,
			referenceContext: contextFile,
		});
		expect(result.exitCode).toBe(0);
		const { values } = JSON.parse(result.stdout);
		expect(values.input["location.resolved"]).toBe(join(main, "docs/plan.md"));
		expect(values.output["location.resolved"]).toBe(
			join(develop, "docs/plan.md"),
		);
		expect(values.work["location.resolved"]).toBe(
			join(basis, "scripts/review.mjs"),
		);
		expect(values.work["command.cwd"]).toBe(basis);
	});

	it("records model origin, selected revisions, paths and individual check results", () => {
		const result = runCheckLinks(file, {
			json: true,
			referenceContext: contextFile,
		});
		expect(result.exitCode).toBe(0);
		const report = JSON.parse(result.stdout);
		expect(report.referenceResolution.model).toMatchObject({
			source: "wiki",
			fixedRevision: "W",
			documentId: "roadmap.pfdsl",
			extractionId: "whole-file",
		});
		expect(report.referenceResolution.logicalPath).toBe(".pfdsl/roadmap.pfdsl");
		expect(report.referenceResolution.results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "input",
					fixedRevision: "C1",
					result: "exists",
				}),
				expect.objectContaining({
					id: "output",
					fixedRevision: "C2",
					result: "exists",
				}),
				expect.objectContaining({
					id: "work",
					fixedRevision: "C0",
					result: "exists",
				}),
			]),
		);
	});

	it("distinguishes unavailable targets from missing paths and excludes skipped URLs/globs from acceptance", () => {
		writeFileSync(
			file,
			source.replace(
				"location: docs/plan.md, status",
				"location: [docs/missing.md, 'https://example.com/a', 'docs/*.md'], status",
			),
		);
		const result = runCheckLinks(file, {
			json: true,
			referenceContext: contextFile,
		});
		expect(result.exitCode).toBe(1);
		const report = JSON.parse(result.stdout);
		expect(report.referenceResolution.results).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "input", reason: "target-missing" }),
				expect.objectContaining({ id: "input", result: "skipped-url" }),
				expect.objectContaining({ id: "input", result: "skipped-glob" }),
			]),
		);
	});

	it("rejects symlink targets outside the selected collection", () => {
		rmSync(join(main, "docs/plan.md"));
		writeFileSync(join(directory, "outside.md"), "outside");
		symlinkSync(join(directory, "outside.md"), join(main, "docs/plan.md"));
		const result = runCheckLinks(file, {
			json: true,
			referenceContext: contextFile,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("path-outside-root");
	});

	it("supports context on graph describe and the actual command line", async () => {
		const described = runGraphDescribe(file, "output", {
			json: true,
			referenceContext: contextFile,
		});
		expect(JSON.parse(described.stdout).meta["location.resolved"]).toBe(
			join(develop, "docs/plan.md"),
		);
		const checked = await run([
			"meta",
			"check-links",
			file,
			"--json",
			"--reference-context",
			contextFile,
		]);
		expect(checked.exitCode).toBe(0);
		expect(JSON.parse(checked.stdout).referenceResolution.adapter).toBe(
			"fixture:git-snapshot-v1",
		);
	});

	it("rejects an escaping symlink in a glob's complete directory prefix", () => {
		const outside = join(directory, "outside");
		mkdirSync(outside);
		symlinkSync(outside, join(main, "escape"));
		writeFileSync(
			file,
			source.replace(
				"location: docs/plan.md, status",
				"location: 'escape/*.md', status",
			),
		);
		const result = runCheckLinks(file, {
			json: true,
			referenceContext: contextFile,
		});
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("path-outside-root");
	});

	it("reports unchecked references in dependency documents", () => {
		const child = join(directory, "child.pfdsl");
		writeFileSync(child, source);
		writeFileSync(
			file,
			"---\nprocess:\n  work: { subflow: child.pfdsl }\n---\ninput >> work -> output\n",
		);
		const result = runCheck(file, { json: true });
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout).referenceResolution).toBe("not-checked");
	});

	it("uses the normalized logical path for model dependencies", async () => {
		const context = JSON.parse(readFileSync(contextFile, "utf8"));
		context.logicalPath = ".pfdsl\\roadmap.pfdsl";
		writeFileSync(contextFile, JSON.stringify(context));
		writeFileSync(
			file,
			source.replace("type: roadmap", "type: roadmap\nextends: theme.yaml"),
		);
		writeFileSync(
			join(basis, ".pfdsl/theme.yaml"),
			"statusStyles:\n  done: { fillcolor: '#123456' }\n",
		);
		expect(runCheck(file, { referenceContext: contextFile }).exitCode).toBe(0);
		const rendered = await runRender(file, { referenceContext: contextFile });
		expect(rendered.exitCode).toBe(0);
		expect(rendered.stdout).toContain("#123456");
	});

	it("verifies and records target identity for an empty location array", () => {
		writeFileSync(
			file,
			source.replace("location: docs/plan.md, status", "location: [], status"),
		);
		const verified = runCheckLinks(file, {
			json: true,
			referenceContext: contextFile,
		});
		expect(
			JSON.parse(verified.stdout).referenceResolution.results,
		).toContainEqual(
			expect.objectContaining({
				id: "input",
				fixedRevision: "C1",
				result: "target-resolved",
			}),
		);
		rmSync(main, { recursive: true });
		const missing = runCheckLinks(file, {
			json: true,
			referenceContext: contextFile,
		});
		expect(missing.exitCode).toBe(1);
		expect(missing.stdout).toContain("target-missing");
	});

	it("checks stdin dependencies using the supplied model context", async () => {
		const input = source.replace(
			"type: roadmap",
			"type: roadmap\nextends: theme.yaml",
		);
		for (const command of ["check", "render"]) {
			const missing = await run(
				[command, "-", "--reference-context", contextFile],
				{ readStdin: () => input },
			);
			expect(missing.exitCode, command).toBe(1);
			expect(missing.stderr).toContain("target-missing");
		}
		writeFileSync(
			join(basis, ".pfdsl/theme.yaml"),
			"statusStyles:\n  done: { fillcolor: '#123456' }\n",
		);
		for (const command of ["check", "render"]) {
			const present = await run(
				[command, "-", "--reference-context", contextFile],
				{ readStdin: () => input },
			);
			expect(present.exitCode, command).toBe(0);
			if (command === "render") expect(present.stdout).toContain("#123456");
		}
	});

	it("uses the model basis for extends and reports static-only checks", async () => {
		writeFileSync(
			file,
			source.replace("type: roadmap", "type: roadmap\nextends: ./theme.yaml"),
		);
		writeFileSync(
			join(basis, ".pfdsl/theme.yaml"),
			"statusStyles:\n  done: { fillcolor: '#123456' }\n",
		);
		const checked = runCheck(file, {
			json: true,
			referenceContext: contextFile,
		});
		expect(checked.exitCode).toBe(0);
		expect(JSON.parse(checked.stdout).referenceResolution).toBe("not-checked");
		const rendered = await runRender(file, { referenceContext: contextFile });
		expect(rendered.exitCode).toBe(0);
		expect(rendered.stdout).toContain("#123456");
		expect(rendered.stderr).toContain("not checked");
		expect(rendered.stdout).not.toContain("file://");
	});
});

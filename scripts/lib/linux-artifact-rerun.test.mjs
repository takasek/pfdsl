import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";

function workflow(name) {
	return YAML.parse(
		readFileSync(
			new URL(`../../.github/workflows/${name}.yml`, import.meta.url),
			"utf8",
		),
	);
}

for (const [name, job] of [
	["desktop", "linux-native"],
	["linux-inspector", "fixed-source-inspector"],
]) {
	test(`${name} preserves uploaded artifacts across producer attempts`, () => {
		const uploads = workflow(name).jobs[job].steps.filter((step) =>
			step.uses?.startsWith("actions/upload-artifact@"),
		);
		assert.ok(uploads.length > 0);
		const artifactNames = new Set();
		for (const attempt of [1, 2]) {
			for (const upload of uploads) {
				assert.notEqual(upload.with.overwrite, true);
				const artifactName = upload.with.name.replace(
					/\$\{\{\s*github\.run_attempt\s*\}\}/g,
					String(attempt),
				);
				assert.equal(artifactNames.has(artifactName), false, artifactName);
				artifactNames.add(artifactName);
			}
		}
	});
}

test("runtime downloads the successful producer's AppImage ID, including runtime-only reruns", () => {
	const jobs = workflow("desktop").jobs;
	const runtime = jobs["linux-appimage-runtime"];
	assert.equal(runtime.needs, "linux-native");
	const download = runtime.steps.find((step) =>
		step.uses?.startsWith("actions/download-artifact@"),
	);
	assert.equal(download.with.name, undefined);
	const outputKey = download.with["artifact-ids"].match(
		/^\$\{\{ needs\.linux-native\.outputs\.([\w-]+) \}\}$/,
	)?.[1];
	assert.ok(
		outputKey,
		"consumer must select the producer output, not its own attempt",
	);
	const stepId = jobs["linux-native"].outputs[outputKey].match(
		/^\$\{\{ steps\.([\w-]+)\.outputs\.artifact-id \}\}$/,
	)?.[1];
	assert.ok(stepId);
	const producer = jobs["linux-native"].steps.find(
		(step) => step.id === stepId,
	);
	assert.match(producer.uses, /^actions\/upload-artifact@/);
	assert.match(producer.with.path, /pfdsl-linux-appimage-x64\.tar\.gz$/);
});

test("runtime rejects an empty producer ID before download can select all artifacts", () => {
	const steps = workflow("desktop").jobs["linux-appimage-runtime"].steps;
	const downloadIndex = steps.findIndex((step) =>
		step.uses?.startsWith("actions/download-artifact@"),
	);
	const guard = steps
		.slice(0, downloadIndex)
		.find((step) => step.env?.APPIMAGE_ARTIFACT_ID);
	assert.ok(guard, "missing producer-ID preflight");
	assert.equal(
		guard.env.APPIMAGE_ARTIFACT_ID,
		steps[downloadIndex].with["artifact-ids"],
	);
	for (const id of ["", "11461844652"]) {
		const result = spawnSync("bash", ["-e", "-c", guard.run], {
			env: { ...process.env, APPIMAGE_ARTIFACT_ID: id },
			encoding: "utf8",
		});
		assert.equal(result.status === 0, id !== "", result.stderr);
	}
});

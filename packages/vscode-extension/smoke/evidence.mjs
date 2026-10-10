import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectEventually } from "./harness.mjs";

export async function captureExtensionTrace(runDir, request) {
	const directory = join(runDir, "trace");
	await writeFile(join(directory, "capture.request"), request);
	return expectEventually(
		"extension diagnostic capture",
		async () => {
			try {
				return JSON.parse(
					await readFile(join(directory, "capture.json"), "utf8"),
				);
			} catch {
				return null;
			}
		},
		(result) => result?.request === request,
		{ timeoutMs: 1_000 },
	);
}

export async function preserveSmokeEvidence(runDir, destination) {
	const directory =
		destination ||
		(await mkdtemp(join(tmpdir(), "pfdsl-vscode-smoke-evidence-")));
	await mkdir(directory, { recursive: true });
	for (const entry of await readdir(runDir, { withFileTypes: true })) {
		if (entry.isFile())
			await cp(join(runDir, entry.name), join(directory, entry.name));
	}
	for (const name of ["profile/logs", "trace"]) {
		try {
			await access(join(runDir, name));
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		await cp(join(runDir, name), join(directory, name), { recursive: true });
	}
	return directory;
}

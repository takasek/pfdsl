import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function hasCompletedSave(records, uri) {
	const saved = records.findLast(
		(record) => record.event === "document-save" && record.details.uri === uri,
	)?.details;
	const latest = records.at(-1);
	const document = [latest?.active, ...(latest?.visible ?? [])]
		.map((editor) => editor?.doc)
		.find((doc) => doc?.uri === uri);
	const tab = latest?.groups
		?.flatMap((group) => group.tabs)
		.find((candidate) => candidate.uri === uri);
	return Boolean(
		saved &&
			!saved.dirty &&
			!saved.closed &&
			document &&
			!document.dirty &&
			!document.closed &&
			saved.version === document.version &&
			tab &&
			!tab.dirty,
	);
}

export async function waitForSavedSource(session, wait, timeoutMs) {
	const path = process.env.PFDSL_DIAG_LOG;
	if (!path)
		throw new Error("The save-completion experiment requires API evidence");
	const uri = pathToFileURL(session.fixturePath).toString();
	await wait(
		"API confirms the current source document was saved before Close",
		async () => {
			const text = await readFile(path, "utf8");
			// Ignore only an incomplete final append; never infer success from it.
			const lines = text
				.slice(0, text.lastIndexOf("\n"))
				.split("\n")
				.filter(Boolean);
			return hasCompletedSave(
				lines.map((line) => JSON.parse(line)),
				uri,
			);
		},
		(saved) => saved,
		{ timeoutMs },
	);
}

import { mountPreview } from "@pfdsl/editor/preview";
import { renderDotToSvg } from "@pfdsl/preview-engine/renderer";
import type { invoke as nativeInvoke } from "@tauri-apps/api/core";
import { formatSnapshot, processSnapshot } from "./processing.js";

interface Expected {
	model: string;
	frontmatter: string;
	presetDiagnostics: string;
	message: string;
	formatOutput: string | null;
	svg: string | null;
}
interface Entry {
	file: string;
	path: string;
	source: string;
	sha256: string;
	expected: Expected;
}
interface Baseline {
	reference: string;
	build: {
		frontend: unknown;
		nativeExecutable: { path: string; sha256: string };
	};
	entries: Entry[];
}
const json = (value: unknown) =>
	JSON.stringify(value, (_key, value) =>
		value instanceof Map ? [...value] : value,
	);

/** Explicit native acceptance mode exercises the release frontend and native reads against the VS Code baseline. */
export async function verifyNativeCorpus(options: {
	document: Document;
	invoke: typeof nativeInvoke;
	signal: AbortSignal;
}) {
	const document = options.document;
	const window = document.defaultView!;
	const signal = options.signal;
	const invoke = async <T>(
		command: string,
		args?: Parameters<typeof nativeInvoke>[1],
	): Promise<T> => {
		signal.throwIfAborted();
		const result = await options.invoke<T>(command, args);
		signal.throwIfAborted();
		return result;
	};
	const text = await invoke<string | null>("acceptance_baseline");
	if (text === null) return null;
	const baseline: Baseline = JSON.parse(text);
	const failures: string[] = [];
	const errors: string[] = [];
	const [path, sha256] = await invoke<[string, string]>(
		"acceptance_executable",
	);
	const execution = { path, sha256 };
	if (sha256 !== baseline.build.nativeExecutable.sha256)
		failures.push("Executing native binary does not match the prepared build");
	const onError = (event: ErrorEvent) => errors.push(event.message);
	window.addEventListener("error", onError);
	const container = document.createElement("div");
	container.style.cssText =
		"position:fixed;left:-2000px;width:1000px;height:700px";
	document.body.append(container);
	let rendered: string | null = null;
	const preview = mountPreview(container, {
		postMessage() {},
		renderDot: async (dot) => {
			rendered = await renderDotToSvg(dot);
			return rendered;
		},
	});
	let cleaned = false;
	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		preview.dispose();
		container.remove();
		window.removeEventListener("error", onError);
	};
	signal?.addEventListener("abort", cleanup, { once: true });
	try {
		const results = [];
		for (const entry of baseline.entries) {
			try {
				const source = await invoke<string>("read_document", {
					path: entry.path,
				});
				const read = async (path: string) => {
					try {
						return await invoke<string>("read_document", { path });
					} catch {
						return null;
					}
				};
				const result = await processSnapshot(source, entry.path, read);
				signal?.throwIfAborted();
				rendered = null;
				await preview.receive(result.message);
				const actual: Expected = {
					model: json(result.model),
					frontmatter: json(result.frontmatter),
					presetDiagnostics: json(result.presetDiagnostics),
					message: json(result.message),
					formatOutput: formatSnapshot(source),
					svg: rendered,
				};
				const checks = Object.keys(actual).filter(
					(key) =>
						actual[key as keyof Expected] !==
						entry.expected[key as keyof Expected],
				);
				if (source !== entry.source) checks.push("source");
				if (
					result.message.type === "render" &&
					!container.querySelector("#inner > svg")
				)
					checks.push("DOM SVG");
				if (checks.length) failures.push(`${entry.file}: ${checks.join(", ")}`);
				results.push({
					file: entry.file,
					inputSha256: entry.sha256,
					passed: checks.length === 0,
					checks,
				});
			} catch (error) {
				failures.push(`${entry.file}: ${String(error)}`);
			}
		}
		cleanup();
		const report = {
			reference: baseline.reference,
			build: baseline.build,
			execution,
			userAgent: window.navigator.userAgent,
			documentCount: baseline.entries.length,
			passed: failures.length === 0 && errors.length === 0,
			results,
			failures,
			errors,
		};
		await invoke("write_acceptance_report", { report: JSON.stringify(report) });
		return baseline.entries.reduce((largest, entry) =>
			entry.source.length > largest.source.length ? entry : largest,
		);
	} finally {
		signal?.removeEventListener("abort", cleanup);
		cleanup();
	}
}

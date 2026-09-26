import {
	analyze,
	collectExtendsRefs,
	loadExtendsChain,
	resolveEffectiveFrontmatter,
	resolveRefPath,
	wrapPresetSource,
} from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter";
import { renderDotToSvg } from "@pfdsl/preview-engine";

// The POSIX browser adapter uses a virtual root. Native IO separately bounds all paths.
export async function compile(path, source, read) {
	const entry = `/${path}`;
	const result = analyze(source);
	const loaded = new Map([[entry, result]]);
	async function preload(file, document) {
		for (const ref of collectExtendsRefs(document.frontmatter ?? {})) {
			const resolved = resolveRefPath(file, ref);
			if (!resolved.ok || loaded.has(resolved.path)) continue;
			loaded.set(resolved.path, null);
			try {
				const data = await read(resolved.path.slice(1));
				const child = analyze(wrapPresetSource(resolved.path, data.text));
				loaded.set(resolved.path, child);
				await preload(resolved.path, child);
			} catch {
				/* Shared resolver below supplies missing-reference diagnostics. */
			}
		}
	}
	await preload(entry, result);
	const loader = (file) => loaded.get(file) ?? null;
	const frontmatter = resolveEffectiveFrontmatter(
		entry,
		result.frontmatter,
		loader,
	);
	const diagnostics = [
		...result.diagnostics,
		...loadExtendsChain(entry, loader).diagnostics,
	];
	const dot = exportDot(result.graph, frontmatter);
	const started = performance.now();
	const svg = await renderDotToSvg(dot);
	return {
		result,
		frontmatter,
		diagnostics,
		dot,
		svg,
		renderMs: performance.now() - started,
	};
}

export function standaloneSvg(svg) {
	const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
	const root = doc.documentElement;
	if (root.localName !== "svg" || doc.querySelector("parsererror"))
		throw new Error("Invalid SVG");
	// Export the entire graph independent of the preview pan/zoom and viewport.
	const box = root.getAttribute("viewBox")?.split(/\s+/).map(Number);
	if (
		!box ||
		box.length !== 4 ||
		!box.every(Number.isFinite) ||
		box[2] <= 0 ||
		box[3] <= 0
	)
		throw new Error("Invalid graph dimensions");
	const [width, height] = [Math.ceil(box[2]), Math.ceil(box[3])];
	root.setAttribute("width", String(width));
	root.setAttribute("height", String(height));
	return { svg: new XMLSerializer().serializeToString(root), width, height };
}

export async function pngBytes(svg, width, height) {
	if (width * height > 64_000_000 || width > 16_384 || height > 16_384)
		throw new Error("Graph exceeds the prototype PNG canvas limit");
	await document.fonts.ready;
	const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		context.fillStyle = "white";
		context.fillRect(0, 0, width, height);
		context.drawImage(image, 0, 0, width, height);
		const blob = await new Promise((resolve) =>
			canvas.toBlob(resolve, "image/png"),
		);
		if (!blob) throw new Error("PNG encoding failed");
		return Array.from(new Uint8Array(await blob.arrayBuffer()));
	} finally {
		URL.revokeObjectURL(url);
	}
}

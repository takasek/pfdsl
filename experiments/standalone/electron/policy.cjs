const path = require("node:path");
const { fileURLToPath } = require("node:url");

function trustedSender(event, contents, entryURL) {
	return (
		event.sender === contents &&
		event.senderFrame === contents.mainFrame &&
		event.senderFrame.url === entryURL
	);
}

function allowedResource(url, dist) {
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
		if (parsed.protocol !== "file:") return false;
		const relative = path.relative(dist, fileURLToPath(parsed));
		return (
			relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative)
		);
	} catch {
		return false;
	}
}

function pdfEnvelope(svg, width, height) {
	if (
		![width, height].every(
			(value) => Number.isFinite(value) && value > 0 && value <= 32768,
		)
	) {
		throw new Error(
			"PDF dimensions must be finite CSS pixels between 0 and 32768",
		);
	}
	if (typeof svg !== "string")
		throw new Error("PDF input must be an SVG document");
	// Input is the shared Graphviz renderer output. This envelope is not a general
	// XML sanitizer; the PDF window also disables JS and blocks every subresource.
	const content = svg
		.replace(/<\?xml[^?]*\?>/g, "")
		.replace(/<!DOCTYPE svg[^>]*>/g, "")
		.replace(/<!--[\s\S]*?-->/g, "")
		.trim();
	if (
		!/^<svg\b[^>]*\bxmlns=["']http:\/\/www\.w3\.org\/2000\/svg["'][^>]*>/.test(
			content,
		) ||
		!/<\/svg>$/.test(content) ||
		/<!|<\?/.test(content)
	) {
		throw new Error("PDF input must be an SVG document");
	}
	const allowed = new Set([
		"svg",
		"g",
		"a",
		"title",
		"desc",
		"text",
		"tspan",
		"path",
		"polygon",
		"polyline",
		"rect",
		"line",
		"circle",
		"ellipse",
		"defs",
		"clipPath",
		"marker",
		"linearGradient",
		"radialGradient",
		"stop",
		"pattern",
		"symbol",
		"use",
	]);
	for (const tag of content.matchAll(/<\/?([^\s/>]+)([^>]*)>/g)) {
		if (!allowed.has(tag[1]) || /\s(?:[\w-]+:)?on[\w-]*\s*=/i.test(tag[2]))
			throw new Error("Active elements are not allowed in PDF SVG");
		if (/url\s*\(/i.test(tag[2]))
			throw new Error("External resources are not allowed in PDF SVG");
		for (const href of tag[2].matchAll(
			/(?:^|\s)(?:[\w-]+:)?href\s*=\s*(["'])(.*?)\1/gi,
		)) {
			if (tag[1] !== "a" && !href[2].startsWith("#"))
				throw new Error("External resources are not allowed in PDF SVG");
		}
	}
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0;width:${width}px;height:${height}px;background:white;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${content}</body></html>`;
}

module.exports = { pdfEnvelope, trustedSender, allowedResource };

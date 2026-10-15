export function svgSize(svg: string) {
	const document = new DOMParser().parseFromString(svg, "image/svg+xml");
	const root = document.documentElement;
	if (
		root.localName !== "svg" ||
		root.namespaceURI !== "http://www.w3.org/2000/svg" ||
		document.querySelector("parsererror")
	)
		throw new Error("Invalid SVG document");
	const box = root
		.getAttribute("viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (
		!box ||
		box.length !== 4 ||
		!box.every(Number.isFinite) ||
		box[2]! <= 0 ||
		box[3]! <= 0 ||
		box[2]! > 32768 ||
		box[3]! > 32768
	)
		throw new Error(
			"SVG viewBox dimensions must be finite and between 0 and 32768 CSS pixels",
		);
	return { root, width: box[2]!, height: box[3]! };
}

/** Exactly one pixel per CSS unit, independent of display DPR; the background is opaque white. */
export async function svgToPng(svg: string): Promise<Uint8Array> {
	const { root, width, height } = svgSize(svg);
	const w = Math.ceil(width),
		h = Math.ceil(height);
	if (w * h > 64 * 1024 * 1024)
		throw new Error("PNG exceeds the 64 megapixel canvas limit");
	await document.fonts.ready;
	root.setAttribute("width", `${width}px`);
	root.setAttribute("height", `${height}px`);
	const url = URL.createObjectURL(
		new Blob([new XMLSerializer().serializeToString(root)], {
			type: "image/svg+xml",
		}),
	);
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Could not decode SVG for PNG"));
			image.src = url;
		});
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Canvas rendering is unavailable");
		context.fillStyle = "white";
		context.fillRect(0, 0, w, h);
		context.drawImage(image, 0, 0, width, height);
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) =>
					value ? resolve(value) : reject(new Error("Could not encode PNG")),
				"image/png",
			),
		);
		return new Uint8Array(await blob.arrayBuffer());
	} finally {
		URL.revokeObjectURL(url);
	}
}

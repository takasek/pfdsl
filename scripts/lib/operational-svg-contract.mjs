// Trusted code owns the default renderer namespace. The workflow's declarative
// defaults and fallbacks are checked against this contract in CI.
const sourceRoot = ".pfdsl";
export const OPERATIONAL_SVG = Object.freeze({
	sourceRoot,
	sourceGlob: `${sourceRoot}/**/*.pfdsl`,
});

export function operationalSvgSource(path) {
	if (
		!path.startsWith(`${OPERATIONAL_SVG.sourceRoot}/`) ||
		!path.endsWith(".svg")
	)
		return undefined;
	if (
		/[\r\n\t]/.test(path) ||
		path.split("/").some((part) => !part || part === "." || part === "..")
	)
		return undefined;
	return `${path.slice(0, -4)}.pfdsl`;
}

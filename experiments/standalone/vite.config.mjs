import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const local = (path) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
	base: "./",
	clearScreen: false,
	resolve: {
		alias: {
			"node:path": local("./node_modules/path-browserify/index.js"),
			path: local("./node_modules/path-browserify/index.js"),
			"@pfdsl/core": local("../../packages/core/dist/index.js"),
			"@pfdsl/graphviz-exporter": local(
				"../../packages/graphviz-exporter/dist/index.js",
			),
			"@pfdsl/preview-engine": local(
				"../../packages/preview-engine/dist/index.js",
			),
		},
	},
	build: {
		target: "es2022",
		rollupOptions: { external: ["puppeteer"] },
	},
});

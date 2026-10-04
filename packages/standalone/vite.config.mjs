import { createRequire } from "node:module";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);
export default defineConfig({
	base: "./",
	clearScreen: false,
	server: { port: 1420, strictPort: true, host: "127.0.0.1" },
	resolve: {
		alias: {
			"node:path": require.resolve("path-browserify"),
			path: require.resolve("path-browserify"),
		},
	},
	build: { target: "es2022", chunkSizeWarningLimit: 1000 },
});

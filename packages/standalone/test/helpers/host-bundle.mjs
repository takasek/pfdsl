import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(`${root}/packages/standalone/package.json`);
export const { build } = require("esbuild");
export const { JSDOM } = require("jsdom");
export { createTestMenu } from "./host-menu.mjs";

export const menuStub = `
class Item {
 static async new(options){return new Item(options)}
 constructor(options){Object.assign(this,options);this.children=options.items??[];this.writes=[];delete this.items;(globalThis.reviewMenuItems??=[]).push(this)}
 async setEnabled(v){this.writes.push(['enabled',v]);this.enabled=v} async setChecked(v){this.writes.push(['checked',v]);this.checked=v} async setText(v){this.writes.push(['text',v]);this.text=v}
 async setAsAppMenu(){this.appMenu=true} async setAsWindowsMenuForNSApp(){} async setAsHelpMenuForNSApp(){}
 async items(){return this.children} async append(i){this.children.push(i)} async remove(i){this.children=this.children.filter(x=>x!==i)} async close(){this.closed=true}
}
export const Menu=Item,MenuItem=Item,CheckMenuItem=Item,Submenu=Item,PredefinedMenuItem=Item;
`;

/** Bundle the public application entry. Each mount receives its own dependencies. */
export async function bundleHost(outfile, { realDocumentTabs = false } = {}) {
	await build({
		entryPoints: [`${root}/packages/standalone/test/helpers/host-entry.mjs`],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		packages: "external",
		plugins: [
			{
				name: "editor-boundary",
				setup(builder) {
					builder.onResolve({ filter: /src\/document-tab\.ts$/ }, () => ({
						path: `${root}/packages/standalone/test/helpers/${realDocumentTabs ? "host-real-tab" : "host-fake-tab"}.mjs`,
					}));
					builder.onResolve({ filter: /^monaco-editor\// }, () => ({
						path: `${root}/packages/standalone/test/helpers/lifecycle-monaco.mjs`,
						external: true,
					}));
					builder.onResolve({ filter: /lifecycle-monaco\.mjs$/ }, () => ({
						path: `${root}/packages/standalone/test/helpers/lifecycle-monaco.mjs`,
						external: true,
					}));
				},
			},
		],
	});
}

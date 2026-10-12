import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(`${root}/packages/standalone/package.json`);
export const { build } = require("esbuild");
export const { JSDOM } = require("jsdom");

const tabStub = `
export function createDocumentTab(options){
 // reviewNormalize stands in for Monaco's line-ending normalization when a test sets it.
 const normalize=(text)=>globalThis.reviewNormalize?globalThis.reviewNormalize(text):text;
 let source=normalize(options.source),revision=0;
 const hook=(...args)=>globalThis.reviewTabHook?.(...args);
 const container=document.createElement('div'),button=document.createElement('button');
 options.parent.append(container);button.textContent=options.name;
 const tab={container,button,location:options.path,setSourceCalls:0,
  activate(){},
  dispose(){container.remove();button.remove();hook('dispose',tab);},
  getSource:()=>source,getRevision:()=>revision,
  type(s){source=s;revision++;hook('type',tab,s);options.onChange?.();},
  setSource(s){this.setSourceCalls++;source=normalize(s);revision++;hook('setSource',tab,s);options.onChange?.();},
  setLocation(path,name,read){this.location=path;this.read=read;button.textContent=name;},
  markSaved(){},format(){}};
 (globalThis.reviewTabs??=[]).push(tab);
 return tab;
}`;

/**
 * Bundles the production main.ts with the Tauri, editor and tab seams replaced.
 * The bundle also publishes `opened`, `active` and `busy` through
 * globalThis.reviewEntries / reviewActive / reviewBusy.
 */
export async function bundleHost(outfile) {
	await build({
		stdin: {
			contents:
				readFileSync(`${root}/packages/standalone/src/main.ts`, "utf8") +
				"\nglobalThis.reviewEntries=opened;globalThis.reviewActive=()=>active;globalThis.reviewBusy=()=>busy;",
			resolveDir: `${root}/packages/standalone/src`,
			sourcefile: "main.ts",
			loader: "ts",
		},
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		plugins: [
			{
				name: "review-seams",
				setup(b) {
					b.onResolve(
						{
							filter:
								/^(?:@tauri-apps\/api\/|@pfdsl\/editor$|monaco-editor\/|\.\/document-tab\.js$|\.\/acceptance\.js$|\.\/style\.css$)/,
						},
						(args) => ({ path: args.path, namespace: "review-seams" }),
					);
					b.onLoad({ filter: /.*/, namespace: "review-seams" }, (args) => ({
						contents:
							args.path === "@tauri-apps/api/core"
								? "export const invoke=(...args)=>globalThis.nativeInvoke(...args);"
								: args.path === "@tauri-apps/api/event"
									? "export const listen=(...args)=>globalThis.nativeListen(...args);"
									: args.path === "@tauri-apps/api/window"
										? "export const getCurrentWindow=()=>({onCloseRequested(){},destroy(){}});"
										: args.path === "@pfdsl/editor"
											? 'export const previewStyles="";'
											: args.path === "./acceptance.js"
												? "export const verifyNativeCorpus=()=>globalThis.nativeAcceptance();"
												: args.path === "./style.css"
													? ""
													: args.path === "./document-tab.js"
														? tabStub
														: "export default class Worker {}",
						loader: "js",
					}));
				},
			},
		],
	});
}

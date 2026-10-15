import * as monaco from "monaco-editor/editor/editor.api.js";
// Load contributions and their services before any language API initializes Monaco's service collection.
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js";
import "monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands.js";
import "monaco-editor/editor/contrib/gotoSymbol/browser/peek/referencesController.js";
import "monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution.js";
import "monaco-editor/editor/contrib/links/browser/links.js";
import { language as yaml } from "monaco-editor/languages/definitions/yaml/yaml.js";
import configuration from "../../vscode-extension/language-configuration.json";

// Application-wide registration: closing one tab must not remove another's rules.
monaco.languages.register({ id: "pfdsl", extensions: [".pfdsl"] });
monaco.languages.register({ id: "yaml" });
monaco.languages.setMonarchTokensProvider("yaml", yaml);
monaco.languages.setMonarchTokensProvider("pfdsl", {
	unicode: true,
	includeLF: true,
	defaultToken: "",
	tokenizer: {
		root: [
			[
				/^---\s*$/,
				{ token: "metatag", next: "@frontmatter", nextEmbedded: "yaml" },
			],
			[/./, { token: "@rematch", next: "@body" }],
			[/$/, { token: "", next: "@body" }],
		],
		frontmatter: [
			[/^---\s*$/, { token: "metatag", next: "@body", nextEmbedded: "@pop" }],
		],
		body: [
			[/#[^\n]*/, "comment"],
			[/>>\?|>>|->/, "keyword.operator"],
			[/[[\]]/, "delimiter.bracket"],
			[/[,;]/, "delimiter"],
			[/"/, "string", "@quoted"],
			[/[\p{L}\p{N}_](?:[\p{L}\p{N}_]|-(?!>))*/u, "variable"],
		],
		quoted: [
			[/\n/, "", "@pop"],
			[/\\./, "string.escape"],
			[/"/, "string", "@pop"],
			[/[^"\\\n]+/, "string"],
			[/\\/, "string.escape"],
		],
	},
});
monaco.languages.setLanguageConfiguration("pfdsl", {
	wordPattern: new RegExp(
		configuration.wordPattern.pattern,
		configuration.wordPattern.flags,
	),
	comments: configuration.comments,
	brackets: configuration.brackets as [string, string][],
	autoClosingPairs: configuration.autoClosingPairs,
	surroundingPairs: (configuration.surroundingPairs as [string, string][]).map(
		([open, close]) => ({ open, close }),
	),
});

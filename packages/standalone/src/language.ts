import * as monaco from "monaco-editor/editor/editor.api.js";
import configuration from "../../vscode-extension/language-configuration.json";

// Application-wide registration: closing one tab must not remove another's rules.
monaco.languages.register({ id: "pfdsl", extensions: [".pfdsl"] });
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

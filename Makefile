.PHONY: vscode-build vscode-dev vscode-watch

vscode-build:
	pnpm --filter @pfdsl/vscode-extension build

vscode-dev: vscode-build
	code packages/vscode-extension

vscode-watch:
	pnpm --filter @pfdsl/vscode-extension watch

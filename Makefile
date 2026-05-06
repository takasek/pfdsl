.PHONY: build test typecheck lint format vscode-build vscode-dev vscode-watch

build:
	pnpm -r build

test:
	pnpm -r test

typecheck:
	pnpm -r typecheck

lint:
	pnpm biome check packages/

format:
	pnpm biome check --write packages/

vscode-build:
	pnpm --filter @pfdsl/vscode-extension build

vscode-dev: vscode-build
	code packages/vscode-extension

vscode-watch:
	pnpm --filter @pfdsl/vscode-extension watch

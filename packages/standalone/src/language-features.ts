import type { Range as SourceRange } from "@pfdsl/core";
import {
	analyzeSnapshot,
	applyPreviewEdit,
	buildHoverLines,
	type DocumentReference,
	documentReferences,
	findDefinitionEditTarget,
	findFrontmatterDefinitionRange,
	findNodeOccurrenceRanges,
	findUndefinedNodeKind,
	nextNodeOccurrenceRange,
	nodeOccurrenceAtSourcePosition,
	runHintsFromAnalysis,
} from "@pfdsl/editor";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "./language.js";
import { registerMetadataSort } from "./metadata-sort.js";

function range(value: SourceRange) {
	return new monaco.Range(
		value.start.line,
		value.start.column,
		value.end.line,
		value.end.column,
	);
}

/** Each provider accepts only its owning model; its actions and registration share the tab lifetime. */
export function registerLanguageFeatures(
	editor: monaco.editor.IStandaloneCodeEditor,
	reportStatus: (message: string) => void,
	navigation?:
		| {
				open(
					reference: Pick<DocumentReference, "field" | "value">,
				): Promise<void>;
				run(command: string): Promise<void>;
		  }
		| undefined,
) {
	let disposed = false;
	let cached: ReturnType<typeof analyzeSnapshot> | undefined;
	const model = editor.getModel()!;
	const metadataSort = registerMetadataSort(editor, reportStatus);
	const owned = (target: monaco.editor.ITextModel) =>
		!disposed && target === model;
	function snapshot() {
		const source = model.getValue();
		if (!cached || cached.source !== source) cached = analyzeSnapshot(source);
		return cached;
	}
	function occurrence(position: monaco.IPosition) {
		const current = snapshot();
		return nodeOccurrenceAtSourcePosition(current, current.source, {
			line: position.lineNumber - 1,
			character: position.column - 1,
		});
	}
	function select(value: SourceRange | undefined) {
		if (!value || disposed) return;
		editor.setSelection(range(value));
		editor.revealRangeInCenter(range(value));
		editor.focus();
	}
	function nodeAtCursor() {
		const position = editor.getPosition();
		return position ? occurrence(position)?.nodeId : undefined;
	}
	function definition(id = nodeAtCursor()) {
		if (id === undefined) return;
		const value = findFrontmatterDefinitionRange(snapshot(), id);
		if (value) select(value);
		else reportStatus(`No frontmatter definition found for "${id}"`);
	}
	function cycle(direction: 1 | -1) {
		const position = editor.getPosition();
		if (!position) return;
		select(
			nextNodeOccurrenceRange(
				snapshot(),
				model.getValue(),
				{ line: position.lineNumber - 1, character: position.column - 1 },
				direction,
			),
		);
	}
	function findAll(id = nodeAtCursor()) {
		if (id === undefined || disposed) return;
		// Monaco seeds an empty Find from the selection before applying arguments.
		// A YAML definition selection includes its quotes; seed the semantic ID first.
		editor
			.getContribution<
				monaco.editor.IEditorContribution & {
					setSearchString(value: string): void;
				}
			>("editor.contrib.findController")
			?.setSearchString(id);
		return editor
			.getAction("editor.actions.findWithArgs")
			?.run({ searchString: id, isRegex: false });
	}
	function finishDefinition(id: string) {
		if (disposed) return;
		const current = snapshot();
		const kind = current.nodeKinds.get(id);
		if (kind !== "artifact" && kind !== "process") return;
		const target = findDefinitionEditTarget(current, kind, id);
		if (!target) return;
		select(target.labelRange);
		reportStatus(
			target.needsCriteria
				? `Edit the label for ${kind} "${id}". Add criteria describing how this produced artifact is judged complete (W002).`
				: `Edit the label for ${kind} "${id}".`,
		);
	}
	function insertion(id: string) {
		const source = model.getValue();
		return applyPreviewEdit(source, {
			type: "createDefinition",
			nodeId: id,
			source,
		});
	}
	function insert() {
		const id = nodeAtCursor();
		if (id === undefined || disposed) return;
		const result = insertion(id);
		if (!result.ok) {
			reportStatus(result.message);
			return;
		}
		editor.pushUndoStop();
		editor.executeEdits("pfdsl.definition", [
			{
				range: monaco.Range.fromPositions(
					model.getPositionAt(result.edit.startOffset),
					model.getPositionAt(result.edit.endOffset),
				),
				text: result.edit.text,
			},
		]);
		editor.pushUndoStop();
		finishDefinition(id);
	}
	const action = (
		id: string,
		label: string,
		run: () => void | Promise<void>,
		order: number,
	) =>
		editor.addAction({
			id,
			label,
			contextMenuGroupId: "pfdsl",
			contextMenuOrder: order,
			run,
		});
	const registrations: monaco.IDisposable[] = [
		action(
			"pfdsl.jumpToDefinition",
			"Go to PFDSL definition",
			() => definition(),
			1,
		),
		action(
			"pfdsl.nextNodeOccurrence",
			"Next PFDSL node occurrence",
			() => cycle(1),
			2,
		),
		action(
			"pfdsl.previousNodeOccurrence",
			"Previous PFDSL node occurrence",
			() => cycle(-1),
			3,
		),
		action(
			"pfdsl.findAll",
			"Find all text matching this node",
			() => findAll(),
			4,
		),
		action("pfdsl.insertDefinition", "Insert PFDSL definition", insert, 5),
	];
	const gotoId = `${editor.getId()}:pfdsl.hoverDefinition`;
	const findId = `${editor.getId()}:pfdsl.hoverFindAll`;
	const finishId = `${editor.getId()}:pfdsl.finishDefinition`;
	const openId = `${editor.getId()}:pfdsl.openReference`;
	const runId = `${editor.getId()}:pfdsl.runCommand`;
	registrations.push(
		editor.addAction({
			id: "pfdsl.openReference",
			label: "Open hovered reference",
			async run(
				_editor,
				version: number,
				field: "location" | "subflow",
				value: string,
			) {
				if (
					disposed ||
					model.getVersionId() !== version ||
					!documentReferences(snapshot()).some(
						(ref) => ref.field === field && ref.value === value,
					)
				)
					return;
				try {
					await navigation?.open({ field, value });
				} catch (error) {
					reportStatus(String(error));
				}
			},
		}),
		editor.addAction({
			id: "pfdsl.runCommand",
			label: "Run declared process command",
			async run(_editor, version: number, command: string) {
				if (
					disposed ||
					model.getVersionId() !== version ||
					!Object.values(snapshot().frontmatter?.process ?? {}).some(
						(meta) => meta?.command === command,
					)
				)
					return;
				try {
					await navigation?.run(command);
				} catch (error) {
					reportStatus(String(error));
				}
			},
		}),
		editor.addAction({
			id: "pfdsl.hoverDefinition",
			label: "Go to hovered definition",
			run: (_editor, version: number, id: string) => {
				if (!disposed && model.getVersionId() === version) definition(id);
			},
		}),
		editor.addAction({
			id: "pfdsl.hoverFindAll",
			label: "Find hovered node",
			run: (_editor, version: number, id: string) => {
				if (!disposed && model.getVersionId() === version) findAll(id);
			},
		}),
		editor.addAction({
			id: "pfdsl.finishDefinition",
			label: "Edit inserted definition",
			run: (_editor, version: number, id: string) => {
				if (!disposed && model.getVersionId() === version + 1)
					finishDefinition(id);
			},
		}),
	);
	registrations.push(
		monaco.languages.registerHoverProvider("pfdsl", {
			provideHover(target, position) {
				if (!owned(target)) return null;
				const item = occurrence(position);
				if (!item) return null;
				const current = snapshot();
				const kind = current.nodeKinds.get(item.nodeId);
				if (!kind) return null;
				const args = encodeURIComponent(
					JSON.stringify([model.getVersionId(), item.nodeId]),
				);
				const link = (label: string, command: string, args: unknown[]) =>
					`[${label.replace(/[\\[\]]/g, "\\$&")}](command:${command}?${encodeURIComponent(JSON.stringify([model.getVersionId(), ...args]))})`;
				const lines = buildHoverLines(item.nodeId, kind, current.frontmatter);
				// Authored Markdown never shares trust with generated executable actions.
				const actions = [
					`[Go to definition](command:${gotoId}?${args})  [Find all](command:${findId}?${args})`,
				];
				if (navigation) {
					const declaration = current.sourceMap.declarations.find(
						(d) => d.section === kind && d.id === item.nodeId,
					);
					for (const ref of documentReferences(current).filter((ref) =>
						declaration?.fields
							.get(ref.field)
							?.values.some(
								(value) => value.range.start.offset === ref.range.start.offset,
							),
					))
						actions.push(
							link(`Open ${ref.field}`, openId, [ref.field, ref.value]),
						);
					const command = current.frontmatter?.process?.[item.nodeId]?.command;
					if (kind === "process" && command)
						actions.push(link("▶ Run in Terminal.app", runId, [command]));
				}
				return {
					range: range(item.range),
					contents: [
						{
							value: lines.join("  \n"),
							supportHtml: true,
							isTrusted: false,
						},
						{
							value: actions.join("  \n"),
							isTrusted: { enabledCommands: [gotoId, findId, openId, runId] },
						},
					],
				};
			},
		}),
		monaco.languages.registerDefinitionProvider("pfdsl", {
			provideDefinition(target, position) {
				if (!owned(target)) return null;
				const item = occurrence(position);
				const value =
					item && findFrontmatterDefinitionRange(snapshot(), item.nodeId);
				return value ? { uri: model.uri, range: range(value) } : null;
			},
		}),
		monaco.languages.registerReferenceProvider("pfdsl", {
			provideReferences(target, position) {
				if (!owned(target)) return [];
				const item = occurrence(position);
				return item
					? findNodeOccurrenceRanges(
							snapshot(),
							model.getValue(),
							item.nodeId,
						).map((value) => ({ uri: model.uri, range: range(value) }))
					: [];
			},
		}),
		monaco.languages.registerInlayHintsProvider("pfdsl", {
			provideInlayHints(target, requested) {
				if (!owned(target)) return { hints: [], dispose() {} };
				return {
					hints: runHintsFromAnalysis(snapshot(), model.getValue().split("\n"))
						.filter(
							(hint) =>
								hint.line + 1 >= requested.startLineNumber &&
								hint.line + 1 <= requested.endLineNumber,
						)
						.map((hint) => ({
							position: { lineNumber: hint.line + 1, column: hint.column + 1 },
							label: navigation
								? [
										{
											label: "▶ Run in Terminal.app",
											command: {
												id: runId,
												title: "Run declared process command",
												arguments: [model.getVersionId(), hint.command],
											},
										},
									]
								: "Command",
							tooltip: { value: `\`\`\`shell\n${hint.command}\n\`\`\`` },
							paddingLeft: true,
						})),
					dispose() {},
				};
			},
		}),
		monaco.languages.registerCodeActionProvider(
			"pfdsl",
			{
				provideCodeActions(target, requested) {
					if (!owned(target)) return { actions: [], dispose() {} };
					const item = occurrence({
						lineNumber: requested.startLineNumber,
						column: requested.startColumn,
					});
					if (!item) return { actions: [], dispose() {} };
					const current = snapshot();
					const kind = findUndefinedNodeKind(
						current.nodeKinds,
						current.frontmatter,
						item.nodeId,
					);
					const result = kind && insertion(item.nodeId);
					if (!result?.ok) return { actions: [], dispose() {} };
					const version = model.getVersionId();
					return {
						actions: [
							{
								title: `Insert ${kind} definition for "${item.nodeId}"`,
								kind: "quickfix",
								edit: {
									edits: [
										{
											resource: model.uri,
											versionId: version,
											textEdit: {
												range: monaco.Range.fromPositions(
													model.getPositionAt(result.edit.startOffset),
													model.getPositionAt(result.edit.endOffset),
												),
												text: result.edit.text,
											},
										},
									],
								},
								command: {
									id: finishId,
									title: "Edit inserted definition",
									arguments: [version, item.nodeId],
								},
							},
						],
						dispose() {},
					};
				},
			},
			{ providedCodeActionKinds: ["quickfix"] },
		),
	);
	return {
		dispose() {
			disposed = true;
			metadataSort.dispose();
			cached = undefined;
			for (const registration of registrations) registration.dispose();
		},
	};
}

// Guards the distributed prompts against repo-specific content — text that
// only means something to someone sitting in this repository, shipped to
// people who are not (#674, and #340 before it, which recurred through its
// own fix).
//
// Each rule below is decidable from the text. The wider class — prose whose
// *subject* is this repo's own build ("the repo root is the bundling source")
// — is semantic, and keyword detection for it was measured and rejected:
// 「リポルート」 occurs 7 times in the bundle and 6 of them correctly mean the
// *adopting* repo's root. A rule firing on those would be noise, and a check
// that is mostly noise stops being read. That subset stays with human review.
//
// Adding a rule: append to RULES. Each returns a reason for an offending line,
// or undefined.

import { fromMarkdown } from "mdast-util-from-markdown";

/**
 * Markdown syntax belongs to the parser. This predicate only identifies the
 * GitHub issue/PR named by a parsed destination, including its subpages.
 * Existence, access permissions and URL/label agreement remain human review.
 */
function isGitHubIssueUrl(destination) {
	let url;
	try {
		url = new URL(destination);
	} catch {
		return false;
	}
	const [, owner, repo, kind, number] = url.pathname.split("/");
	return (
		url.origin === "https://github.com" &&
		!url.username &&
		!url.password &&
		/^[\w.-]+$/.test(owner ?? "") &&
		/^[\w.-]+$/.test(repo ?? "") &&
		["issues", "pull"].includes(kind) &&
		/^[1-9]\d*$/.test(number)
	);
}

function walk(node, visit) {
	visit(node);
	for (const child of node.children ?? []) walk(child, visit);
}

/** Mask parsed ranges without changing UTF-16 offsets, newlines or diagnostics. */
function proseForRules(content) {
	const tree = fromMarkdown(content);
	const definitions = new Map();
	walk(tree, (node) => {
		if (node.type === "definition" && !definitions.has(node.identifier))
			definitions.set(node.identifier, node.url);
	});
	const issue = content.split("");
	const bundle = content.split("");
	const mask = (text, node) => {
		for (
			let i = node.position.start.offset;
			i < node.position.end.offset;
			i++
		) {
			if (text[i] !== "\n" && text[i] !== "\r") text[i] = " ";
		}
	};
	walk(tree, (node) => {
		if (node.type === "code") {
			mask(issue, node);
			mask(bundle, node);
		} else if (
			node.type === "inlineCode" ||
			(["link", "definition"].includes(node.type) &&
				isGitHubIssueUrl(node.url)) ||
			(node.type === "linkReference" &&
				isGitHubIssueUrl(definitions.get(node.identifier)))
		)
			mask(issue, node);
	});
	return {
		issue: issue.join("").split("\n"),
		bundle: bundle.join("").split("\n"),
	};
}

const RULES = [
	{
		name: "bundle-path",
		// The bundle loads from the plugin cache in an adopting repo, so a path
		// given only in its .claude/ form points at something that cannot exist
		// there. Naming the plugin root, or labelling the line as the repo-local
		// branch, resolves it.
		test(line) {
			if (!/\.claude\/(?:skills|agents|commands)\//.test(line))
				return undefined;
			if (["CLAUDE_PLUGIN_ROOT", "repo-local"].some((q) => line.includes(q)))
				return undefined;
			return "bundle path written only in its repo-local form";
		},
	},
	{
		name: "issue-ref",
		// An adopting repo has no #603. Unlike ADR-\d+, which architecture.md
		// resolves to the upstream repo for the reader, a bare issue number
		// resolves to whatever the reader's own tracker holds under that number.
		test(line) {
			const m = /#\d{2,}/.exec(line);
			return m
				? `bare issue reference ${m[0]} — adopters cannot resolve it`
				: undefined;
		},
	},
];

/**
 * @param {Array<{path: string, content: string}>} files
 * @returns {Array<{path: string, line: number, rule: string, reason: string, text: string}>}
 */
export function findRepoSpecificProse(files) {
	const found = [];
	for (const { path, content } of files) {
		const prose = proseForRules(content);
		content.split("\n").forEach((text, i) => {
			for (const rule of RULES) {
				const reason = rule.test(
					rule.name === "issue-ref" ? prose.issue[i] : prose.bundle[i],
				);
				if (reason)
					found.push({
						path,
						line: i + 1,
						rule: rule.name,
						reason,
						text: text.trim(),
					});
			}
		});
	}
	return found;
}

// Advisory candidates only. Vocabulary cannot establish the grammatical subject,
// normative force, or responsibility boundary of a sentence.
const EXECUTOR_VOCABULARY =
	/\b(?:commits?|PRs?|pull\s+requests?|branches|branch|worktrees?|sub-?agents?|TDD|sessions?|turns?)\b|コミット|プルリクエスト|ブランチ|ワークツリー|サブエージェント|セッション|ターン/gi;

/**
 * Report sentence-sized candidates separately from the failing distribution rules.
 * Coordinates are one-based UTF-16 columns in the original source, at the first
 * matched term. Only parsed Markdown text participates, not code or destinations.
 */
export function findExecutorVocabulary(files) {
	const found = [];
	for (const { path, content } of files) {
		const tree = fromMarkdown(content);
		walk(tree, (block) => {
			if (!["paragraph", "heading"].includes(block.type)) return;
			const start = block.position.start.offset;
			const end = block.position.end.offset;
			const prose = Array.from({ length: end - start }, () => " ");
			walk(block, (node) => {
				if (node.type !== "text") return;
				for (
					let i = node.position.start.offset;
					i < node.position.end.offset;
					i++
				) {
					prose[i - start] = content[i];
				}
			});
			// Split visible prose only: punctuation in code and link destinations
			// cannot terminate a sentence. Blank block boundaries are handled by AST.
			const visible = prose.join("");
			for (const sentence of visible.matchAll(
				/[^。！？.!?]+[。！？.!?]*|[。！？.!?]+/g,
			)) {
				const matches = [...sentence[0].matchAll(EXECUTOR_VOCABULARY)];
				if (!matches.length) continue;
				const offset = start + sentence.index + matches[0].index;
				const prefix = content.slice(0, offset);
				const line = prefix.split("\n").length;
				const column = offset - prefix.lastIndexOf("\n");
				found.push({
					path,
					line,
					column,
					terms: [...new Set(matches.map((match) => match[0]))],
					text: content
						.slice(
							start + sentence.index,
							start + sentence.index + sentence[0].length,
						)
						.trim(),
				});
			}
		});
	}
	return found;
}

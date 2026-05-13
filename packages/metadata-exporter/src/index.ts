import type { Frontmatter, Graph, NodeKind, Status } from "@pfdsl/core";

export interface MetadataRecord {
	kind: NodeKind;
	id: string;
	label: string | undefined;
	description: string | undefined;
	status: Status | undefined;
	tags: string[] | undefined;
	owner: string | undefined;
}

function str(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

function strArr(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const result = v.filter((x): x is string => typeof x === "string");
	return result.length > 0 ? result : undefined;
}

export function extractMetadata(
	graph: Graph,
	frontmatter: Frontmatter | null,
): MetadataRecord[] {
	return [...graph.nodes.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, kind]) => {
			if (kind === "artifact") {
				const meta = frontmatter?.artifact?.[id];
				return {
					kind,
					id,
					label: str(meta?.label),
					description: str(meta?.description),
					status: str(meta?.status) as Status | undefined,
					tags: strArr(meta?.tags),
					owner: str(meta?.owner),
				};
			} else {
				const meta = frontmatter?.process?.[id];
				return {
					kind,
					id,
					label: str(meta?.label),
					description: str(meta?.description),
					status: undefined,
					tags: undefined,
					owner: str(meta?.owner),
				};
			}
		});
}

const TSV_HEADER = [
	"kind",
	"id",
	"label",
	"description",
	"status",
	"tags",
	"owner",
];

function escapeTsv(s: string): string {
	return s.replace(/[\t\n\r]/g, " ");
}

export function toTsv(records: MetadataRecord[]): string {
	const rows = [TSV_HEADER.join("\t")];
	for (const r of records) {
		rows.push(
			[
				r.kind,
				r.id,
				r.label ?? "",
				r.description ?? "",
				r.status ?? "",
				r.tags?.join(",") ?? "",
				r.owner ?? "",
			]
				.map(escapeTsv)
				.join("\t"),
		);
	}
	return `${rows.join("\n")}\n`;
}

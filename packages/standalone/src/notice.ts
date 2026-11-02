/** Controller-authored text keeps its subject separate from unmodified errors. */
export interface NoticeParts {
	before: string;
	subject: string;
	after: string;
}
export type Notice = string | NoticeParts;

export function noticeText(
	notice: Notice,
	name = (subject: string) => subject,
): string {
	return typeof notice === "string"
		? notice
		: notice.before + name(notice.subject) + notice.after;
}

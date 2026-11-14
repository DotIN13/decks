// Messages sent before cards replaced boards still say "board"; reading them back takes both words.

/** A mention kind as it was saved: "board" read as "card". */
export const cardKind = <K extends string>(kind: K | "board"): K | "card" => (kind === "board" ? "card" : kind);

/** The heads a comment block was sent under, then and now. */
export const OLD_HEADS: Array<[RegExp, (match: RegExpExecArray) => number]> = [
	[/^A comment on a (?:card|board)\. The quoted words are what I selected:$/, () => 1],
	[/^(\d+) comments on (?:cards|boards)\. The quoted words are what I selected:$/, (m) => Number(m[1])],
];

/** How a comment on a whole card ended its line, then and now. */
export const WHOLE_ENDS = [", the whole card", ", the whole board"];

/**
 * Where a line typed into the bar goes.
 *
 * One bar, several possible readers, and the person should never have to guess. This
 * module is the whole of the decision, so the label shown beside the bar and the send
 * itself cannot disagree: both ask `destination` and get the same answer.
 *
 * Precedence, highest first: a note target the person picked on a board; an `@Name` in the
 * text; then the surface, which is the dispatcher on the dispatch surface and the focused
 * agent on a stage. A stage with nobody focused has nowhere to send to, and says so.
 *
 * `@Dispatcher` is a name like any other, and works from any bar: on an agent's stage it
 * turns the line into a task for the dispatcher to place, which is otherwise a trip Home.
 * It is a reserved word rather than an agent, because the dispatcher is kept out of every
 * list a person picks an agent from; an agent that really is called Dispatcher keeps its name.
 */

/** The word that addresses the dispatcher, as typed after an `@`. Matched without case. */
export const DISPATCHER_NAME = "Dispatcher";

export interface BarContext {
	surface: "dispatch" | "stage";
	focused?: { id: string; name: string };
	agents: Array<{ id: string; name: string }>;
	note?: { board: string; component: string };
}

export type Destination =
	| { kind: "note"; board: string; component: string }
	/** `named` is true when an `@` in the text chose the agent, false when the stage did. */
	| { kind: "prompt"; id: string; name: string; named: boolean }
	/** `named` is present when `@Dispatcher` in the text chose it, and the token is to be taken out. */
	| { kind: "task"; named?: true }
	| { kind: "nowhere" };

/** Characters that may appear in an agent name; a mention ends at the first one that is not. */
const NAME_CHAR = /[A-Za-z0-9_-]/;

interface Mention {
	/** Index of the `@`. */
	at: number;
	/** Index just past the name. */
	end: number;
	name: string;
}

/**
 * The first `@name` in the text that names one of `names`, case-insensitive. The `@` must
 * start the text or follow a non-name character, so an email address is not a mention.
 * At each `@` the longest name wins, so `@Ada-D` is Ada-D and not Ada followed by a hyphen.
 */
function findMention(text: string, names: readonly string[]): Mention | undefined {
	const byLength = [...names].filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
	const lower = text.toLowerCase();
	for (let at = lower.indexOf("@"); at >= 0; at = lower.indexOf("@", at + 1)) {
		if (at > 0 && NAME_CHAR.test(lower[at - 1] as string)) continue;
		for (const name of byLength) {
			const end = at + 1 + name.length;
			if (lower.slice(at + 1, end) !== name.toLowerCase()) continue;
			if (end < lower.length && NAME_CHAR.test(lower[end] as string)) continue;
			return { at, end, name };
		}
	}
	return undefined;
}

export function destination(text: string, context: BarContext): Destination {
	if (context.note) return { kind: "note", board: context.note.board, component: context.note.component };
	const mention = findMention(text, [...context.agents.map((a) => a.name), DISPATCHER_NAME]);
	if (mention) {
		const agent = context.agents.find((a) => a.name.toLowerCase() === mention.name.toLowerCase());
		if (agent) return { kind: "prompt", id: agent.id, name: agent.name, named: true };
		if (mention.name.toLowerCase() === DISPATCHER_NAME.toLowerCase()) return { kind: "task", named: true };
	}
	if (context.surface === "dispatch") return { kind: "task" };
	if (context.focused) return { kind: "prompt", id: context.focused.id, name: context.focused.name, named: false };
	return { kind: "nowhere" };
}

/** The board's own name: the last path segment without its `.html`. */
function boardName(board: string): string {
	const last = board.split("/").filter(Boolean).at(-1) ?? board;
	return last.endsWith(".html") ? last.slice(0, -".html".length) : last;
}

/** Short enough to sit beside the bar: "note on risk-model", "to Sable", "to dispatcher", "no agent". */
export function destinationLabel(dest: Destination): string {
	switch (dest.kind) {
		case "note":
			return `note on ${boardName(dest.board)}`;
		case "prompt":
			return `to ${dest.name}`;
		case "task":
			return "to dispatcher";
		case "nowhere":
			return "no agent";
	}
}

/**
 * The text without its first `@name` token. The whitespace on one side of the token goes
 * with it, so "fix @Ada this" is "fix this" and "hi @Ada, do" is "hi, do".
 */
export function stripMention(text: string, name: string): string {
	const mention = findMention(text, [name]);
	if (!mention) return text;
	const before = text.slice(0, mention.at);
	const after = text.slice(mention.end);
	let joined: string;
	if (/^\s/.test(after)) {
		joined = before + after.replace(/^\s+/, before === "" || /\s$/.test(before) ? "" : " ");
	} else {
		joined = before.replace(/\s+$/, "") + after;
	}
	return joined.replace(/[ \t]{2,}/g, " ").trim();
}

import type { AgentChat, Identity } from "@decks/protocol";
import { agentStatus, type AgentStatus } from "./agent-order.ts";

/**
 * What the panel's Agents tab lists, and which of its three sections each agent belongs to.
 *
 * Pure and tested, for the reason `panel-groups.ts` is: this is the whole of what the list
 * *knows*, and leaving it inside the component would mean the only way to ask "does a
 * dormant agent count as quiet" is to render one and look.
 *
 * ### The sections are the corner's own ranking, with headings
 *
 * `agent-order.ts` already derives `waiting` / `done` / `working` / `idle` and ranks them in
 * that order, and the corner stack draws faces in exactly that sequence. This groups the same
 * ranking rather than inventing a second one, so **the panel and the corner cannot disagree
 * about who is most urgent** — which they would within a week if each sorted for itself.
 *
 * Three headings from four statuses, and the fold is deliberate: `done` sits inside **Quiet**
 * rather than being promoted to its own section. A finished turn is not urgent, it is unread,
 * and the green ring already says so. Promoting it would put "come and read this" beside
 * "answer this now", which are not the same demand.
 *
 * ### Why the search matches tags
 *
 * "Who else is on `panel-css`" is the question tags were added to answer, and this is the one
 * surface with room to show the answer. A field that matched only names would leave it
 * unanswerable in the place it is asked.
 */

export type AgentSectionKind = "wants" | "working" | "quiet";

export interface AgentRow {
	chat: AgentChat;
	status: AgentStatus;
	unread: number;
	/** The agent's own tags, then yours. Both cleaned by the server; see `agents/tags.ts`. */
	tags: string[];
	userTags: string[];
	/** Whether this is the conversation on screen — the row is washed rather than ticked. */
	current: boolean;
}

export interface AgentSection {
	kind: AgentSectionKind;
	/** The whole label, sentence case, without the count. Never uppercase. */
	label: string;
	rows: AgentRow[];
}

export interface AgentListInput {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	unread: Record<string, number>;
	focused?: string;
	/** What is typed in the panel's search field. Matches the name and the tags. */
	query?: string;
}

const SECTIONS: { kind: AgentSectionKind; label: string; holds: AgentStatus[] }[] = [
	{ kind: "wants", label: "Wants you", holds: ["waiting"] },
	{ kind: "working", label: "Working", holds: ["working"] },
	{ kind: "quiet", label: "Quiet", holds: ["done", "idle"] },
];

/** Trimmed and folded once, so callers do not each do it differently. */
const fold = (query?: string) => (query ?? "").trim().toLowerCase();

/**
 * Does this agent match what was typed — by name, or by either kind of tag?
 *
 * Both tag lists, because the point of typing `panel-css` is to find every agent on it, and
 * an agent you tagged yourself is one of them. Substring and case-insensitive rather than
 * fuzzy, as `panel-groups.ts` matches a board: tags are slugs, so what somebody types is
 * usually a word that is really in one.
 */
export function agentMatches(row: Pick<AgentRow, "chat" | "tags" | "userTags">, needle: string): boolean {
	if (!needle) return true;
	return `${row.chat.name}\n${row.tags.join("\n")}\n${row.userTags.join("\n")}`.toLowerCase().includes(needle);
}

/**
 * The sections, in urgency order, with the empty ones left out.
 *
 * Dropped rather than drawn as "Working · 0", for the reason the boards list drops one: the
 * label is a line *inside* the list, so a zero is a sentence with nothing under it — and with
 * a search running, most of them are empty most of the time.
 *
 * Within a section the order is **most recent first**, not the corner's full tie-breaking:
 * inside one status there is nothing left to rank by except when it last did something, and
 * an agent that has never run sorts last rather than first.
 */
export function agentSections(input: AgentListInput): AgentSection[] {
	const needle = fold(input.query);
	const rows: AgentRow[] = input.chats.map((chat) => {
		const identity = input.identities[chat.id];
		const unread = input.unread[chat.id] ?? 0;
		return {
			chat,
			status: agentStatus(chat.state, unread),
			unread,
			tags: identity?.tags ?? [],
			userTags: identity?.userTags ?? [],
			current: chat.id === input.focused,
		};
	});

	const out: AgentSection[] = [];
	for (const section of SECTIONS) {
		const mine = rows
			.filter((row) => section.holds.includes(row.status) && agentMatches(row, needle))
			.sort((a, b) => (b.chat.lastAt ?? 0) - (a.chat.lastAt ?? 0));
		if (mine.length > 0) out.push({ kind: section.kind, label: section.label, rows: mine });
	}
	return out;
}

/**
 * What the sections add up to, for the foot.
 *
 * Summed from the sections rather than from the input, so the foot cannot disagree with the
 * list above it. `active` is anything not quiet — the number that answers "is this deck
 * spending money right now".
 */
export function agentTally(sections: AgentSection[]): { total: number; active: number; wants: number } {
	let total = 0;
	let active = 0;
	let wants = 0;
	for (const section of sections) {
		total += section.rows.length;
		if (section.kind !== "quiet") active += section.rows.length;
		if (section.kind === "wants") wants += section.rows.length;
	}
	return { total, active, wants };
}

/**
 * The foot's sentence: `5 agents · 3 active · 1 wants you`.
 *
 * Built here rather than in the markup so it can be asserted without a DOM, and so the two
 * conditional clauses cannot drift apart. The clauses are dropped when they are zero, because
 * "0 wants you" is a sentence about nothing.
 */
export function agentFoot(tally: { total: number; active: number; wants: number }, matching?: number): string {
	if (matching !== undefined) return `${matching} of ${tally.total} match`;
	if (tally.total === 0) return "No agents yet";
	/*
	 * The count, and nothing else.
	 *
	 * It used to read `5 agents · 3 active · 1 wants you`, which is the three section
	 * headings above it — each already carrying its own count — read out again at the bottom
	 * of the list. The boards tab's foot says how many boards there are; this says how many
	 * agents there are.
	 */
	return `${tally.total} agent${tally.total === 1 ? "" : "s"}`;
}

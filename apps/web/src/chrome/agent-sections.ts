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

export type AgentSectionKind = "wants" | "working" | "quiet" | "workspace" | "unfiled";

/**
 * How the list is cut up.
 *
 * **Attention** is what a panel of agents is for and stays the default: a list you open when
 * you want to know who needs you. **Workspace** answers the other question — who is on this
 * project — and it is a *second* answer rather than a replacement, because the two are read at
 * different times and neither is derivable from the other.
 *
 * Inside a workspace section the rows are still in urgency order, so switching axes loses the
 * headings and not the ranking.
 */
export type AgentGroup = "attention" | "workspace";

export interface AgentRow {
	chat: AgentChat;
	status: AgentStatus;
	unread: number;
	/** The agent's own tags, then yours. Both cleaned by the server; see `agents/tags.ts`. */
	tags: string[];
	userTags: string[];
	/**
	 * The workspace it is in, or `undefined` — one slug, both writers.
	 *
	 * Read off the identity rather than off `AgentChat`: it is part of what the agent says about
	 * itself, exactly as its name and its tags are (`protocol/Identity.workspace`).
	 */
	workspace?: string;
	/** Whether this is the conversation on screen — the row is washed rather than ticked. */
	current: boolean;
}

export interface AgentSection {
	kind: AgentSectionKind;
	/** The whole label, sentence case, without the count. Never uppercase. */
	label: string;
	rows: AgentRow[];
	/**
	 * Something true about the *group*, in the heading's right-hand column.
	 *
	 * Only a workspace section has one, and it exists for the case the workspace axis creates:
	 * a section you are not in can be the one that needs you, and a heading that only counted
	 * its rows would say "3" about a group with somebody waiting in it.
	 */
	note?: string;
}

export interface AgentListInput {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	unread: Record<string, number>;
	focused?: string;
	/** What is typed in the panel's search field. Matches the name, the tags and the workspace. */
	query?: string;
	/** Which axis to cut the list by. Absent is attention — see `AgentGroup`. */
	group?: AgentGroup;
}

const SECTIONS: { kind: AgentSectionKind; label: string; holds: AgentStatus[] }[] = [
	{ kind: "wants", label: "Wants you", holds: ["waiting"] },
	{ kind: "working", label: "Working", holds: ["working"] },
	{ kind: "quiet", label: "Quiet", holds: ["done", "idle"] },
];

/** Trimmed and folded once, so callers do not each do it differently. */
const fold = (query?: string) => (query ?? "").trim().toLowerCase();

/**
 * Does this agent match what was typed — by name, by either kind of tag, or by workspace?
 *
 * Both tag lists, because the point of typing `panel-css` is to find every agent on it, and
 * an agent you tagged yourself is one of them. The workspace too, and that is the one that
 * pays off most: `irb` is how you find five agents whose rows say nothing about 84069, and it
 * works in either grouping rather than only in the one that puts the name on screen.
 *
 * Substring and case-insensitive rather than fuzzy, as `panel-groups.ts` matches a board: tags
 * and workspaces are slugs, so what somebody types is usually a word that is really in one.
 */
export function agentMatches(row: Pick<AgentRow, "chat" | "tags" | "userTags" | "workspace">, needle: string): boolean {
	if (!needle) return true;
	return `${row.chat.name}\n${row.tags.join("\n")}\n${row.userTags.join("\n")}\n${row.workspace ?? ""}`.toLowerCase().includes(needle);
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
			...(identity?.workspace ? { workspace: identity.workspace } : {}),
			current: chat.id === input.focused,
		};
	});

	const matching = rows.filter((row) => agentMatches(row, needle));
	if (input.group === "workspace") return workspaceSections(matching);

	const out: AgentSection[] = [];
	for (const section of SECTIONS) {
		const mine = matching.filter((row) => section.holds.includes(row.status)).sort(byRecency);
		if (mine.length > 0) out.push({ kind: section.kind, label: section.label, rows: mine });
	}
	return out;
}

/**
 * Most recent first, which is all there is to rank by inside one heading.
 *
 * An agent that has never run sorts last rather than first: `lastAt` absent is not "now", and
 * a chat nobody has said anything to is not the newest thing that happened.
 */
const byRecency = (a: AgentRow, b: AgentRow) => (b.chat.lastAt ?? 0) - (a.chat.lastAt ?? 0);

/**
 * The same list, cut by workspace instead of by urgency.
 *
 * Three rules, and each is a decision rather than an accident:
 *
 * - **The focused agent's workspace comes first**, whatever its size. The panel is beside the
 *   conversation you are in, so the group you are in is the one you are most likely to be
 *   looking for — and it is the only heading whose position does not change as other agents
 *   start and stop.
 * - Then the biggest, then alphabetically. Size is the answer to "where is everybody"; the name
 *   is the tie-break, so two groups of two do not swap places between renders.
 * - **`No workspace` is last, and always drawn** when anybody is in none. A section that
 *   appears and disappears as agents declare themselves would move every row under it, and an
 *   agent in no workspace is a fact the list should be able to state — it is where the ones that
 *   have not been told about any project are.
 *
 * Rows inside a section keep urgency order, so switching axes loses the headings and not the
 * ranking. The `note` is what puts urgency back into the heading: a group with somebody waiting
 * in it says so, without the rows having to be read.
 */
function workspaceSections(rows: AgentRow[]): AgentSection[] {
	const groups = new Map<string, AgentRow[]>();
	for (const row of rows) {
		const name = row.workspace ?? "";
		const group = groups.get(name);
		if (group) group.push(row);
		else groups.set(name, [row]);
	}

	const mine = rows.find((row) => row.current)?.workspace;
	const named = [...groups.entries()]
		.filter(([name]) => name)
		.sort(([left, a], [right, b]) => {
			if (left === mine) return -1;
			if (right === mine) return 1;
			return b.length - a.length || left.localeCompare(right);
		})
		.map(([name, group]) => section("workspace", name, group));

	const loose = groups.get("");
	return loose ? [...named, section("unfiled", "No workspace", loose)] : named;
}

/** One section, with its rows ranked and its heading given the one thing about the group. */
function section(kind: AgentSectionKind, label: string, rows: AgentRow[]): AgentSection {
	const ranked = [...rows].sort(byRecency);
	const note = sectionNote(ranked);
	return { kind, label, rows: ranked, ...(note ? { note } : {}) };
}

/**
 * What the heading says about the group beyond its size.
 *
 * **Waiting wins.** A workspace with one agent wanting a decision and ten idle is a workspace
 * that needs you, and "2 working" would be the quieter true thing to say about it. Silent when
 * nobody is working and nobody is waiting, because a note on every heading is a column of
 * words that stops being read.
 */
function sectionNote(rows: AgentRow[]): string | undefined {
	const wants = rows.filter((row) => row.status === "waiting").length;
	if (wants > 0) return `${wants} want${wants === 1 ? "s" : ""} you`;
	const working = rows.filter((row) => row.status === "working").length;
	if (working > 0) return `${working} working`;
	return undefined;
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
		if (section.kind !== "quiet" && section.kind !== "unfiled") active += section.rows.length;
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

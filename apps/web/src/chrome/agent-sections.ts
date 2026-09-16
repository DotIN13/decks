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
 * **Workspace** is the default: the question a panel of a dozen agents is opened with is
 * usually which project somebody is on, and a project is a stable thing to look for where
 * "who needs you" is a ranking that moves under the reader as turns start and end. Urgency is
 * not lost with the headings — every workspace heading carries its own note (`2 want you`) and
 * every row carries its state — and the attention axis is one press away in the foot.
 *
 * **Attention** is the other answer: the same agents cut into waiting, working and quiet. The
 * two are read at different times and neither is derivable from the other.
 *
 * Inside a section, either way, the rows are in the order they last *said* something — see
 * `byRecency` — so the axis changes the headings and not the ranking.
 */
export type AgentGroup = "workspace" | "attention";

export interface AgentRow {
	/**
	 * The chat's id, and the row's own name for it.
	 *
	 * Not decoration and not a convenience: the panel keeps this list in a store so that a
	 * state change *updates* a row instead of re-drawing the list, and `reconcile` joins the old
	 * rows to the new ones by one key at every level. Carried on the row rather than read off
	 * `chat.id` at the call site because the key has to be a property of the object itself.
	 */
	id: string;
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
	/**
	 * What `reconcile` joins this section on, unique within the list it is in.
	 *
	 * The kind in the attention grouping, and `ws:` + the workspace's name in the workspace one,
	 * where the bare `ws:` is the empty name — which is the section an agent with no workspace is
	 * in. Prefixed there and not here because a workspace is a word a person types and `quiet`
	 * is a heading this file owns; the prefix is what keeps the two from ever being one section.
	 */
	id: string;
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
			id: chat.id,
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
		if (mine.length > 0) out.push({ id: section.kind, kind: section.kind, label: section.label, rows: mine });
	}
	return out;
}

/**
 * Newest message first, which is the row order under **both** axes.
 *
 * `lastAt` is the time of the last thing the agent said, not the time of the last write
 * (`protocol/chat.ts` says so on the field, and the server keeps it on the transcript for
 * exactly this reason). So a row moves to the top of its section when it says something, and
 * not when it opens a tool, changes state or has its tags edited — which is what the user
 * asked the list to be ordered by, and what stops the list re-sorting itself for reasons
 * nobody watching it can see.
 *
 * It is deliberately *not* urgency: an idle agent that spoke ten seconds ago leads a waiting
 * one that has said nothing for an hour, in a group whose heading already says somebody is
 * waiting. Two orderings would be two answers to one question.
 *
 * An agent that has never run sorts last rather than first: `lastAt` absent is not "now", and
 * a chat nobody has said anything to is not the newest thing that happened.
 */
const byRecency = (a: AgentRow, b: AgentRow) => (b.chat.lastAt ?? 0) - (a.chat.lastAt ?? 0);

/**
 * The same list, cut by workspace instead of by urgency.
 *
 * **Alphabetical, and nothing else.** A heading's position is a place, not a rank: the whole
 * point of grouping by project is that the project you are looking for is always in the same
 * place, and a rule that moved a group (because it is the focus, or because it grew) would make
 * the reader re-find it every time an agent started or stopped. So the order is the order of the
 * names, and it does not depend on who is focused, who is busy or how many are in each.
 *
 * `No workspace` is **last, and always drawn** when anybody is in none. Last because it is not a
 * project and has no place in the alphabet of them; always, because a section that appears and
 * disappears as agents declare themselves would move every row under it, and an agent in no
 * workspace is a fact the list should be able to state. It is where the ones nobody has told
 * about a project are, which is the common state rather than an error.
 *
 * Rows inside a section are in the order they last said something, exactly as they are under the
 * attention axis — see `byRecency`. The `note` is what puts urgency back into the heading: a
 * group with somebody waiting in it says so, without the rows having to be read.
 */
function workspaceSections(rows: AgentRow[]): AgentSection[] {
	const groups = new Map<string, AgentRow[]>();
	for (const row of rows) {
		const name = row.workspace ?? "";
		const group = groups.get(name);
		if (group) group.push(row);
		else groups.set(name, [row]);
	}

	const named = [...groups.keys()]
		.filter((name) => name)
		.sort((left, right) => left.localeCompare(right))
		.map((name) => section("workspace", `ws:${name}`, name, groups.get(name) ?? []));

	const loose = groups.get("");
	return loose ? [...named, section("unfiled", "ws:", "No workspace", loose)] : named;
}

/** One section, with its rows ranked and its heading given the one thing about the group. */
function section(kind: AgentSectionKind, id: string, label: string, rows: AgentRow[]): AgentSection {
	const ranked = [...rows].sort(byRecency);
	const note = sectionNote(ranked);
	return { id, kind, label, rows: ranked, ...(note ? { note } : {}) };
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

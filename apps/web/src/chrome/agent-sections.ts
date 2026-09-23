import type { AgentChat, Identity } from "@decks/protocol";
import { agentStatus, type AgentStatus } from "./agent-order.ts";

/**
 * What the panel's Agents tab lists: every agent, filed under the workspace it says it is in.
 *
 * Pure and tested, for the reason `panel-groups.ts` is: this is the whole of what the list
 * *knows*, and leaving it inside the component would mean the only way to ask "which heading
 * is this agent under" is to render one and look.
 *
 * Urgency is not a heading: every workspace heading carries its own note (`1 wants you`) and
 * every row its state, from the same `agentStatus` the corner ranks by.
 *
 * ### Why the search matches tags
 *
 * "Who else is on `panel-css`" is the question tags were added to answer, and this is the one
 * surface with room to show the answer. A field that matched only names would leave it
 * unanswerable in the place it is asked.
 */

/** What a list calls the group of agents that have not said which project they are on. */
export const NO_WORKSPACE = "No workspace";

export type AgentSectionKind = "workspace" | "unfiled";

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
	 * `ws:` + the workspace's name, where the bare `ws:` is the empty name — the section an agent
	 * with no workspace is in.
	 */
	id: string;
	kind: AgentSectionKind;
	/** The whole label, sentence case, without the count. Never uppercase. */
	label: string;
	rows: AgentRow[];
	/**
	 * Something true about the *group*, in the heading's right-hand column.
	 *
	 * It exists because a section you are not in can be the one that needs you, and a heading
	 * that only counted its rows would say "3" about a group with somebody waiting in it.
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
}

/** Trimmed and folded once, so callers do not each do it differently. */
const fold = (query?: string) => (query ?? "").trim().toLowerCase();

/**
 * Does this agent match what was typed — by name, by either kind of tag, or by workspace?
 *
 * Both tag lists, because the point of typing `panel-css` is to find every agent on it, and
 * an agent you tagged yourself is one of them. The workspace too: `irb` finds every agent
 * filed under `irb-84069`.
 *
 * Substring and case-insensitive rather than fuzzy, as `panel-groups.ts` matches a board: tags
 * and workspaces are slugs, so what somebody types is usually a word that is really in one.
 */
export function agentMatches(row: Pick<AgentRow, "chat" | "tags" | "userTags" | "workspace">, needle: string): boolean {
	if (!needle) return true;
	return `${row.chat.name}\n${row.tags.join("\n")}\n${row.userTags.join("\n")}\n${row.workspace ?? ""}`.toLowerCase().includes(needle);
}

/**
 * The sections, one per workspace in use, with `No workspace` last — see `workspaceSections`.
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

	const all = rows.filter((row) => agentMatches(row, needle));
	return workspaceSections(all);
}

/**
 * Newest message first, which is the row order inside every section.
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
 * The list, cut by workspace.
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
 * Rows inside a section are in the order they last said something — see `byRecency`. The
 * `note` is what puts urgency into the heading: a group with somebody waiting in it says so,
 * without the rows having to be read.
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

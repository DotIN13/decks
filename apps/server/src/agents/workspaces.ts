import type { AgentState } from "@decks/protocol";
import { slug } from "./slug.ts";

/**
 * What a workspace is allowed to be, and who is in which one.
 *
 * A **workspace is one slug** — `political-llm` — and nothing else is stored. There is no group
 * record, no membership list, no colour and no owner: the group *is* the set of agents whose
 * slug matches, which is the same move `tags.ts` makes and for the same reason. Two agents are
 * in the same workspace when they say the same word, so a group needs no lifecycle, and an
 * agent joining one is a write it can make on its own.
 *
 * Pure, like `panel/panel-groups.ts` and for the same reason: the two questions worth asking
 * about this feature — "what may a workspace be called" and "who is in which one" — should be
 * answerable without starting a runtime and reading a panel.
 */

/** The same 24 as a tag, and deliberately not a bigger number: a workspace is a label you read
 *  in a section heading and a chip on a row, and anything longer is elided in both. */
export const MAX_WORKSPACE_LENGTH = 24;

/**
 * One workspace name, cleaned — or `null` for "none".
 *
 * `null` and `""` both mean the agent is in no workspace, and so does anything that slugs to
 * nothing (`"   "`, `"!!!"`). One absence rather than three, because the panel draws one section
 * for all of them.
 */
export function cleanWorkspace(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	return slug(raw, MAX_WORKSPACE_LENGTH) || null;
}

/**
 * Whether two workspaces are the same, so nothing is broadcast for a no-op.
 *
 * An agent that declares its workspace at the top of every turn would otherwise put an
 * `agent.identity` on the wire per turn and re-render every panel watching — the argument
 * `sameTags` makes, with one value instead of a list.
 */
export function sameWorkspace(a: string | undefined, b: string | null | undefined): boolean {
	return (a ?? "") === (b ?? "");
}

/** The least a row has to say to be placed — what `registry.summaries()` already returns. */
export interface RosterEntry {
	id: string;
	name: string;
	state: AgentState;
	tags: string[];
	workspace?: string;
	/** The boards it holds, newest first. */
	context: string[];
}

export interface Workspace {
	/** The slug every member shares. */
	name: string;
	/** Members, in the order they were handed in — the same order `stage.agents()` reports. */
	agents: Array<{ id: string; name: string; state: AgentState; tags: string[] }>;
	/**
	 * Every board at least one member holds, **the ones most of them hold first**.
	 *
	 * This is the whole reason to ask about a workspace rather than about an agent: a board two
	 * members are working from is the workspace's, where a board one of them has open is that
	 * agent's. Ties break on the path, so the answer is stable between calls.
	 */
	boards: string[];
}

/**
 * The workspaces in use, biggest first, with an agent in none of them appearing nowhere.
 *
 * Ordered by size rather than alphabetically, because the question this answers is "where is
 * everybody" and the biggest group is the first half of that answer. Ties break on the name so
 * two workspaces of the same size do not swap places between renders.
 */
export function roster(entries: RosterEntry[]): Workspace[] {
	const groups = new Map<string, { members: RosterEntry[]; boards: Map<string, number> }>();
	for (const entry of entries) {
		const name = entry.workspace;
		if (!name) continue;
		let group = groups.get(name);
		if (!group) {
			group = { members: [], boards: new Map() };
			groups.set(name, group);
		}
		group.members.push(entry);
		// Once per member, not once per board: two agents holding the same board twice each is
		// still two out of two, and `Set` is what says so.
		for (const path of new Set(entry.context)) group.boards.set(path, (group.boards.get(path) ?? 0) + 1);
	}
	return [...groups.entries()]
		.sort(([left, a], [right, b]) => b.members.length - a.members.length || left.localeCompare(right))
		.map(([name, group]) => ({
			name,
			agents: group.members.map((member) => ({ id: member.id, name: member.name, state: member.state, tags: member.tags })),
			boards: [...group.boards.entries()].sort(([left, a], [right, b]) => b - a || left.localeCompare(right)).map(([path]) => path),
		}));
}

import type { AgentChat, Identity } from "@decks/protocol";
import { createEffect, createMemo } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { AgentRow } from "../agents/AgentRow.tsx";
import { agentSections, recentAgents, type AgentRow as AgentListRow, type AgentSection } from "../agents/agent-sections.ts";

/**
 * The agents as the side panel lists them: the Recent and Agents tabs draw the same rows, filed two
 * ways, and everything those rows share is here so the two tabs cannot drift apart.
 */

/** What the panel is given about the agents and what it may do to one: the panel's own props, read through. */
type AgentCalls = {
	chats?: AgentChat[];
	identities?: Record<string, Identity>;
	unread?: Record<string, number>;
	focused?: string;
	onFocusAgent?: (id: string) => void;
	onCloseAgent?: (id: string) => void;
	onAgentTags?: (id: string, tags: string[]) => void;
	onAgentWorkspace?: (id: string, workspace: string | null) => void;
	onAgentRename?: (id: string, name: string) => void;
	onAbortAgent?: (id: string) => void;
};

/** What every listed agent's row is handed beside the row itself. */
export type ListedAgents = {
	calls: AgentCalls;
	/** The workspaces in use, for the row's popup to suggest. */
	workspaces: () => string[];
	/** One line or two per row. */
	lines: () => 1 | 2;
	/** The pointer entered a row (its box) or left it (`undefined`), for the one hover card the list shares. */
	hover: (id: string, at: DOMRect | undefined) => void;
};

/**
 * Both tabs' lists, held in stores so that a state change *updates* a row instead of re-drawing the
 * list.
 *
 * This is the whole of the fix for a list that flickered while an agent worked.
 * `agentSections` builds fresh objects on every call and `<For>` keys by reference, so
 * deriving straight into the markup meant that *any* change at all — one agent moving from
 * `streaming` to `tool`, a tag arriving, a workspace being declared somewhere else — made
 * every section and every row a new object, and `For` had no choice but to throw the DOM away
 * and draw it again. Fourteen rows, their avatars, the pulse on a working face and any popup
 * somebody had open: gone and back, several times a minute, for as long as an agent was
 * running. `e2e/checks/panel-steady.mjs` is that, measured.
 *
 * `reconcile` is the other half. Given the list it drew last time and the list it has now, it
 * keeps the object it already had wherever it can and writes only the fields that moved,
 * joining old to new by `id` at every level. That is what `AgentSection.id` and `AgentRow.id`
 * are for, and why neither is optional. The store hands back the same proxy for the same
 * object, so `For` recognises the rows it already drew: it moves the ones that reordered, and
 * re-creates only the ones that are genuinely new. What a state change is left with is a word
 * and a colour on the row it was about.
 *
 * An **effect** rather than a memo, because `reconcile` is a setter and there has to be a
 * store for it to write into. It runs in the same task as the update that caused it, before
 * anything is painted, so the list is never a frame behind what the socket said.
 */
export function createAgentLists(calls: AgentCalls, query: () => string): { sections: AgentSection[]; recent: AgentListRow[] } {
	/** Everything the lists are derived from. One function, so the two stores cannot be given different questions. */
	const input = () => ({
		chats: calls.chats ?? [],
		identities: calls.identities ?? {},
		unread: calls.unread ?? {},
		focused: calls.focused,
		query: query(),
	});
	const [sections, setSections] = createStore<AgentSection[]>(agentSections(input()));
	createEffect(() => setSections(reconcile(agentSections(input()))));
	const [recent, setRecent] = createStore<AgentListRow[]>(recentAgents(input()));
	createEffect(() => setRecent(reconcile(recentAgents(input()), { key: "id" })));
	return { sections, recent };
}

/**
 * The workspaces in use, for the popup's suggestions.
 *
 * Read off the identities the panel is already holding rather than asked for: a workspace is
 * only a word somebody is using, so the set of them *is* this list, and a fetch for it would
 * be a second source of truth free to disagree.
 */
export function createWorkspaceNames(calls: AgentCalls): () => string[] {
	return createMemo(() => {
		const names = new Set<string>();
		for (const identity of Object.values(calls.identities ?? {})) if (identity.workspace) names.add(identity.workspace);
		return [...names].sort();
	});
}

/** One agent's row in either tab, wired to the panel's calls. */
export function ListedAgent(props: { row: AgentListRow; size: number; with: ListedAgents }) {
	const calls = props.with.calls;
	const id = () => props.row.chat.id;
	return (
		<AgentRow
			row={props.row}
			identity={calls.identities?.[id()]}
			onFocus={() => calls.onFocusAgent?.(id())}
			onClose={() => calls.onCloseAgent?.(id())}
			{...(calls.onAgentTags ? { onTags: (tags: string[]) => calls.onAgentTags?.(id(), tags) } : {})}
			workspaces={props.with.workspaces()}
			{...(calls.onAgentWorkspace ? { onWorkspace: (workspace: string | null) => calls.onAgentWorkspace?.(id(), workspace) } : {})}
			{...(calls.onAgentRename ? { onRename: (name: string) => calls.onAgentRename?.(id(), name) } : {})}
			taken={(name) => nameTaken(calls, name, id())}
			{...(calls.onAbortAgent ? { onAbort: () => calls.onAbortAgent?.(id()) } : {})}
			lines={props.with.lines()}
			size={props.size}
			onHover={(at) => props.with.hover(id(), at)}
		/>
	);
}

/* Every name on the deck but the agent's own: what the edit window checks a new name against
   before the server does, so the refusal is a red line under the field rather than a notice. */
function nameTaken(calls: AgentCalls, name: string, self: string): boolean {
	const wanted = name.trim().toLowerCase();
	return (calls.chats ?? []).some((chat) => chat.id !== self && (calls.identities?.[chat.id]?.name ?? chat.name).trim().toLowerCase() === wanted);
}

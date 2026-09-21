import { formatDate } from "../lib/time.ts";
import type { Board, Identity } from "@decks/protocol";

/**
 * The dashboard's first half: what each workspace has been making lately.
 *
 * A pure function, so the panel can hand it the boards and identities it already holds
 * and the answer is derived — the same move `agents/workspaces.ts` makes on the server,
 * with the same reason: "what did this workspace generate" should be answerable
 * without a network call, because both inputs are already on the wire.
 *
 * **A board belongs to the workspace whose agents hold it**, the same rule
 * `stage.canvases()` answers with, so the panel's two lists never disagree about who is in
 * which project. A board held by agents of two workspaces appears under both — it is
 * the truth twice, and mirroring it is cheaper than hiding it.
 *
 * "Latest" is `modifiedAt` — the new field on the wire — newest first. That is what
 * makes this a *generated-by* reading rather than a *held* reading: a board the
 * workspace made this morning is at the top, and a board it was handed last week is
 * where the time puts it.
 */

/** One board, as the dashboard's first half draws it. */
export interface WorkspaceBoard {
	path: string;
	title: string;
	/** The file's last-modification (ms since the epoch) — the sorting key. */
	modifiedAt: number;
	/** Agent id, or "you" — who last wrote it, for the row's byline. */
	lastWrittenBy?: string;
}

/** One workspace's section of the dashboard. */
export interface WorkspaceDigest {
	/** The slug — or the fixed pseudo-name for agents in none. */
	name: string;
	/** False for the pseudo-section. */
	real: boolean;
	/** Who is in it, in roster order. */
	agents: string[];
	/** The boards its agents hold, modified most recently first. */
	boards: WorkspaceBoard[];
	/** The newest modification of any board here — the section's own "lately". */
	latestAt: number;
}

/** How many boards a section shows before "and more" — a screen of them, not all. */
const SECTION_CAP = 5;

export function WORKSPACE_NONE(): WorkspaceDigest["name"] {
	return "No workspace";
}

/**
 * Group the deck's boards by the workspace that made them.
 *
 * `identities` is agent id → identity (it carries the workspace), and `contexts` is
 * agent id → boards held. An agent with no workspace is still a section, drawn last
 * like the panel draws it: its boards are real boards, and dropping them would hide
 * the newest work on decks where nobody has named a workspace yet.
 */
export function workspaceDigests(
	boards: Board[],
	identities: Record<string, Identity>,
	contexts: Record<string, string[]>,
	cap = SECTION_CAP,
	now = Date.now(),
): WorkspaceDigest[] {
	const groups = new Map<string, WorkspaceBoard[]>();
	const agents = new Map<string, string[]>();
	// The roster order is identity order, which is the order the panel already shows.
	// Every agent is a member first — even one holding nothing — so a section exists
	// for a project whose agents are all between tasks. An agent in none is the
	// catch-all section, drawn last.
	for (const [id, identity] of Object.entries(identities)) {
		const bucket = identity.workspace ?? WORKSPACE_NONE();
		agents.set(bucket, [...(agents.get(bucket) ?? []), identity.name]);
		if (!groups.has(bucket)) groups.set(bucket, []);
	}
	for (const [id, held] of Object.entries(contexts)) {
		const identity = identities[id];
		const bucket = identity?.workspace ?? WORKSPACE_NONE();
		if (identity) agents.set(bucket, [...(agents.get(bucket) ?? []), identity.name]);
		for (const path of held) {
			const board = boards.find((one) => one.path === path);
			if (!board) continue; // a board that was deleted is not a section's work
			const list = groups.get(bucket) ?? [];
			if (!list.some((one) => one.path === path)) {
				list.push({ path, title: board.title, modifiedAt: board.modifiedAt ?? 0, ...(board.lastWrittenBy ? { lastWrittenBy: board.lastWrittenBy } : {}) });
				groups.set(bucket, list);
			}
		}
	}
	// An agent is a member before it is a holder; a section with an agent but no boards
	// must still exist. The two maps above both seed sections, so a workspace with
	// members appears even when every board list is empty.
	return [...groups.entries()]
		.sort(([left], [right]) => {
			if (left === WORKSPACE_NONE()) return 1; // the catch-all is always last
			if (right === WORKSPACE_NONE()) return -1;
			return left.localeCompare(right);
		})
		.map(([name, list]) => {
			const sorted = [...list].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, cap);
			return {
				name,
				real: name !== WORKSPACE_NONE(),
				agents: [...new Set(agents.get(name) ?? [])],
				boards: sorted,
				latestAt: sorted.reduce((latest, board) => Math.max(latest, board.modifiedAt), 0),
			};
		})
		.filter((section) => section.real || section.boards.length > 0 || section.agents.length > 0);
}

/** A short "5 minutes ago" for a board's byline — the reader wants recency, not a clock. */
export function relativeTime(at: number, now = Date.now()): string {
	const delta = Math.max(0, now - at);
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (delta < minute) return "just now";
	if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
	if (delta < day) return `${Math.floor(delta / hour)}h ago`;
	if (delta < 30 * day) return `${Math.floor(delta / day)}d ago`;
	return formatDate(at);
}

/** The mirror for a future instant — "next 12h" — what a schedule row wants. */
export function untilTime(at: number, now = Date.now()): string {
	const delta = at - now;
	const minute = 60_000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (delta < 0) return "just now";
	if (delta < minute) return "in a moment";
	if (delta < hour) return `in ${Math.floor(delta / minute)}m`;
	if (delta < day) return `in ${Math.floor(delta / hour)}h`;
	if (delta < 30 * day) return `in ${Math.floor(delta / day)}d`;
	return formatDate(at);
}
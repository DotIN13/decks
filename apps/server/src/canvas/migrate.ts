/**
 * Turning the chats that exist into the canvases they were always describing.
 *
 * Before canvases, a chat carried three fields that were really one thing: the boards it had
 * up, where each sat, and a workspace word agents typed to say they were working together.
 * The word was the only grouping there was, and it had no boards of its own — the dashboard
 * worked them out from who was holding what.
 *
 * So the migration is the obvious reading of that: **a workspace word becomes a canvas**, and
 * the agents that said it are on it. A chat with boards and no word gets a canvas of its own,
 * named after the chat, because its arrangement is real and belongs somewhere.
 *
 * Pure, and tested as a pure function, because it runs once per deck and there is no second
 * chance to look at it: what it decides is what the deck's canvases are.
 */

export interface ChatToMigrate {
	id: string;
	name: string;
	/** The word the agent typed about itself. Where there is one, it is the grouping. */
	workspace?: string;
	/** The boards this chat had on its canvas. */
	inPlay: readonly string[];
	/** Where this chat had put boards — including boards no longer up. */
	positions?: Record<string, { x: number; y: number }>;
	/** When the chat was last active, so the newest arrangement wins a tie. */
	lastAt?: number;
}

export interface CanvasPlan {
	name: string;
	/** On the canvas, the fullest member's boards first and the others' after. */
	boards: string[];
	places: Record<string, { x: number; y: number }>;
	/** The chats that land on this canvas. */
	members: string[];
}

/**
 * What canvases to make, and who goes on each.
 *
 * Where several chats share a word, **the arrangement comes from the one holding the most of
 * that canvas's boards**, and a board only the others had keeps that chat's place for it. Two
 * chats that had the same board in different spots is the one real conflict here, and the
 * fuller canvas is the better guess at the arrangement a person laid out. Ties break on the
 * chat that was used most recently, so the answer does not change between runs.
 *
 * A chat with nothing on its canvas and no word is on no canvas at all. That is not a loss:
 * nothing was arranged, and an empty canvas per dormant chat is thirty empty cards.
 */
export function planCanvases(chats: readonly ChatToMigrate[]): CanvasPlan[] {
	const groups = new Map<string, ChatToMigrate[]>();
	for (const chat of chats) {
		const key = chat.workspace ? `w:${chat.workspace}` : `c:${chat.id}`;
		if (!chat.workspace && chat.inPlay.length === 0 && !hasPlaces(chat)) continue;
		const group = groups.get(key);
		if (group) group.push(chat);
		else groups.set(key, [chat]);
	}

	const plans: CanvasPlan[] = [];
	for (const [key, members] of groups) {
		// The fullest first: its arrangement is the canvas's, and the rest only fill gaps.
		const ordered = [...members].sort((a, b) => b.inPlay.length - a.inPlay.length || (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.id.localeCompare(b.id));
		const boards: string[] = [];
		const places: Record<string, { x: number; y: number }> = {};
		for (const chat of ordered) {
			for (const path of chat.inPlay) if (!boards.includes(path)) boards.push(path);
			for (const [path, at] of Object.entries(chat.positions ?? {})) if (!(path in places)) places[path] = at;
		}
		plans.push({
			name: key.startsWith("w:") ? key.slice(2) : (ordered[0]?.name ?? "Canvas"),
			boards,
			places,
			members: members.map((chat) => chat.id),
		});
	}
	return plans;
}

function hasPlaces(chat: ChatToMigrate): boolean {
	return Object.keys(chat.positions ?? {}).length > 0;
}

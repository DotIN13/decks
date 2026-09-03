import type { AgentChat, AgentState } from "@decks/protocol";

/**
 * Which agents want you, and in what order.
 *
 * A `.ts` rather than living beside the markup in `AgentStack.tsx`, because this is the
 * part that has rules worth testing and no DOM in it: who is in the corner, who is only in
 * the dropdown, and which face is leftmost. The drawing is in `AgentStack.tsx`; the policy
 * is here, and `agent-order.test.ts` is the only place either is asserted.
 *
 * The division of labour the whole feature rests on, from
 * `boards/the-agent-stack-comes-back`: **the corner is what is happening, the dropdown is
 * what exists.** Neither is a subset of the other by accident.
 */

/**
 * What an agent's ring says.
 *
 * Four values where the protocol has five states, and the mapping is not one to one in
 * either direction: `thinking`, `streaming` and `tool` are one ring, because the difference
 * between deciding and typing is the transcript's to show rather than a 24px circle's; and
 * `idle` splits in two depending on whether you have read what it left you.
 */
export type AgentStatus = "waiting" | "done" | "working" | "idle";

/**
 * The one derivation in the feature.
 *
 * `done` is **not** a server state — `AgentChat.state` has no word for "finished, and you
 * have not looked". It is `idle && unread > 0`, computed here, which is why no protocol
 * change was needed for green. The consequence is worth knowing: green now depends on
 * unread bookkeeping that used to feed only a dot nobody had to trust.
 */
export function agentStatus(state: AgentState, unread: number): AgentStatus {
	if (state === "waiting") return "waiting";
	if (state !== "idle") return "working";
	return unread > 0 ? "done" : "idle";
}

/**
 * The queue's order: asking, then finished, then busy, then quiet.
 *
 * Not alphabetical and not by recency-first, because the corner is a queue of things that
 * want a decision rather than a roster — and because leftmost is topmost, the face that
 * needs a decision is the one whose ring is never crossed by another.
 */
const RANK: Record<AgentStatus, number> = { waiting: 0, done: 1, working: 2, idle: 3 };

/** How many faces the corner draws before it gives up and says `+n`. */
export const STACK_CAP = 3;

/**
 * The faces in the top-right corner: every *active* agent except the one you are in.
 *
 * Two exclusions, and they are different arguments. **Idle agents are not drawn at all** —
 * a corner that lists agents which are not doing anything is a roster, and a roster cannot
 * empty itself, which is the property that lets this live in the chrome permanently.
 * **The focused agent is not drawn either** — it is top left with its name and the same
 * ring, and a face in two corners is one face too many.
 *
 * `unread` is the whole map rather than a number per chat so the caller can hand over the
 * signal it already has; a missing entry is zero.
 */
export function agentOrder(chats: AgentChat[], unread: Record<string, number>, focusedId?: string): AgentChat[] {
	/*
	 * Every other agent, idle included — and the idle ones are drawn dimmed, as the dropdown
	 * draws them.
	 *
	 * This started as *active only*, on the argument that a corner which fills itself and
	 * empties itself is chrome you can trust: a face there always meant something wanted
	 * you. The trouble showed up the moment it was running — three agents, all idle, and a
	 * corner with nothing in it reads as a corner that is broken rather than as a corner
	 * with nothing to say. An empty state that looks like a bug is not worth the purity.
	 *
	 * So the queue becomes a roster, and urgency survives as *order* rather than as
	 * membership: asking first, then done, then working, then idle by how recently it ran.
	 * The signal is still in the ring — dimmed and ringless is unmistakably "nothing here" —
	 * and the cap keeps the corner from growing past three faces and a count.
	 */
	return sortByUrgency(
		chats.filter((chat) => chat.id !== focusedId),
		unread,
	);
}

/**
 * The dropdown's order: everyone, including the idle, with the current agent pinned first.
 *
 * The pin is the one place the drawing and the table on
 * `boards/the-agent-stack-comes-back` disagree, and the drawing wins: it puts Ada — focused
 * and merely *working* — above a reviewer that is *waiting*. That is right, because the row
 * is describing the window you are already in, and it costs nothing: the corner excludes
 * the focused agent entirely, so the *relative* order of everything below the pin is
 * identical to the corner's, which is all the table was asking for.
 */
export function agentList(chats: AgentChat[], unread: Record<string, number>, focusedId?: string): AgentChat[] {
	const here = chats.filter((chat) => chat.id === focusedId);
	return [...here, ...sortByUrgency(chats.filter((chat) => chat.id !== focusedId), unread)];
}

/**
 * How the corner splits into faces and a number.
 *
 * Three, then `+n`. More than three agents wanting you at once is a queue, and a queue
 * belongs in a list you can read rather than in 106px of chrome.
 */
export function stackFaces(ordered: AgentChat[], cap: number = STACK_CAP): { shown: AgentChat[]; more: number } {
	return { shown: ordered.slice(0, cap), more: Math.max(0, ordered.length - cap) };
}

/*
 * Ties by most recent. `Array.prototype.sort` has been stable since ES2019, so two agents
 * with the same status and the same `lastAt` — two that have never run, usually — keep the
 * order they arrived in rather than swapping about between renders.
 */
function sortByUrgency(chats: AgentChat[], unread: Record<string, number>): AgentChat[] {
	return [...chats].sort((a, b) => {
		const byRank = RANK[agentStatus(a.state, unread[a.id] ?? 0)] - RANK[agentStatus(b.state, unread[b.id] ?? 0)];
		return byRank !== 0 ? byRank : (b.lastAt ?? 0) - (a.lastAt ?? 0);
	});
}

/**
 * The state in words, for the hover card and the dropdown's right-hand column.
 *
 * Written out as well as ringed, because a colour whose meaning you have to remember is a
 * colour that needs a legend — and rather than draw one, every place the ring appears says
 * the same thing in English beside it.
 */
export function statusWords(status: AgentStatus, state: AgentState): string {
	if (status === "waiting") return "Waiting for you";
	if (status === "done") return "Done — not read yet";
	if (status === "idle") return "Idle";
	if (state === "tool") return "Running tools…";
	if (state === "streaming") return "Typing…";
	return "Thinking…";
}

/**
 * The same fact, in the register a 264px dropdown row can afford.
 *
 * Lower case and shorter than `statusWords`, and it carries a time where the hover card
 * carries a sentence — `done · 2m` rather than `Done — not read yet`. Two registers rather
 * than one because the row's job is to be scanned in a list of six and the card's is to
 * answer a question, and a row wide enough for the card's phrasing would be the chat list.
 */
export function rowWords(status: AgentStatus, state: AgentState, at: number | undefined): string {
	if (status === "done") return `done · ${since(at)}`;
	if (status === "idle") return at === undefined ? "never run" : `idle · ${since(at)}`;
	return statusWords(status, state).toLowerCase();
}

/**
 * How long ago, in the two characters a corner has room for.
 *
 * Not "3 minutes ago": the hover card's line is already `writer · 2m`, and the word "ago"
 * in a box whose only other number is a percentage is a word doing no work. Under a minute
 * reads "just now" rather than "0m", because zero of something is the one value a
 * shortened unit says badly.
 */
export function since(at: number | undefined, now: number = Date.now()): string {
	if (at === undefined) return "";
	const seconds = Math.max(0, Math.round((now - at) / 1000));
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${Math.max(1, minutes)}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/**
 * The × on a row: its tooltip if this chat can be closed, and nothing at all if it cannot.
 *
 * Here rather than in the markup because it is a *server* rule, and the row has to know it
 * to draw itself honestly: `Registry.remove` refuses while `agent.running`, which is
 * `state !== "idle"` — so every state but one. `waiting` is the trap. Nothing is being
 * computed, so it looks closable, and the server counts it as running because a question is
 * still outstanding.
 *
 * **`undefined` means no button, not a disabled one.** A row mid-turn keeps its status words
 * instead — "typing…", "waiting for you" — and those *are* the reason it cannot be closed,
 * said better than a greyed-out × with the same fact in a tooltip. Drawing a control that
 * cannot be pressed is worth it when its absence would be a mystery, and this absence is
 * explained by the words it left in place.
 *
 * "The transcript stays on disk" is the important half of the one sentence there is. This is
 * `agent.remove`: the row goes and the session file stays where its runtime keeps it, so the
 * honest verb is *close* rather than delete — and the tooltip has to say which one it is,
 * because there is no undo in the list to find out with.
 */
export function closeWords(state: AgentState, name: string): string | undefined {
	if (state !== "idle") return undefined;
	return `Close ${name} — the transcript stays on disk. Delete does the same.`;
}

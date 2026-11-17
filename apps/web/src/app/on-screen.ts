import { baseTheme, placements, type PenDocument, type PenNode } from "@decks/pen";
import type { Page } from "@decks/protocol";
import { createComputed, createEffect, createMemo, untrack } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { adoptFormerComments } from "../state/comments.ts";
import { state } from "../state/deck.ts";
import { pens } from "../state/pens.ts";
import { agentViews } from "../state/views.ts";
import { focusedCanvas } from "./person.ts";
import { canvasOnScreen, homeInFront } from "../tabs/tabs.ts";
import { LOOKING } from "./landing.ts";

/** The cards a drawing places, by their path in the deck, each with its box on the canvas. */
function cardsOn(doc: PenDocument, canvas: string | undefined): Array<{ path: string; box: { x: number; y: number; w: number; h: number } }> {
	const placed = placements(doc, { theme: baseTheme(doc, "light") });
	const out: Array<{ path: string; box: { x: number; y: number; w: number; h: number } }> = [];
	const walk = (nodes: readonly PenNode[] | undefined) => {
		for (const node of nodes ?? []) {
			const path = node.type === "browser" ? (node.metadata as { path?: unknown } | undefined)?.path : undefined;
			const box = placed.get(node.id)?.box;
			// A card's path is its canvas's own (`cards/<name>/index.html`); an older one is the deck's already.
			if (typeof path === "string" && box) out.push({ path: canvas && !path.startsWith("canvases/") && !path.startsWith("shared/") ? `canvases/${canvas}/${path}` : path, box: { x: box.x, y: box.y, w: box.w, h: box.h } });
			walk(node.children as PenNode[] | undefined);
		}
	};
	walk(doc.children);
	return out;
}

/**
 * What is on screen: the conversation in focus, its canvas's drawing and cards, and the views this
 * device keeps for each conversation. Read from the app's state, for the page's sections and the
 * canvas (`App.tsx`).
 */
export function createOnScreen() {
	/**
	 * The views this device has left behind, per conversation.
	 *
	 * Kept in `localStorage` rather than in the scratch record beside them (`agent-views.ts` says
	 * why): a view is a fact about the machine looking, not about the deck, so it survives a
	 * reload and belongs to this browser alone.
	 */
	const views = createMemo(() => agentViews(state.deck?.path ?? ""));

	// Comments an earlier build kept under the agent alone wait on the canvas it is on now (`adoptComments`).
	createEffect(() => {
		const agent = state.focused;
		const canvas = focusedCanvas();
		if (agent && canvas) untrack(() => adoptFormerComments(agent, canvas));
	});

	/**
	 * Views of agents that are gone are dropped.
	 *
	 * The key is a map of agent id to view, and agents are removed all the time — a chat closed,
	 * a session deleted — so without this it grows by one entry per conversation ever had, for
	 * eyes that will never read them.
	 */
	createEffect(() => {
		const ids = state.chats.map((chat) => chat.id);
		// The person's own view of a canvas in a tab of its own is kept beside the conversations' (`landing.ts`, LOOKING).
		if (ids.length > 0) views().retain([...ids, LOOKING]);
	});

	const focusedChat = createMemo(() => state.chats.find((chat) => chat.id === state.focused));
	/* The conversation float shows the focused agent. Its history is asked for when it is shown. */
	const transcript = createMemo(() => {
		const id = state.focused;
		return id ? state.agents[id]?.transcript ?? [] : [];
	});
	const busy = createMemo(() => {
		const chat = focusedChat();
		return chat ? chat.state !== "idle" : false;
	});

	/** The drawing of the chat on screen, when it has one (`state/pens.ts`). */
	const stagePen = createMemo(() => {
		const name = canvasOnScreen()?.name;
		const pen = name ? pens()[name] : undefined;
		// Its placeholder frames are marked with the agent that last wrote it, as the canvas knows it.
		const by = pen?.by ? state.identities[pen.by] : undefined;
		const writer = by ? { name: by.name, color: by.color } : undefined;
		return pen ? { doc: pen.doc, base: pen.base, scope: pen.stage, ...(pen.edits ? { edits: pen.edits } : {}), ...(pen.made ? { made: pen.made } : {}), ...(writer ? { writer } : {}) } : undefined;
	});

	/**
	 * The boards on the focused agent's stage, at the size the stage draws them: the focused agent's
	 * in-play set, and nothing else. An agent holding nothing shows *no* boards.
	 *
	 * **A board is as tall as the stage file says, and no taller.** Its height is what a drag, a
	 * `decks.canvas.fit` or `decks.canvas.update` gave it; what its page measures in this browser is
	 * sent to the harness for `fit` to report (`card.extent`) and never grows the board by itself,
	 * for a board and a card alike. A page taller than its board is cut at the board's foot.
	 *
	 * Kept in a store reconciled by path, so a board keeps its identity when its height is raised or
	 * changes: what lists the boards by identity (the stage's board pages) keeps its page rather than
	 * loading it again.
	 */
	const [shownPages, setShownPages] = createStore<Page[]>([]);
	createComputed(() => {
		// A copy of its own: the merge below writes into this store's objects, never into the deck's.
		const copy = (board: Page) => JSON.parse(JSON.stringify(board)) as Page;
		let list: Page[];
		if (homeInFront()) {
			const playing = new Set(state.focused ? (state.agents[state.focused]?.inPlay ?? []) : []);
			list = state.pages.filter((board) => playing.has(board.path)).map(copy);
		} else {
			/*
			 * A canvas in front that is not the conversation's (`tabs/tabs.ts`): no agent's set says what is on
			 * it, its drawing does. Each card the drawing places, where and at the size the drawing has it.
			 */
			const pen = stagePen();
			list = pen ? cardsOn(pen.doc, pen.scope).flatMap(({ path, box }) => {
				const board = state.pages.find((one) => one.path === path);
				return board ? [{ ...copy(board), x: box.x, y: box.y, w: box.w, h: box.h }] : [];
			}) : [];
		}
		setShownPages(reconcile(list, { key: "path", merge: true }));
	});
	const stagePages = (): Page[] => shownPages;

	return { views, focusedChat, transcript, busy, stagePen, stagePages };
}

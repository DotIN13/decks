import type { DeckState, ServerMessage } from "@decks/protocol";
import type { View } from "../calls/person-call.ts";

/**
 * What is said to the pages: every change the harness makes, to everyone who is listening.
 *
 * The line and the event stream (`line.ts`, `routes/v1.ts`) hear every message as it is and choose
 * what to pass on; a page on the line is told it as the conversation on its own screen would see it
 * (`forView`). How many are connected is counted here, for whoever asks whether a page is there to
 * answer.
 */

/** What the broadcast needs of the harness: who is on screen, and the deck as an agent sees it. */
export interface BroadcastHost<Agent extends { id: string }> {
	/** The conversation last opened anywhere, if any, and one by its id. */
	looking(): Agent | undefined;
	agent(id: string | undefined): Agent | undefined;
	stateFor(agent: Agent): DeckState;
	/** Before a message goes out: for what must keep up with every change, whoever made it (a card's picture). */
	saying?(message: ServerMessage): void;
}

export class Broadcast<Agent extends { id: string }> {
	/** Canvas frames following their canvas's stream now (`routes/v1.ts`): each can answer an agent's view of its canvas. */
	canvasFrames = 0;
	/** How many lines are open (`line.ts`), set by `index.ts`: a page on the line counts as a connected browser. */
	lines: () => number = () => 0;
	/** Who else hears every broadcast: the event stream (`GET /api/v1/events`, `routes/v1.ts`) and the line. */
	private readonly listeners = new Set<(message: ServerMessage) => void>();

	constructor(private readonly of: BroadcastHost<Agent>) {}

	/** Pages and frames connected now, by any way in. */
	get screens(): number {
		return this.lines();
	}

	/** Whether anything is there to draw a canvas: a page on the line, or a frame on its stream. */
	get connected(): boolean {
		return this.screens > 0 || this.canvasFrames > 0;
	}

	/** Say something to everyone. */
	send(message: ServerMessage): void {
		this.of.saying?.(message);
		for (const listener of this.listeners) listener(message);
	}

	/** Say something to the streams alone (`/api/v1/events`), not the sockets: a canvas frame's own answers. */
	tellStreams(message: ServerMessage): void {
		for (const listener of this.listeners) listener(message);
	}

	/** Hear every broadcast, as it goes to the browsers; the answer stops it. */
	listen(listener: (message: ServerMessage) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * A broadcast as one browser should see it.
	 *
	 * Three frames depend on which conversation is on screen: `agents` names it, and `deck.state` and
	 * `card.changed` carry that canvas's arrangement. They are built for the registry's focus, which is
	 * whichever browser acted last, so a browser on another conversation gets them rebuilt for its own.
	 * A browser whose conversation was closed is moved to the registry's, which is the nearest row.
	 */
	forView(message: ServerMessage, view: View): ServerMessage {
		const shared = this.of.looking();
		const own = this.of.agent(view.focused);
		if (!own) {
			view.focused = shared?.id;
			return message;
		}
		if (own === shared) return message;
		switch (message.type) {
			case "agent.list":
				return { ...message, focused: own.id };
			case "deck.changed":
				return { ...message, deck: this.of.stateFor(own) };
			case "card.changed": {
				if (!message.card) return message;
				const placed = this.of.stateFor(own).cards.find((one) => one.path === message.path);
				return placed ? { ...message, card: { ...message.card, x: placed.x, y: placed.y, w: placed.w, h: placed.h } } : message;
			}
			default:
				return message;
		}
	}
}

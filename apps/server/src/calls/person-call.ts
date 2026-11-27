import type { ServerMessage } from "@decks/protocol";
import type { Registry } from "../agents/registry.ts";
import type { DeckAgent } from "../agents/session.ts";
import type { CanvasService } from "../canvas/service.ts";
import { personToolOf } from "./agent-tools.ts";
import { personAgent } from "./person.ts";

/**
 * One call of a person's verb: who made it, what it may say back, and the few steps every group
 * of the person's verbs (`person-table.ts`) takes the same way.
 */

/**
 * What one connected page is looking at.
 *
 * Only the conversation, because that is the one thing the server answers differently per
 * screen: which agent's canvas is up decides the arrangement a card list carries and the
 * `focused` an `agent.list` names. Everything else about where a person is lives in that
 * browser's own hash (`web/src/app/route.ts`).
 */
export interface View {
	/** The agent this page's canvas is on. `undefined` until it has said. */
	focused?: string;
}

/**
 * Who is calling a person's verb, and what it may say back.
 *
 * `tell` says a message to the caller alone (the line it came on), where a
 * broadcast goes to everyone: the history a chat.open asked for, a notice about this call. A call
 * by HTTP has nobody to tell, and its messages become the answer's notes. `view` is the caller's
 * screen, which agent it is on, kept per line (`forView` in `connections/broadcast.ts`); a page that has
 * none (a terminal) changes the harness's own focus alone.
 */
export interface PersonCall {
	tell: (message: ServerMessage) => void;
	view?: View;
	/** The id of the token the call came with, for what names the caller back (the paired front end that is you). */
	tokenId?: string;
	/** What the caller says it acts on: the canvas on screen and the agent it is talking to, from `X-Decks-Canvas` and `X-Decks-Agent` or the line's `canvas` and `agent`. */
	on: { canvas?: string; agent?: string; edit?: string };
}

/** One group of the person's verbs, by name. */
export type PersonVerbs = Record<string, (args: readonly unknown[], call: PersonCall) => Promise<unknown>>;

/** The agent a call names, or the sentence that says it has gone. */
export function needAgent(agents: Registry, id: unknown): DeckAgent {
	const agent = agents.get(String(id));
	if (!agent) throw new Error("That agent is not here any more.");
	return agent;
}

/** A notice to the caller alone. */
export function notice(call: PersonCall, level: "info" | "warn" | "error", text: string): void {
	call.tell({ type: "harness.notice", level, text });
}

/** What the person's hands did, run on the canvas they act on (`calls/gestures.ts`): its value, or its refusal thrown. */
export async function personGesture(host: { readonly agents: Registry; readonly canvas: CanvasService }, asked: { canvas?: string; agent?: string }, name: "move" | "resize" | "hide" | "edit" | "open" | "newCanvas", args: unknown[]): Promise<unknown> {
	const answer = await personToolOf(personAgent({ agents: host.agents, pens: host.canvas.pens }, asked)).gesture(name, args as never);
	if (!answer.ok) throw new Error(answer.error ?? `${name} failed`);
	return answer.value;
}

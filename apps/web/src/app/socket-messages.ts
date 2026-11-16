import type { ServerMessage } from "@decks/protocol";
import { heardAgent } from "./heard/agent.ts";
import { heardChat } from "./heard/chat.ts";
import { heardDeck } from "./heard/deck.ts";
import { heardHarness } from "./heard/harness.ts";
import { heardView } from "./heard/view.ts";

/** What the frame handler needs from the component it used to live in. */
export interface FrameHooks {
	/** A board asked for by a drop heard its path. */
	hearCreated(request: string, path: string): void;
	/**
	 * The deck has arrived for the conversation we just switched to.
	 *
	 * The other half of a switch, because *where the boards are* is half of what decides where to
	 * look: a view is restored only if it still shows one of the boards it was left on, and that
	 * question cannot be asked of the conversation being left.
	 */
	landed(): void;
	setAtTurn(at: { id: string; at: number } | undefined): void;
	raise(kind: "done" | "ask" | "problem", banner: { title: string; body?: string; tag?: string; agent?: string }): void;
	/** Open another conversation, as a click on its row does. */
	focusAgent?(id: string): void;
	/** Move a conversation to a canvas, as the person: an agent's offered `view.goto` they said Go to. */
	moveConversation?(id: string, canvas: string): void;
}

/** The messages of one noun: `Of<"agent">` is `agent.list`, `agent.state` and the rest. */
export type Of<Noun extends string> = Extract<ServerMessage, { type: `${Noun}.${string}` }>;
const about = <Noun extends string>(message: ServerMessage, noun: Noun): message is Of<Noun> => message.type.startsWith(`${noun}.`);

/**
 * What happens when a frame arrives.
 *
 * The app's whole inbound surface: every `ServerMessage` the protocol can send is answered by the
 * handler of its noun (`heard/`), and several are answered to nobody, because each handler's switch
 * is a statement about what the app knows.
 *
 * The context is explicit and small: what a handler needs from the component is the things it
 * *writes*, plus the two readers it needs to answer a question. Everything else it touches is a
 * module it imports — the store, the notices, the selection — which is the point of the state split:
 * a frame changes the app's state, not the component's.
 */
export function handleFrame(message: ServerMessage, hooks: FrameHooks): void {
	if (about(message, "agent")) return heardAgent(message, hooks);
	if (about(message, "chat")) return heardChat(message);
	if (about(message, "view")) return heardView(message, hooks);
	if (about(message, "harness") || about(message, "web") || about(message, "account")) return heardHarness(message, hooks);
	if (about(message, "deck") || about(message, "card") || about(message, "doc") || about(message, "canvas") || about(message, "stage")) return heardDeck(message, hooks);
}

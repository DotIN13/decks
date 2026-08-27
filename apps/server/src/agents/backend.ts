import type { AgentModel, AgentUsage, ModelOption, ThinkingLevel } from "@decks/protocol";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { Deck } from "../deck/loader.ts";
import type { ExtensionUiBridge } from "../pi/extension-ui.ts";
import type { Translator } from "./translator.ts";

/**
 * What the shell needs from an agent, and nothing about how it works.
 *
 * Pi is the only implementation today. The interface exists anyway, for the same
 * reason `translator.ts` is separate from `pi/events.ts`: the transcript, the
 * identity and the chat list are the same for every agent, and the day a second
 * one arrives the seam should already be where it belongs.
 */
export interface AgentBackendContext {
	cwd: string;
	deck: Deck;
	translator: Translator;
	bridge: ExtensionUiBridge;
	/** For things that are the environment's fault rather than the agent's. */
	notice(level: "info" | "warn" | "error", text: string): void;
	/** Built here rather than found on disk, so they can reach the canvas (§6.2). */
	extensions: InlineExtension[];
	/** A session file to open instead of starting a new one — see `forkFrom`. */
	resumeRef?: string;
}

/**
 * A point in a conversation the server can address: one per user message.
 *
 * Server-internal. It used to be a protocol type feeding a timeline widget; the widget
 * is gone (its actions moved onto the messages themselves) and what remains is the one
 * use that never was drawing — matching a revision to the moment a message was sent.
 */
export interface ConversationPoint {
	id: string;
	at?: number;
}

export interface AgentBackend {
	prompt(text: string): Promise<void>;
	abort(): Promise<void>;
	readonly isStreaming: boolean;

	model(): AgentModel | undefined;
	setModel(provider: string, model: string, thinking?: ThinkingLevel): Promise<void>;
	setThinking(level: ThinkingLevel): void;
	models(): Promise<ModelOption[]>;
	usage(): AgentUsage | null;

	/** The name the agent gave itself, if it has (M3: `stage.me.setName`). */
	name(): string | undefined;
	setName(name: string): void;

	// --- the session tree (§6.7, the time machine) ---------------------------------

	/** The points in this conversation worth returning to: the user's messages. */
	timeline(): ConversationPoint[];
	/** Tag the transcript's user messages with the session entries they became. */
	syncEntryIds(): void;
	/** Which revision each board was at, at that point in the conversation. */
	revisionsAt(entryId: string): Record<string, string>;
	/** Move the conversation back to just before that message. */
	rewindTo(entryId: string): Promise<{ cancelled: boolean; editorText?: string }>;
	/** A session file containing everything up to that point, for a new chat to open. */
	forkFrom(entryId: string): string | undefined;

	dispose(): void;
}

import type { AgentChat, AgentKind, ClaudeAccount, Identity } from "@decks/protocol";
import { createSignal, type JSX } from "solid-js";

// What the composer needs from the page that mounts it, handed over once with setAgentUiHost: how to
// say something, where the server's speech recogniser is, and how agents are drawn and picked.

/** A face for an agent, as the page draws one. */
export type FaceProps = { chat: AgentChat; identity: Identity | undefined; unread?: number; size?: number; ring?: number; class?: string };

/** A menu of agents behind a trigger the composer draws, as the page lists them. */
export type AgentMenuProps = {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onClose: (id: string) => void;
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	placement?: "top-start" | "top" | "top-end" | "bottom-start" | "bottom" | "bottom-end";
	label?: string;
	onMore?: () => void;
	onNew?: (kind: AgentKind) => void;
};

/** The host's part, every field optional: what is left out falls back to something plain. */
export interface AgentUiHost {
	/** Say something to the person: a failed recording, an error. Falls back to the console. */
	notice?: (level: "info" | "warn" | "error", text: string) => void;
	/** The server's address for a path, and the headers its calls need: the speech recogniser at /stt. */
	api?: (path: string) => string;
	authHeaders?: () => Record<string, string>;
	/** An agent's face. Falls back to its initial in a circle. */
	AgentFace?: (props: FaceProps) => JSX.Element;
	/** The agents menu behind the recipient chip. Left out, the chip names the agent and opens nothing. */
	AgentMenu?: (props: AgentMenuProps) => JSX.Element;
	/** A subscription's five-hour reading in the model menu's accounts. Left out, none is shown. */
	FiveHour?: (props: { reading: ClaudeAccount["fiveHour"] }) => JSX.Element;
}

const [host, setHost] = createSignal<AgentUiHost>({});

/** Hand the composer its host; call once before mounting, again to change it. */
export function setAgentUiHost(next: AgentUiHost): void {
	setHost(() => next);
}

/** The host as it is now. */
export const agentUiHost = (): AgentUiHost => host();

/** Say something through the host, or the console. */
export function hostNotice(level: "info" | "warn" | "error", text: string): void {
	const say = host().notice;
	if (say) say(level, text);
	else console[level === "info" ? "info" : "warn"](text);
}

/** The server's address for a path: the host's, else the page's own origin. */
export const hostApi = (path: string): string => host().api?.(path) ?? path;

/** The headers the server's calls need, from the host. */
export const hostHeaders = (): Record<string, string> => host().authHeaders?.() ?? {};

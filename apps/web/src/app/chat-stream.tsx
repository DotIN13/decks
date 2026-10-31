import type { ComponentProps } from "solid-js";
import { clearPreview, preview, state } from "../state/deck.ts";
import { loadEarlier } from "../state/history.ts";
import { send } from "../state/socket.ts";
import { Stream } from "../chat/Stream.tsx";

type TranscriptItem = ComponentProps<typeof Stream>["items"][number];
type AgentChat = (typeof state.chats)[number];

/** The focused agent's conversation, as both the panel and the phone's sheet draw it. */
export function FocusedStream(props: { shown: boolean; items: TranscriptItem[]; chat: AgentChat | undefined; atTurn: { id: string; at: number } | undefined }) {
	const focusedChat = () => props.chat;
	return (
		<Stream
			shown={props.shown}
			items={props.items}
			/*
			 * Reaching back, in two parts: whether there is anything there, and how to
			 * ask for it. The column owns the window over what is held; the server owns
			 * everything older (`agents/store.ts`), and this is the seam between them.
			 */
			more={state.focused ? state.agents[state.focused!]?.moreHistory === true : false}
			onEarlier={() => (state.focused ? loadEarlier(state.focused!) : Promise.resolve(0))}
			agentId={state.focused ?? ""}
			state={focusedChat()?.state ?? "idle"}
			name={state.identities[state.focused ?? ""]?.name ?? focusedChat()?.name ?? "It"}
			agent={focusedChat()?.kind ?? state.defaultKind}
			{...(props.atTurn ? { scrollTo: props.atTurn } : {})}
			previewing={preview()?.entryId ?? null}
			timeMachine="buttons"
			onPreview={(entryId) => {
				if (!state.focused) return;
				if (!entryId) {
					clearPreview();
					return;
				}
				send({ type: "rewind.preview", id: state.focused, entryId });
			}}
			onRewind={(entryId) => {
				if (!state.focused) return;
				clearPreview();
				send({ type: "rewind.to", id: state.focused, entryId });
			}}
			onFork={(entryId) => {
				if (!state.focused) return;
				clearPreview();
				send({ type: "fork.from", id: state.focused, entryId });
			}}
			onRestore={(entryId) => {
				if (!state.focused) return;
				clearPreview();
				send({ type: "boards.restore", id: state.focused, entryId });
			}}
		/>
	);
}

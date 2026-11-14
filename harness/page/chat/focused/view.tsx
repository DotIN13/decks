import type { ComponentProps } from "solid-js";
import { loadEarlier, preview, state } from "../../state/index.ts";
import { Stream } from "../stream/view.tsx";
import { forkAt, previewAt, restoreTo, rewindTo } from "./actions.ts";
import { focusedFacts } from "./model.ts";

type TranscriptItem = ComponentProps<typeof Stream>["items"][number];
type AgentChat = (typeof state.chats)[number];

/** The focused agent's conversation, as both the panel and the phone's sheet draw it. */
export function FocusedStream(props: { shown: boolean; items: TranscriptItem[]; chat: AgentChat | undefined; atTurn: { id: string; at: number } | undefined }) {
	const facts = () => focusedFacts(props.chat, state.identities[state.focused ?? ""], state.defaultKind);
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
			state={facts().state}
			name={facts().name}
			agent={facts().agent}
			{...(props.atTurn ? { scrollTo: props.atTurn } : {})}
			previewing={preview()?.entryId ?? null}
			timeMachine="buttons"
			onPreview={previewAt}
			onRewind={rewindTo}
			onFork={forkAt}
			onRestore={restoreTo}
		/>
	);
}

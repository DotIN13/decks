import type { AgentChat, ChatItem, Identity } from "@decks/protocol";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { AgentFace, agentState } from "./agent-marks.tsx";
import { plainText } from "./markdown.ts";

/**
 * What the agents are doing, as pills in the corner the list came out of.
 *
 * The agent list is behind a button now, and a list you have closed is a list that stops
 * telling you anything — so this is what it leaves behind: one pill per agent that is
 * working, with its face, its state and the newest thing it said. Closing the panel costs
 * you the roster and the unread counts, not the news.
 *
 * It replaces the peek that used to float above the input bar (`Latest`), and replaces it
 * rather than joining it, because the peek could only ever show *one* agent — it was handed
 * the focused transcript and nothing else. "What is happening" has the same answer for one
 * agent as for six, and it should not be two surfaces to read it in.
 *
 * ### What is said, and what is happening, are two lines
 *
 * The reply used to vanish the moment you sent the next message, and again whenever a turn
 * was all tool calls: the scan stopped at the first user message it met, so the peek went
 * blank for the whole of a long turn — exactly when a person is most interested in it, and
 * blank *because* work was happening, which reads as the agent having gone quiet.
 *
 * So the two are separate here too. The **text** is the last thing the agent actually said
 * and it stays until more text replaces it, across as many user messages and tool calls as
 * it takes. The **work** is whatever is running right now, on its own line with a pulsing
 * dot — the same idiom a running tool has in the history, so the two surfaces agree. Either
 * can be present without the other: a first turn shows only work, a finished turn only text.
 */
export function AgentPills(props: {
	chats: AgentChat[];
	/** Per agent, so a pill can read its own newest words rather than the focused agent's. */
	transcripts: Record<string, ChatItem[] | undefined>;
	identities: Record<string, Identity>;
	focused: string | undefined;
	/** The id of a reply the user waved away, per agent. */
	dismissed: Record<string, string | undefined>;
	onFocus: (id: string) => void;
	onOpen: () => void;
	onDismiss: (agentId: string, itemId: string) => void;
}) {
	/**
	 * Which agents get one.
	 *
	 * Two rules, and the second is the peek's job inherited. **Working** agents, because that
	 * is the question the pills exist to answer and it is true of any number of them at once.
	 * And the **focused** agent while its newest reply stands, because a reply you have not
	 * read yet is worth a glance whether or not the agent is still busy — that is what the ×
	 * is for, and waving one away is what ends it.
	 */
	const shown = createMemo(() =>
		props.chats.filter((chat) => {
			if (chat.state !== "idle") return true;
			return chat.id === props.focused && said(props.transcripts[chat.id], props.dismissed[chat.id]) !== undefined;
		}),
	);

	return (
		<Show when={shown().length > 0}>
			{/*
				A column, top left, under the button that hides the list — so closing the panel
				leaves the agents where they were rather than moving them across the screen.

				`pointer-events` are the column's children's, not the column's: the gaps between
				pills are canvas, and a transparent strip down the left of the screen that ate
				presses would be a canvas that had stopped working for no visible reason.

				`top-3` is the panel's own top edge, not a guess at where the title bar ends:
				this is positioned inside the work area, which already starts below the bar at
				whatever height the bar is — including the 52px it grows to on a touchscreen.
				Nothing to offset, and nothing to keep in step with.
			*/}
			<div class="pills pointer-events-none absolute top-3 left-3 z-[9] flex max-w-[min(340px,calc(100vw-24px))] flex-col items-start gap-1.5">
				<For each={shown()}>
					{(chat) => (
						<Pill
							chat={chat}
							items={props.transcripts[chat.id]}
							identity={props.identities[chat.id]}
							focused={props.focused === chat.id}
							dismissed={props.dismissed[chat.id]}
							onFocus={() => props.onFocus(chat.id)}
							onOpen={props.onOpen}
							onDismiss={(itemId) => props.onDismiss(chat.id, itemId)}
						/>
					)}
				</For>
			</div>
		</Show>
	);
}

function Pill(props: {
	chat: AgentChat;
	items: ChatItem[] | undefined;
	identity: Identity | undefined;
	focused: boolean;
	dismissed: string | undefined;
	onFocus: () => void;
	onOpen: () => void;
	onDismiss: (itemId: string) => void;
}) {
	const text = createMemo(() => said(props.items, props.dismissed));
	/** The newest running call, because that is the one actually happening now. */
	const busy = createMemo(() =>
		(props.items ?? []).filter((item): item is Extract<ChatItem, { kind: "tool" }> => item.kind === "tool" && item.state === "running").at(-1),
	);

	/**
	 * A pill the client has no transcript for still says something.
	 *
	 * `lastLine` comes with the roster, so a chat restored from a previous run — or one
	 * whose turn happened while another was focused — has a line to show before a single
	 * `chat.item` has arrived for it.
	 */
	const line = () => text()?.text ?? props.chat.lastLine ?? "";

	let body: HTMLButtonElement | undefined;
	/*
	 * Follow the words while they arrive, then go back to the beginning.
	 *
	 * Following is right mid-reply — the newest words are the interesting ones — but a
	 * finished message left scrolled to its end opens mid-sentence, which reads as if the
	 * start had been lost. Once it has stopped growing, the top is where a reader starts.
	 */
	createEffect(() => {
		const current = text();
		if (!current || !body) return;
		body.scrollTop = current.streaming ? body.scrollHeight : 0;
	});

	return (
		/*
		 * `pill` keeps its class for the two things a class attribute says badly: the
		 * `(pointer: coarse)` sizing, and the `::-webkit-scrollbar` hide on the body.
		 */
		<div
			// A pill is a target — tapping the face focuses that agent — so on a finger it gets
			// a row's padding rather than a strip's.
			class="pill pointer-events-auto flex max-w-full items-start gap-1.5 rounded-row border border-line bg-panel py-[5px] pr-1 pl-[7px] shadow-row pointer-coarse:py-[7px] pointer-coarse:pr-1.5 pointer-coarse:pl-2.5"
			data-state={props.chat.state}
			data-current={props.focused}
		>
			{/*
				The face is the button that focuses this agent, because the face is what
				identifies it — clicking the words opens the conversation instead, which is the
				more common intent and the one the peek always had.
			*/}
			<button
				class="flex-none cursor-pointer border-0 bg-none p-0"
				type="button"
				title={`Focus ${props.chat.name}`}
				aria-label={`Focus ${props.chat.name}`}
				onClick={props.onFocus}
			>
				<AgentFace chat={props.chat} identity={props.identity} size={18} />
			</button>

			<span class="flex min-w-0 flex-col gap-px">
				<span class="flex items-baseline gap-1.5">
					<span class="truncate text-[11px] font-semibold text-fg">{props.chat.name}</span>
					{/* The state in a word, because a dot alone cannot tell thinking from waiting. */}
					<Show when={props.chat.state !== "idle"}>
						<span class="flex-none text-[10px] text-faint">{agentState(props.chat.state)}</span>
					</Show>
				</span>

				<Show when={line()}>
					<button
						class="body max-h-[3.2em] cursor-pointer overflow-y-auto border-0 bg-none p-0 text-left text-[12px] leading-[1.35] whitespace-pre-wrap text-muted [overflow-wrap:anywhere] hover:text-fg"
						type="button"
						ref={body}
						title="Open the conversation"
						onClick={props.onOpen}
					>
						{line()}
					</button>
				</Show>

				{/* What is running, under what was said — either can be there without the other. */}
				<Show when={busy()}>
					{(tool) => (
						<button
							class="working flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-none p-0 text-[11px] text-muted"
							type="button"
							title="Open the conversation"
							onClick={props.onOpen}
						>
							<span class="dot" />
							<span class="flex-none">{tool().name}</span>
							<span class="truncate text-faint">{tool().title}</span>
						</button>
					)}
				</Show>
			</span>

			{/*
				Waving a reply away, which is the peek's × and means "I have read it".

				Only on a pill that is *only* a reply: an agent still working has nothing to
				dismiss — the pill is reporting live, and a close button on it would promise to
				stop something it cannot stop.
			*/}
			<Show when={props.chat.state === "idle" && text()}>
				{(current) => (
					<button
						class="dismiss flex-none"
						type="button"
						title="I have read this"
						aria-label="Dismiss this reply"
						onClick={() => props.onDismiss(current().id)}
					>
						<Icon of={X} size={13} />
					</button>
				)}
			</Show>
		</div>
	);
}

/**
 * The last thing an agent actually said, and whether it is still arriving.
 *
 * Scanned to the *last non-empty* assistant message rather than stopping at the newest item
 * of any kind. An assistant bubble exists with empty text for the moment between a turn
 * starting and its first token, and a turn that only calls tools leaves one behind with
 * nothing in it — treating either as "nothing to show" is what made the old peek blink.
 *
 * The markdown comes off: this is two lines in a pill, so it cannot draw a list or a
 * heading, and leaving raw `**` here while the bubble below renders it bold is the app
 * disagreeing with itself about the same sentence in two places at once.
 */
function said(items: ChatItem[] | undefined, dismissed: string | undefined): { text: string; streaming: boolean; id: string } | undefined {
	for (let index = (items?.length ?? 0) - 1; index >= 0; index -= 1) {
		const item = items![index];
		if (item?.kind !== "assistant") continue;
		const text = plainText(item.text).trim();
		if (!text) continue;
		return item.id === dismissed ? undefined : { text, streaming: item.streaming === true, id: item.id };
	}
	return undefined;
}

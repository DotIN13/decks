import type { AgentChat, ChatItem, Identity } from "@decks/protocol";
import Pin from "lucide-solid/icons/pin";
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import { Icon } from "../icons.tsx";
import { ToolChip } from "./ToolChip.tsx";

/**
 * The conversation, as bubbles at the edge of the canvas.
 *
 * Text is rendered as text, deliberately. It is model output, and turning it into
 * HTML means sanitising it — a real dependency and a real attack surface — to gain
 * bold and bullets in a 380px column. Fenced code blocks are the one thing worth
 * the special case, because an agent quoting a command is quoting something you may
 * want to read character by character.
 */
export function Bubbles(props: {
	agent: AgentChat | undefined;
	identity: Identity | undefined;
	items: ChatItem[];
	previewing?: boolean;
	open: boolean;
	pinned: boolean;
	unread: boolean;
	onPin: (pinned: boolean) => void;
	/**
	 * The time machine, addressed to the message it belongs to.
	 *
	 * These live on the user's own messages rather than on a separate bar: the message
	 * *is* the point you rewind to, and a second row of notches over the same list was
	 * the same thing drawn twice.
	 */
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
	/** An item to bring into view — the turn the spine was clicked at. */
	scrollTo?: { id: string; at: number };
}) {
	let stream!: HTMLDivElement;
	const [pinned, setPinned] = createSignal(true);

	/*
	 * Follow the bottom by watching it, not by holding it: a stream that scrolls
	 * itself while you are reading three replies back is the single most annoying
	 * thing a chat surface does.
	 */
	const onScroll = () => {
		const slack = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
		setPinned(slack < 40);
	};

	createEffect(() => {
		// Depend on the items so this re-runs as they arrive.
		props.items.length;
		props.items.at(-1)?.kind === "assistant" && (props.items.at(-1) as { text?: string }).text?.length;
		if (pinned() && stream) stream.scrollTop = stream.scrollHeight;
	});

	/*
	 * Opened at a turn, not at the bottom.
	 *
	 * The reason to reach for a transcript is usually something specific that scrolled
	 * away, so a click on the spine brings that turn to the top of the column and stops
	 * following the bottom until you scroll back down to it.
	 *
	 * Keyed on `at` as well as `id` so clicking the same block twice returns to it.
	 */
	createEffect(() => {
		const target = props.scrollTo;
		if (!target || !props.open || !stream) return;
		props.items.length;
		requestAnimationFrame(() => {
			const element = stream.querySelector(`[data-item="${cssEscape(target.id)}"]`);
			if (!element) return;
			setPinned(false);
			element.scrollIntoView({ block: "start", behavior: "smooth" });
			// A ring, not a wash: animating `background-color` replaced the bubble's own
			// colour for the length of the animation, so a user message flashed from blue
			// to nothing and back.
			element.animate(
				[
					{ boxShadow: "0 0 0 3px color-mix(in srgb, var(--color-accent) 55%, transparent)" },
					{ boxShadow: "0 0 0 3px transparent" },
				],
				{ duration: 1100, easing: "ease-out" },
			);
		});
	});

	const initial = () => (props.identity?.name ?? "A").slice(0, 1).toUpperCase();

	return (
		<section
			class="panel-float chat"
			data-previewing={props.previewing}
			data-open={props.open}
			data-unread={props.unread && !props.open}
		>
			<header class="chat-head">
				<span class="avatar" style={{ background: props.identity?.avatar ? "transparent" : (props.identity?.color ?? "var(--color-accent)") }}>
					<Show when={props.identity?.avatar} fallback={initial()}>
						{(src) => <img src={src()} alt="" />}
					</Show>
				</span>
				<span>{props.identity?.name ?? "agent"}</span>
				<span class="spacer" />
				<span>{props.agent?.state ?? "idle"}</span>
				{/* Pinned, it stays: you cannot read a long reply in a panel that leaves
				    with the cursor. */}
				<button
					class="pin"
					type="button"
					data-on={props.pinned}
					title={props.pinned ? "Let this panel hide again" : "Keep this panel open"}
					aria-label={props.pinned ? "Let this panel hide again" : "Keep this panel open"}
					onClick={() => props.onPin(!props.pinned)}
				>
					<Icon of={Pin} size={14} />
				</button>
			</header>

			<div class="stream" ref={stream} onScroll={onScroll}>
				<For each={props.items}>
					{(item) => (
						<Switch>
							<Match when={item.kind === "user"}>
								<UserTurn
									item={item as Extract<ChatItem, { kind: "user" }>}
									onPreview={props.onPreview}
									onRewind={props.onRewind}
									onFork={props.onFork}
									onRestore={props.onRestore}
								/>
							</Match>

							<Match when={item.kind === "assistant"}>
								<Assistant item={item as Extract<ChatItem, { kind: "assistant" }>} />
							</Match>

							<Match when={item.kind === "tool"}>
								<ToolChip item={item as Extract<ChatItem, { kind: "tool" }>} />
							</Match>

							<Match when={item.kind === "notice"}>
								<div class="chat-notice" data-item={item.id} data-level={(item as Extract<ChatItem, { kind: "notice" }>).level}>
									{(item as Extract<ChatItem, { kind: "notice" }>).text}
								</div>
							</Match>
						</Switch>
					)}
				</For>

			</div>
		</section>
	);
}

/**
 * A user message, and the way back to it.
 *
 * The actions appear on hover and only once the message has an `entryId` — the server
 * pairs each one with the Pi session entry it became, and until that has happened there
 * is nothing to address a rewind to.
 *
 * Hovering **rewind** previews immediately: the canvas renders that point from the
 * revision store, and leaving puts it back. No dwell delay, because you only get here by
 * reaching for the action itself — unlike a bar of notches, where passing the cursor
 * along it would fire a preview per notch.
 */
function UserTurn(props: {
	item: Extract<ChatItem, { kind: "user" }>;
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
}) {
	return (
		<div class="turn-row" data-item={props.item.id}>
			<div class="bubble" data-who="user">
				{props.item.text}
			</div>
			<Show when={props.item.entryId}>
				{(entryId) => (
					<div class="turn-actions">
						<button
							type="button"
							title="Put the conversation back to just before this message. Hover to see the boards as they were."
							onMouseEnter={() => props.onPreview(entryId())}
							onMouseLeave={() => props.onPreview(null)}
							onFocus={() => props.onPreview(entryId())}
							onBlur={() => props.onPreview(null)}
							onClick={() => {
								props.onPreview(null);
								props.onRewind(entryId());
							}}
						>
							rewind
						</button>
						<button
							type="button"
							title="Carry on from here in a new chat, keeping this one as it is"
							onClick={() => props.onFork(entryId())}
						>
							fork
						</button>
						<button
							type="button"
							title="Write the boards back to how they were at this point. The conversation stays where it is."
							onClick={() => props.onRestore(entryId())}
						>
							restore boards
						</button>
					</div>
				)}
			</Show>
		</div>
	);
}

/** A board path or an item id is user data; escape it before it goes in a selector. */
function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function Assistant(props: { item: Extract<ChatItem, { kind: "assistant" }> }) {
	const [showThinking, setShowThinking] = createSignal(false);
	const blocks = () => splitFences(props.item.text);

	return (
		<>
			<Show when={props.item.thinking?.trim()}>
				{(thinking) => (
					<div class="thinking">
						<button type="button" onClick={() => setShowThinking(!showThinking())}>
							{showThinking() ? "hide thinking" : "thinking…"}
						</button>
						<Show when={showThinking()}>
							<div class="body">{thinking()}</div>
						</Show>
					</div>
				)}
			</Show>

			<Show when={props.item.text.trim() || props.item.streaming}>
				<div class="bubble" data-who="agent" data-item={props.item.id}>
					<For each={blocks()}>
						{(block) => (block.code ? <pre>{block.text}</pre> : <span>{block.text}</span>)}
					</For>
					<Show when={props.item.streaming}>
						<span class="caret" />
					</Show>
				</div>
			</Show>
		</>
	);
}

/** Fenced code out, everything else through untouched. */
function splitFences(text: string): Array<{ code: boolean; text: string }> {
	const blocks: Array<{ code: boolean; text: string }> = [];
	const pattern = /```[\w-]*\n?([\s\S]*?)(?:```|$)/g;
	let last = 0;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		if (match.index > last) blocks.push({ code: false, text: text.slice(last, match.index) });
		blocks.push({ code: true, text: (match[1] ?? "").replace(/\n$/, "") });
		last = match.index + match[0].length;
	}
	if (last < text.length) blocks.push({ code: false, text: text.slice(last) });
	return blocks.filter((block) => block.text.length > 0);
}


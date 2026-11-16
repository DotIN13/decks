import type { AgentUsage } from "@decks/protocol";
import type { AgentMode, AgentModel, ClaudeAccount, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Mic from "lucide-solid/icons/mic";
import Paperclip from "lucide-solid/icons/paperclip";
import Pencil from "lucide-solid/icons/pencil";
import X from "lucide-solid/icons/x";
import Square from "lucide-solid/icons/square";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import { createSignal, For, Show } from "solid-js";
import { Icon, ScribbleCatch } from "@decks/ui";
import { joinHeard, micMissing } from "../voice/voice.ts";
import type { WaitingComment } from "../../state/index.ts";
import { draftIsEmpty, type Draft, type DraftMention } from "../draft/model.ts";
import { DraftField } from "../draft/view.tsx";
import type { ItemName, TitleOf } from "../pill/about.ts";
import { Hints } from "../hints/view.tsx";
import { ModeMenu } from "../mode-menu/view.tsx";
import { ModelPicker } from "../model-picker/view.tsx";
import { ContextDial } from "../context/view.tsx";
import { SlashMenu } from "../slash-menu/view.tsx";
import { MentionMenu } from "../mention-menu/view.tsx";
import type { Mentionable } from "../mention-menu/model.ts";
import { Recipient, type RecipientProps } from "../recipient/view.tsx";
import { createDraft, createIme, createMentions, createSlash, dropHandlers, editQueued, fieldKeys, send, sendAllQueued, type Bar, type FieldRef } from "./actions.ts";
import { createVoice, voiceKeys } from "../voice/session.ts";
import { clockText, placeholder, queueNote, recipientName } from "./model.ts";

// The composer floating over the canvas: the queue on top, the box with its field and controls,
// and the hints on the canvas under it.

/** What the shell gives the input bar. */
export interface ComposerProps {
	busy: boolean;
	model: AgentModel | undefined;
	models: ModelOption[];
	/** What `/` completes to on the focused agent's runtime. */
	commands: SlashCommand[];
	/** Whose runtime that is, for the badge on the rows the runtime rather than Decks answers. */
	runtime?: string;
	/** What the agent's runtime asks before acting, and the modes it has. */
	modes: AgentMode[];
	mode: AgentMode | undefined;
	onMode: (mode: AgentMode) => void;
	/**
	 * The typed words, the ids of the comments whose pills were in the field with them, and the draft
	 * itself, for the message to be kept as it was written (`messageParts`).
	 */
	onSend: (text: string, comments: string[], draft: Draft) => void;
	/**
	 * Ctrl+Enter (⌘+Enter on a Mac) while the agent works: the words wait for the turn to end
	 * (`DeckAgent.queueMine`). Enter still steers the turn; with nothing running both just send.
	 */
	onQueue?: (text: string, comments: string[], draft: Draft) => void;
	/** What is queued for this agent, oldest first, and whether Stop is holding it. */
	queued?: { items: Array<{ id: string; text: string }>; held: boolean };
	/** A queued row's buttons: take it off, send it now as a steer, or send a held queue. */
	onQueueAction?: (action: "remove" | "send" | "release", item?: string) => void;
	/**
	 * The comments kept for this agent's next message (`state/comments.ts`). Each is a pill in
	 * the field; this list is what a pill's id stands for, and what puts the pills back after a
	 * reload, when the field's own draft is gone and the comments are not.
	 */
	comments?: WaitingComment[];
	/** Pills the person deleted: their comments are no longer going anywhere. */
	onCommentsGone?: (ids: string[]) => void;
	onAbort: () => void;
	/** `thinking` is new: what `nearestLevel` kept when the model changed under it. */
	onModel: (provider: string, model: string, thinking?: ThinkingLevel) => void;
	onThinking: (level: ThinkingLevel) => void;
	/** The Claude subscriptions, and which one this conversation spends (`ModelPicker`). */
	accounts?: ClaudeAccount[];
	account?: string;
	onAccount?: (id: string) => void;
	/** The model picker opened with the accounts in it (`ModelPicker`). */
	onAccountsOpen?: () => void;
	/** Words the deck has put here, rather than typed: the message a rewind took back. */
	draft: { text: string; at: number; agentId?: string; insert?: boolean; comment?: string; pills?: Array<{ kind: "card" | "item"; id: string; label: string; name?: string }>; files?: string[] } | undefined;
	/**
	 * The draft above has been put in the field: forget it. A handover happens once, a draft
	 * still held after it was taken is one that can be put back by anything that re-reads it,
	 * which is how a mention attached with the paperclip kept coming back after it was sent.
	 */
	onDraftTaken?: () => void;
	/** Files dropped on the bar: the app copies them into the deck and hands back mentions. */
	onDropFiles?: (files: File[]) => void;
	/** A card's or card's title by its path, for the name on a pill's card. */
	titleOf?: TitleOf;
	/** A drawn item's name by its id, for a comment on one. */
	itemName?: ItemName;
	/** Show what a pill is about: the card, card or item on the canvas, the file. */
	onShowPill?: (pill: DraftMention, comment?: WaitingComment) => void;
	/**
	 * Where a line will land, in a word: "to Sable", "note on risk-model".
	 * A label and not a control. It is read from where you are and what you typed, so the
	 * bar carries no chips and nobody has to guess where Return sends a sentence.
	 */
	destination?: string;
	/** Who gets the line, as a chip that can change it. Without it the word alone is drawn. */
	recipient?: RecipientProps;
	/** Everybody an `@` can name, for the completion under the caret. */
	mentionables?: Mentionable[];
	/** The text as it is typed, so the destination word can follow an @ name. */
	onText?: (text: string) => void;
	/** How full this agent's context is, for the dial under the box. */
	usage: AgentUsage | undefined;
	/** The runtime's own usage report, from the row at the foot of the dial's popup. */
	onUsage: () => void;
	/**
	 * Whose conversation this is: who a handed-over draft is for, and whose usage this shows. What you
	 * have typed is kept under `page`, below, not under this.
	 */
	agentId: string | undefined;
	/**
	 * The page the bar is on, `agent:<id>@<canvas>` (the parked drafts). What is typed is kept per page,
	 * so leaving a page never loses a message, and another canvas starts with its own.
	 */
	page: string;
	/** Button one of three: the file picker the app already has (`app/files/FilePicker.tsx`). */
	onAttach?: () => void;
}

/** The input bar, floating over the canvas: a stack whose box is the card, with the hints on the canvas. */
export function Composer(props: ComposerProps) {
	const field: FieldRef = {};
	let stack: HTMLElement | undefined;
	const draft = createDraft(props, field);
	const slash = createSlash(props, draft, field);
	const mentions = createMentions(props, draft, field, slash.open);
	const voice = createVoice(field);
	voiceKeys(voice);
	const bar: Bar = { props, draft, slash, mentions, ime: createIme() };
	const [dropping, setDropping] = createSignal(false);
	const name = () => recipientName(props.recipient?.dest);
	return (
		<section class="relative flex w-auto transform-none flex-col gap-1.5" ref={(el) => (stack = el)}>
			<ScribbleCatch target={() => stack?.querySelector<HTMLElement>("[data-slot='composer-input']") ?? undefined} append={(text) => field.api?.appendWords(text)} />
			<Show when={mentions.open()}>
				<MentionMenu matches={mentions.matches()} identities={props.recipient?.identities ?? {}} activeIndex={mentions.index()} onHover={mentions.setIndex} onPick={mentions.pick} />
			</Show>
			<Show when={slash.open()}>
				<SlashMenu commands={slash.matches()} activeIndex={slash.index()} runtime={props.runtime ?? "agent"} onHover={slash.setIndex} onPick={slash.pick} />
			</Show>
			{/* What you queued with Ctrl+Enter, on top of the box: sent one per turn as each ends. */}
			<Show when={props.queued?.items.length ? props.queued : undefined}>
				{(queued) => <QueueCard queued={queued()} name={name()} props={props} onEdit={(item) => editQueued(bar, field, item)} />}
			</Show>
			<div class="composer-box float rounded-row px-2.5 pt-2.5 pb-2" data-dropping={dropping() ? "true" : undefined} {...dropHandlers(props, setDropping)}>
				{/* The grip: the one place a drag of the float may start that is not the padding. */}
				<span class="dock-grip" aria-hidden="true" />
				<DraftField
					ref={(api) => (field.api = api)}
					draft={draft.nodes()}
					pills={draft.pills}
					label="Message this agent"
					placeholder={placeholder(props.busy, name())}
					onDraft={draft.onDraft}
					onCaret={mentions.setCaret}
					onComposing={bar.ime.onComposing}
					onKeyDown={(event) => fieldKeys(bar, event)}
				/>
				<Show when={voice.recording()}>
					<LiveWords heard={voice.heard()} />
				</Show>
				<div class="dock-row mt-2 flex items-center gap-1.5">
					<Show when={!voice.recording()} fallback={<RecordingRow voice={voice} />}>
						<Controls props={props} voice={voice} sendable={!draftIsEmpty(draft.nodes())} onSend={() => send(bar)} />
					</Show>
				</div>
			</div>
			{/* The second register: what the keyboard can do, outside the box. */}
			<div class="hint-row flex h-[18px] items-center gap-2 px-1.5 pointer-coarse:hidden" hidden>
				<Hints menuOpen={slash.open() || mentions.open()} mentions={Boolean(props.mentionables?.length)} busy={props.busy && !!props.onQueue} />
				<span class="flex-1" />
			</div>
		</section>
	);
}

type Queued = NonNullable<ComposerProps["queued"]>;

/** The queue card: its head says how many wait and how they go; folded, it names the next line. */
function QueueCard(p: { queued: Queued; name: string; props: ComposerProps; onEdit: (item: Queued["items"][number]) => void }) {
	const [folded, setFolded] = createSignal(false);
	const foldWord = () => (folded() ? "Show the queue" : "Fold the queue");
	return (
		<div class="composer-queue" role="list" aria-label="Queued messages" data-folded={folded() ? "true" : undefined}>
			<div class="composer-queue-head">
				<button type="button" class="v3-icon composer-queue-fold" aria-expanded={!folded()} title={foldWord()} aria-label={foldWord()} onClick={() => setFolded(!folded())}>
					<Icon of={folded() ? ChevronRight : ChevronDown} size={14} />
				</button>
				<span class="composer-queue-title">
					{p.queued.items.length} queued for {p.name}
				</span>
				<span class="composer-queue-note truncate">{queueNote(p.queued, folded())}</span>
				<span class="flex-1" />
				<button type="button" class="composer-queue-release" title={p.queued.held ? "Send the held queue" : "Send every queued line now, as steers"} onClick={() => sendAllQueued(p.props, p.queued)}>
					Send all now
				</button>
			</div>
			{/* Folded by its height, so the rows slide shut rather than vanish. */}
			<div class="composer-queue-body" aria-hidden={folded()}>
				<div>
					<For each={p.queued.items}>{(item, index) => <QueueRow item={item} n={index() + 1} props={p.props} onEdit={() => p.onEdit(item)} />}</For>
				</div>
			</div>
		</div>
	);
}

/** One waiting line: put it back in the box, send it now as a steer, or take it off. */
function QueueRow(p: { item: { id: string; text: string }; n: number; props: ComposerProps; onEdit: () => void }) {
	return (
		<div class="composer-queue-row" role="listitem" data-item={p.item.id}>
			<span class="composer-queue-n">{p.n}</span>
			<span class="composer-queue-text" title={p.item.text}>
				{p.item.text}
			</span>
			<button type="button" class="icon-button" aria-label="Edit" title="Put it back in the box" onClick={p.onEdit}>
				<Icon of={Pencil} size={14} />
			</button>
			<button type="button" class="icon-button" aria-label="Send now" title="Send now, as a steer" onClick={() => p.props.onQueueAction?.("send", p.item.id)}>
				<Icon of={ArrowUp} size={14} />
			</button>
			<button type="button" class="icon-button" aria-label="Remove" title="Remove" onClick={() => p.props.onQueueAction?.("remove", p.item.id)}>
				<Icon of={X} size={14} />
			</button>
		</div>
	);
}

/** What the browser's recogniser has heard so far: settled words dark, the rest grey. */
function LiveWords(p: { heard: { settled: string; pending: string } }) {
	return (
		<p class="composer-live" aria-live="polite">
			<Show when={p.heard.settled || p.heard.pending} fallback={<span class="composer-live-wait">Listening…</span>}>
				<span>{p.heard.settled}</span>
				<Show when={p.heard.pending}>
					<span class="composer-live-pending">{joinHeard(p.heard.settled, p.heard.pending).length > p.heard.settled.length + p.heard.pending.length ? " " : ""}{p.heard.pending}</span>
				</Show>
			</Show>
		</p>
	);
}

/** While it records, the whole controls row is the recording's: discard, the wave, the clock, done. */
function RecordingRow(p: { voice: ReturnType<typeof createVoice> }) {
	return (
		<div class="composer-recording" role="group" aria-label="Recording">
			<button class="icon-button composer-discard" type="button" title="Throw this take away (Esc)" aria-label="Discard recording" onClick={() => p.voice.cancel()}>
				<Icon of={X} size={16} />
			</button>
			<span class="composer-wave" aria-hidden="true">
				<For each={p.voice.levels()}>{(level) => <i style={{ height: `${Math.round(4 + level * 18)}px` }} />}</For>
			</span>
			<span class="composer-clock">{clockText(p.voice.since(), p.voice.now())}</span>
			<button class="send-button composer-done" type="button" title="Keep the words: they go in the box (Ctrl+M)" aria-label="Done recording" onClick={() => void p.voice.stop()}>
				<Icon of={Check} size={15} />
			</button>
		</div>
	);
}

/** The controls row: who gets it, attach, mode before model, the context dial, the mic, and send or stop. */
function Controls(p: { props: ComposerProps; voice: ReturnType<typeof createVoice>; sendable: boolean; onSend: () => void }) {
	const props = p.props;
	return (
		<>
			<Show when={props.recipient} fallback={<Show when={props.destination}>{(word) => <span class="dock-to" data-dest={word()}>{word()}</span>}</Show>}>
				{(recipient) => <Recipient {...recipient()} compact />}
			</Show>
			<Show when={props.onAttach}>
				<button class="icon-button" type="button" aria-label="Attach a file" title="Attach a file" onClick={() => props.onAttach?.()}>
					<Icon of={Paperclip} size={15} />
				</button>
			</Show>
			<span class="flex-1" />
			<ModeMenu modes={props.modes} mode={props.mode} onMode={props.onMode} />
			<ModelPicker
				model={props.model}
				models={props.models}
				onModel={props.onModel}
				onThinking={props.onThinking}
				{...(props.accounts ? { accounts: props.accounts } : {})}
				{...(props.account ? { account: props.account } : {})}
				{...(props.onAccount ? { onAccount: props.onAccount } : {})}
				{...(props.onAccountsOpen ? { onAccountsOpen: props.onAccountsOpen } : {})}
			/>
			<span class="composer-ctx">
				<ContextDial usage={props.usage} onUsage={props.onUsage} />
			</span>
			<button
				class="icon-button composer-mic"
				type="button"
				data-busy={p.voice.transcribing() || p.voice.listening() ? "true" : undefined}
				disabled={p.voice.transcribing()}
				title={micMissing() ?? (p.voice.transcribing() ? "Turning it into words…" : "Speak instead of typing (Ctrl+M)")}
				aria-label="Speak"
				onClick={() => void p.voice.start()}
			>
				<Icon of={Mic} size={15} />
			</button>
			<SendOrStop busy={props.busy} sendable={p.sendable} onSend={p.onSend} onAbort={props.onAbort} />
		</>
	);
}

/** Stop is what an empty box offers while a turn runs; anything typed makes it send, which steers. */
function SendOrStop(p: { busy: boolean; sendable: boolean; onSend: () => void; onAbort: () => void }) {
	const word = () => (p.busy ? "Steer this turn" : "Send");
	return (
		<Show
			when={p.busy && !p.sendable}
			fallback={
				<button class="send-button" type="button" disabled={!p.sendable} title={word()} aria-label={word()} onClick={() => p.onSend()}>
					<Icon of={ArrowUp} size={15} />
				</button>
			}
		>
			<button class="send-button" type="button" data-stop="true" title="Stop this turn" aria-label="Stop this turn" onClick={() => p.onAbort()}>
				<Icon of={Square} size={11} class="fill-current" />
			</button>
		</Show>
	);
}

import type { AgentKind, AgentMode, AgentModel, AgentUsage, ClaudeAccount, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Paperclip from "lucide-solid/icons/paperclip";
import Square from "lucide-solid/icons/square";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import { carriesFiles } from "../../canvas/file-drop.ts";
import type { BoardComment } from "../../canvas/comments.ts";
import { DraftField, type DraftFieldApi } from "./DraftField.tsx";
import { commentLabel, draftComments, draftForAgent, draftIsEmpty, draftText, normalize, textDraft, type Draft, type DraftMention } from "./draft.ts";
import { Icon } from "../../ui/icons.tsx";
import { Hints } from "./Hints.tsx";
import { ModeMenu } from "./ModeMenu.tsx";
import { RuntimeMenu } from "./RuntimeMenu.tsx";
import { parkedDrafts, reconcilePills } from "./parked.ts";
import { ModelPicker } from "./ModelPicker.tsx";
import { ContextDial } from "./ContextDial.tsx";
import { filterCommands, SlashMenu } from "./SlashMenu.tsx";

/**
 * The input bar, floating over the canvas.
 *
 * The shape is picone's, and the borrowed idea is a division into **two registers**.
 *
 * *Inside* the box, under the text: attach, mode, model, and send at the far end. Every one
 * of them changes what the **next** turn does, so they belong to the draft — they sit with
 * it and move with it as it grows, which is the argument for putting controls inside a text
 * box at all rather than in a toolbar beside it.
 *
 * *Outside* the box and below it: the keyboard hints, and nothing else. They change nothing;
 * they teach the keys. The context dial was the other half of this row, on the same argument
 * — a reading of what the turn you **already have** has cost, which had no business among
 * controls that decide the next one — and it has since gone one step further out, into the
 * corner's `⋯`, where the things you go and look up live. So the second register is one
 * sentence wide now, and on a touchscreen it is not there at all: every hint in it names a
 * key that a phone does not have.
 *
 * Everything the three native `<select>`s used to do is now three popovers over one
 * primitive (`ui/Popover.tsx`), and everything the old bar did behaviourally is unchanged:
 * Enter sends, Shift+Enter makes a newline, `/` opens the command menu above the box, a
 * rewind hands its words back to the field, and the button at the end is both send and stop.
 */
export function Composer(props: {
	busy: boolean;
	model: AgentModel | undefined;
	models: ModelOption[];
	/** What `/` completes to on the focused agent's runtime. */
	commands: SlashCommand[];
	/** Whose runtime that is, for the badge on the rows the runtime rather than Decks answers. */
	runtime?: string;
	/**
	 * What the agent's runtime asks before acting, and the modes it has.
	 *
	 * Empty for Pi, where permissions are an extension's business (§6.8), so the control
	 * is absent rather than present and inert.
	 */
	modes: AgentMode[];
	mode: AgentMode | undefined;
	onMode: (mode: AgentMode) => void;
	/**
	 * Choose the runtime of the agent behind the bar. Supplied only on the dashboard, where
	 * that agent is the dispatcher; a stage's agent had its runtime fixed when it was made.
	 */
	onRuntime?: (kind: AgentKind) => void;
	/** The typed words, and the ids of the comments whose pills were in the field with them. */
	onSend: (text: string, comments: string[]) => void;
	/**
	 * The comments kept for this agent's next message (`state/comments.ts`). Each is a pill in
	 * the field; this list is what a pill's id stands for, and what puts the pills back after a
	 * reload, when the field's own draft is gone and the comments are not.
	 */
	comments?: BoardComment[];
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
	/**
	 * Words the deck has put here, rather than typed: the message a rewind took back.
	 *
	 * Carries a stamp as well as the text so that rewinding to the same message twice is two
	 * requests — an effect on the text alone would treat the second as one it had already
	 * carried out, which is the same reason `atTurn` carries one.
	 */
	draft: { text: string; at: number; agentId?: string; insert?: boolean; comment?: string } | undefined;
	/**
	 * The draft above has been put in the field: forget it. A handover happens once — a draft
	 * still held after it was taken is one that can be put back by anything that re-reads it,
	 * which is how a mention attached with the paperclip kept coming back after it was sent.
	 */
	onDraftTaken?: () => void;
	/** Files dropped on the bar: the app copies them into the deck and hands back mentions. */
	onDropFiles?: (files: File[]) => void;
	/**
	 * Where a line will land, in a word: "to dispatcher", "to Sable", "note on risk-model".
	 * A label and not a control. It is read from where you are and what you typed, so the
	 * bar carries no chips and nobody has to guess where Return sends a sentence.
	 */
	destination?: string;
	/** The text as it is typed, so the destination word can follow an @ name. */
	onText?: (text: string) => void;
	/**
	 * How full this agent's context is, for the dial under the box.
	 *
	 * Back on this component after a detour through the corner's `⋯`. It reports rather than
	 * acts, which is why it is *below* the box and not among the controls inside it — see the
	 * note on the hint row.
	 */
	usage: AgentUsage | undefined;
	/** The runtime's own usage report, from the row at the foot of the dial's popup. */
	onUsage: () => void;
	/**
	 * Whose conversation this is: who a handed-over draft is for, and whose usage this shows.
	 * What you have typed is kept under `page`, below, not under this.
	 *
	 * The text used to be one signal, cleared only on send or Escape — so a half-written
	 * prompt followed you to the next agent, addressed to it, one Enter from being sent to a
	 * conversation it was not written for. There is no undo for a sent message, which makes
	 * this the sharpest edge of the three the audit found.
	 */
	agentId: string | undefined;
	/**
	 * The page the bar is on, `home` or `agent:<id>` (`parked.ts`). What is typed is kept per
	 * page, so leaving a page, or the dispatcher behind Home changing, never loses a message.
	 */
	page: string;
	/**
	 * Button one of three: the file picker the app already has (`canvas/FilePicker`).
	 *
	 * Optional, and the button is absent rather than inert when it is not supplied. A
	 * paperclip that opens nothing is worse than no paperclip: it is the one control in
	 * this row everybody already knows, so it is the one they will believe.
	 */
	onAttach?: () => void;
}) {
	/*
	 * The field holds a document, not a string (`draft.ts`, ported from picone): runs of text,
	 * and pills for the comments going with the message. `text` is derived from it, and is what
	 * the slash menu and the destination word read.
	 */
	const [nodes, setNodes] = createSignal<Draft>([]);
	const text = createMemo(() => draftText(nodes()));
	let field: DraftFieldApi | undefined;
	/** Replace what the field holds, for a change nobody typed. */
	const put = (draft: Draft) => {
		const next = normalize(draft);
		setNodes(next);
		field?.set(next);
		props.onText?.(draftText(next));
		if (held !== undefined) parked.set(held, next);
	};
	const pillFor = (comment: BoardComment): DraftMention => ({ type: "mention", kind: "comment", id: comment.id, label: commentLabel(comment.quote) });
	const describe = (node: DraftMention) => {
		const comment = props.comments?.find((candidate) => candidate.id === node.id);
		return comment ? `“${comment.quote}”\n${comment.text}` : undefined;
	};

	/**
	 * What you had typed on each page: Home, and each agent's stage (`parked.ts`).
	 *
	 * Keyed by the page rather than by the agent behind the bar, and written on every change
	 * rather than only on a switch, so a draft outlives a change of page, a change of the
	 * dispatcher's runtime, and a reload. `held` is the page the field is showing.
	 */
	const parked = parkedDrafts(typeof localStorage === "undefined" ? undefined : localStorage);
	let held: string | undefined;

	/*
	 * A draft handed over replaces what is in the field, and takes the caret.
	 *
	 * Replaces rather than appends: the message it is handing back is the one that was just
	 * taken out of the conversation, so the field is where it *was* going to be edited. And
	 * focused at the end of it, because the next thing to happen is somebody changing a word.
	 *
	 * `handed.at` is read as well as `handed.text` so that the dependency on the stamp is
	 * this effect's own and not something it borrows from the caller happening to build a
	 * fresh object: two rewinds to the same message are two handovers, and the second must
	 * put the words back even though they are the same words.
	 */
	/*
	 * Restore the words of the page being arrived at.
	 *
	 * Tracks `props.page` only. Reading `text()` here would make this run on every
	 * keystroke and park a half-word against the *current* agent — which is harmless but
	 * means the effect is doing work per character to answer a question asked per switch. So
	 * the outgoing text is read untracked, and `held` is the id it belongs to.
	 */
	createEffect(() => {
		const next = props.page;
		if (next === held) return;
		// What was on the page being left is already remembered: every change is (`put`, `onDraft`).
		held = next;
		/*
		 * The page's own words, made to agree with the comments still waiting for it: a pill
		 * whose comment has gone is dropped, and a comment with no pill gets one, so the bar
		 * shows exactly what will be sent.
		 */
		const waiting = untrack(() => props.comments ?? []);
		put(reconcilePills(parked.get(next) ?? [], waiting.map((comment) => comment.id), (id) => pillFor(waiting.find((comment) => comment.id === id)!)));
	});

	createEffect(() => {
		const handed = props.draft;
		if (!handed) return;
		void handed.at;
		/*
		 * Everything after reading the draft is untracked, and that is half the fix for a mention
		 * that came back after it was sent. `input.focus()` runs the app's focus listeners
		 * synchronously, inside this effect, and whatever they read became something the effect
		 * depended on — so a send, or a switch of agent, re-ran it with the same stale draft and
		 * put the words back into an emptied field. The other half is `onDraftTaken`: the app
		 * forgets a draft the moment it is in the field.
		 */
		untrack(() => {
			// A draft addressed to one conversation is not put into another's field.
			if (handed.agentId === undefined || handed.agentId === props.agentId) {
				const kept = handed.comment ? props.comments?.find((candidate) => candidate.id === handed.comment) : undefined;
				// A comment kept on a board arrives as a pill; a dropped file as its `@path`, spaced
				// from its neighbours; anything else replaces what is there.
				if (kept) field?.append(pillFor(kept));
				else if (handed.insert) field?.insertText(handed.text);
				else put(textDraft(handed.text));
				field?.focus();
			}
			props.onDraftTaken?.();
		});
	});

	/** Whether a file is being dragged over the bar, so it can say it will take it. */
	const [dropping, setDropping] = createSignal(false);

	/** A draft that is exactly `/` followed by a command fragment, while nothing is typed after it. */
	const SLASH = /^\/([a-z0-9_:.-]*)$/i;
	/** `null` when this draft is not a command draft at all, which is not the same as "". */
	const fragment = createMemo(() => {
		const match = SLASH.exec(text());
		return match ? match[1]!.toLowerCase() : null;
	});
	const matches = createMemo(() => {
		const query = fragment();
		// Only a bare `/token` is a command draft; a space after the name means the
		// argument is being typed and the menu has had its say.
		return query === null ? [] : filterCommands(props.commands, query);
	});
	const menuOpen = createMemo(() => matches().length > 0);

	/**
	 * Which row the arrows are on. Reset whenever the list under it changes.
	 *
	 * The hint row under the box has said `↑ ↓ to choose` and `Tab to complete` since the
	 * composer was written, and until this signal existed all three of those keys did
	 * nothing: the menu had no selection to move, Tab left the field, and Enter took
	 * whatever happened to be first.
	 */
	const [menuIndex, setMenuIndex] = createSignal(0);
	createEffect(() => {
		matches();
		setMenuIndex(0);
	});

	const pick = (command: SlashCommand) => {
		/*
		 * `/name ` and a space — never the argument placeholder.
		 *
		 * It used to insert `/compact [notes]`, which reads as a form to fill in and is
		 * not one: Enter on it sent the four literal characters `[notes]` to the runtime
		 * as the argument. The hint stays where a hint belongs, on the row in the menu.
		 *
		 * The trailing space is also what closes the menu — `SLASH` does not match past
		 * one — so the Enter after a completion sends rather than completing again.
		 */
		const value = `/${command.name} `;
		put(textDraft(value));
		field?.focus();
	};

	/** Whether there is anything to send. Also what decides send against stop, below. */
	const sendable = () => !draftIsEmpty(nodes());

	const send = () => {
		// Enter with a command menu open completes the highlighted row instead of sending
		// the fragment — "/lo" Enter is "login", not an unknown command. A name typed out
		// in full ranks itself first, so Enter on it completes to itself and the space
		// that adds closes the menu; the Enter after that sends.
		const menu = matches();
		const chosen = menu[menuIndex()] ?? menu[0];
		if (chosen && chosen.name !== fragment()) {
			pick(chosen);
			return;
		}
		if (draftIsEmpty(nodes())) return;
		// The comments go as ids beside the words: what the agent reads for each is composed
		// from the comment itself (`commentBlock`), not from what its pill happens to show.
		props.onSend(draftForAgent(nodes()), draftComments(nodes()));
		// `put` forgets the page's parked copy with it, or switching away and back would bring
		// back a prompt that has already been sent.
		put([]);
	};

	/*
	 * Telling an input method's Enter apart from the user's.
	 *
	 * A Chinese, Japanese or Korean IME uses Enter to accept the candidate it is showing.
	 * Unguarded, that keypress reaches this handler like any other and ships the half-typed
	 * pinyin instead of the sentence — the bug the board
	 * `enter-during-chinese-input-no-longer-sends` is about, fixed there and not to be
	 * reintroduced here.
	 *
	 * Three signals, deliberately overlapping, because no single one covers every browser:
	 * Chrome, Firefox and Edge set `isComposing` on the keydown; older WebKit reports
	 * `keyCode` 229 for every key the IME owns; and Safari fires `compositionend` *before*
	 * the keydown that caused it, so on the committing Enter neither flag is set and only
	 * our own tail catches it.
	 *
	 * The tail is a **timestamp and not a timer**, which is the whole difference between
	 * this and the usual boolean-flag version of the fix: a `compositionend` that never
	 * arrives can leave a flag stuck and wedge the field shut for good, whereas a stale
	 * timestamp simply stops being recent.
	 *
	 * And it *returns* rather than calling `preventDefault`: the input method needs that
	 * keystroke to do its own job, so swallowing it would break candidate selection instead
	 * of fixing anything.
	 */
	let composing = false;
	let endedAt = 0;
	const imeOwns = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229 || composing || Date.now() - endedAt < 50;

	return (
		/*
		 * A stack, and no card of its own: the box below is the card, and the hint row under
		 * it is meant to sit on the canvas. `relative` is for the command menu, which is
		 * positioned against this whole stack rather than against the box — see below.
		 *
		 * Deliberately *not* carrying the old `composer` class. Those rules dress a
		 * bordered panel with three `<select>`s and a `.send` in it, and `.composer button`
		 * in particular would put a wash and 4px/10px padding on every button in here,
		 * beating `.iconbtn` on specificity. The narrow-width and coarse-pointer rules that
		 * comment used to justify keeping it all target the elements this rewrite deletes.
		 */
		<section class="relative flex w-auto transform-none flex-col gap-1.5">
			<Show when={menuOpen()}>
				<SlashMenu
					commands={matches()}
					activeIndex={menuIndex()}
					runtime={props.runtime ?? "agent"}
					onHover={setMenuIndex}
					onPick={pick}
				/>
			</Show>

			{/* 10 / 10 / 8: the bottom is short because the controls row has its own gap to
			    the text above it, and 10 under a 26px button reads as a hole. */}
			<div
				class="dockbox float rounded-row px-2.5 pt-2.5 pb-2"
				data-dropping={dropping() ? "true" : undefined}
				onDragOver={(event) => {
					if (!props.onDropFiles || !carriesFiles(event.dataTransfer)) return;
					event.preventDefault();
					if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
					setDropping(true);
				}}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
				}}
				onDrop={(event) => {
					if (!props.onDropFiles || !carriesFiles(event.dataTransfer)) return;
					event.preventDefault();
					// The bar's, not the canvas's: the document's own guard would take this for a
					// file dropped on empty canvas and make a board of it.
					event.stopPropagation();
					setDropping(false);
					const files = Array.from(event.dataTransfer?.files ?? []);
					if (files.length > 0) props.onDropFiles(files);
				}}
			>
				{/* The grip. The bar is a float, and this is the one place a drag may start
				    that is not the padding: the field and the buttons keep their own gestures. */}
				<span class="dock-grip" aria-hidden="true" />
				<Show when={props.destination}>
					{(word) => <span class="dock-to">{word()}</span>}
				</Show>
				{/*
					The field: text, and a pill for each comment going with it (`DraftField.tsx`).
					It grows with its words on its own, being a box rather than a textarea, up to
					the six lines the stylesheet caps it at.
				*/}
				<DraftField
					ref={(api) => (field = api)}
					draft={nodes()}
					describe={describe}
					// The field had no accessible name at all; the placeholder is not one.
					label="Message this agent"
					/* A turn in progress does not stop you talking to it. Text sent now steers this turn rather than
					   starting another one, and the field is the honest place to say so. */
					placeholder={props.busy ? "Steer this turn…" : "Draft something on a board, or ask…"}
					onDraft={(draft) => {
						setNodes(draft);
						if (held !== undefined) parked.set(held, draft);
						props.onText?.(draftText(draft));
						// A pill the person deleted: its comment is not going anywhere now.
						const here = new Set(draftComments(draft));
						const gone = (props.comments ?? []).filter((comment) => !here.has(comment.id)).map((comment) => comment.id);
						if (gone.length > 0) props.onCommentsGone?.(gone);
					}}
					onCaret={() => {}}
					onComposing={(now) => {
						composing = now;
						if (!now) endedAt = Date.now();
					}}
					onKeyDown={(event) => {
						// Every branch below is destructive — one moves a selection, one clears
						// the draft, one sends it — so all of them ask the input method first.
						if (imeOwns(event)) return;
						/*
						 * While the menu is up it owns the arrows and Tab. Wrapping rather than
						 * stopping at the ends: a fifty-row list is one ArrowUp away from its own
						 * bottom, and that is a reachable row rather than a dead key.
						 */
						if (menuOpen()) {
							const length = matches().length;
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setMenuIndex((at) => (at + 1) % length);
								return;
							}
							if (event.key === "ArrowUp") {
								event.preventDefault();
								setMenuIndex((at) => (at - 1 + length) % length);
								return;
							}
							if (event.key === "Tab") {
								// Tab completes rather than leaving the field, which is what the hint
								// under the box has been claiming all along.
								const chosen = matches()[menuIndex()];
								if (chosen) {
									event.preventDefault();
									pick(chosen);
									return;
								}
							}
						}
						if (event.key === "Escape") {
							put([]);
							props.onCommentsGone?.((props.comments ?? []).map((comment) => comment.id));
							return;
						}
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							send();
						}
					}}
				/>

				{/* The controls row. `dockrow` is only the two control sizes the board fixes
				    for this row (26px, 34 under a finger); the layout is here. */}
				<div class="dockrow mt-2 flex items-center gap-1.5">
					<Show when={props.onAttach}>
						<button class="iconbtn" type="button" aria-label="Attach a file" title="Attach a file" onClick={() => props.onAttach?.()}>
							<Icon of={Paperclip} size={15} />
						</button>
					</Show>

					{/* Mode before model, because it is the larger decision: what the agent may
					    do at all, rather than which one is doing it. */}
					<Show when={props.onRuntime}>
						{(choose) => <RuntimeMenu kind={props.runtime as AgentKind | undefined} onKind={(kind) => choose()(kind)} />}
					</Show>
					<ModeMenu modes={props.modes} mode={props.mode} onMode={props.onMode} />
					<ModelPicker
						model={props.model}
						models={props.models}
						onModel={props.onModel}
						onThinking={props.onThinking}
						{...(props.accounts ? { accounts: props.accounts } : {})}
						{...(props.account ? { account: props.account } : {})}
						{...(props.onAccount ? { onAccount: props.onAccount } : {})}
					/>

					<span class="flex-1" />

					{/*
					 * Stop is what an **empty** box offers while a turn is running. The moment
					 * there is something typed the button becomes send, because that text is
					 * steering — and having to clear the box to reach a send button, or press
					 * Enter on a control that reads "stop", is the wrong way round. Emptying the
					 * field brings stop back.
					 *
					 * One control and two meanings, with the geometry in one class, so the bar
					 * cannot reflow when a turn starts or ends: two buttons that swapped places
					 * would move the thing you were about to press. Straight from picone.
					 */}
					<Show
						when={props.busy && !sendable()}
						fallback={
							<button
								class="sendbtn"
								type="button"
								disabled={!sendable()}
								title={props.busy ? "Steer this turn" : "Send"}
								aria-label={props.busy ? "Steer this turn" : "Send"}
								onClick={send}
							>
								<Icon of={ArrowUp} size={15} />
							</button>
						}
					>
						<button
							class="sendbtn"
							type="button"
							data-stop="true"
							title="Stop this turn"
							aria-label="Stop this turn"
							onClick={() => props.onAbort()}
						>
							<Icon of={Square} size={11} class="fill-current" />
						</button>
					</Show>
				</div>
			</div>

			{/*
			 * The second register: what the keyboard can do. Outside the box, because it does
			 * not change what the next turn does.
			 *
			 * **Nothing on a touchscreen.** Every hint in it names a key — ⏎, ⇧+⏎, /, Esc — and
			 * a phone has none of them until a keyboard is up, at which point the row is behind
			 * it. It was 18px of unreadable advice above the one control that matters on a small
			 * screen, and dropping it takes 26px out of the dock, which the conversation above
			 * gets back.
			 *
			 * `pointer-coarse` and not a width: a narrow window on a laptop still has the keys,
			 * and the hints are still worth having there.
			 *
			 * **The context dial is at the right end of this row**, which is where it started.
			 * It spent a while in the corner's `⋯` and that was half right: on a phone there is
			 * no room under the input bar for anything, and on a desktop a reading you glance at
			 * twenty times an hour should not be behind a menu you have to open. So it is here
			 * for a fine pointer, and `⋯` keeps one row for a coarse one.
			 *
			 * Which also means the row is not *only* keycaps again — but the argument for
			 * dropping it on a touchscreen is unchanged, because the dial goes to `⋯` there.
			 */}
			<div class="hintrow flex h-[18px] items-center gap-2 px-1.5 pointer-coarse:hidden">
				<Hints menuOpen={menuOpen()} />
				<span class="flex-1" />
				<ContextDial usage={props.usage} onUsage={props.onUsage} />
			</div>
		</section>
	);
}

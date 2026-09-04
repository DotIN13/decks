import type { AgentMode, AgentModel, ModelOption, SlashCommand, ThinkingLevel } from "@decks/protocol";
import ArrowUp from "lucide-solid/icons/arrow-up";
import Paperclip from "lucide-solid/icons/paperclip";
import Square from "lucide-solid/icons/square";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import { Icon } from "../../icons.tsx";
import { Hints } from "./Hints.tsx";
import { ModeMenu } from "./ModeMenu.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

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
	/**
	 * What the agent's runtime asks before acting, and the modes it has.
	 *
	 * Empty for Pi, where permissions are an extension's business (§6.8), so the control
	 * is absent rather than present and inert.
	 */
	modes: AgentMode[];
	mode: AgentMode | undefined;
	onMode: (mode: AgentMode) => void;
	onSend: (text: string) => void;
	onAbort: () => void;
	/** `thinking` is new: what `nearestLevel` kept when the model changed under it. */
	onModel: (provider: string, model: string, thinking?: ThinkingLevel) => void;
	onThinking: (level: ThinkingLevel) => void;
	/**
	 * Words the deck has put here, rather than typed: the message a rewind took back.
	 *
	 * Carries a stamp as well as the text so that rewinding to the same message twice is two
	 * requests — an effect on the text alone would treat the second as one it had already
	 * carried out, which is the same reason `atTurn` carries one.
	 */
	draft: { text: string; at: number } | undefined;
	/**
	 * Button one of three: the file picker the app already has (`canvas/FilePicker`).
	 *
	 * Optional, and the button is absent rather than inert when it is not supplied. A
	 * paperclip that opens nothing is worse than no paperclip: it is the one control in
	 * this row everybody already knows, so it is the one they will believe.
	 */
	onAttach?: () => void;
}) {
	const [text, setText] = createSignal("");
	let input!: HTMLTextAreaElement;

	/*
	 * Growing the box: `field-sizing` where there is one, and a measurement where there is not.
	 *
	 * `field-sizing: content` is the whole of how this field grows, and it is a Chromium
	 * feature — WebKit does not implement it. So on an iPhone, which is the *one* place this
	 * matters most, the bar was one line tall for ever: you typed a paragraph into a 22px slot
	 * and could see the last few words of it. The desktop, being Chromium, looked perfect.
	 *
	 * Asked of the browser rather than of the platform, because the fallback should switch
	 * itself off the day WebKit ships the property, and a user-agent test never does. Where
	 * the property exists this code does nothing at all: no measuring, no inline height, and
	 * the CSS keeps doing the job it already did.
	 *
	 * `height: auto` before reading `scrollHeight` is not a flourish — with an inline height
	 * already set from the last keystroke, the scroll height is that height and the box can
	 * only ever grow. The `max-h` utility caps it and the textarea scrolls past the cap, so
	 * six lines remains six lines.
	 */
	const growsItself = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
	const fit = () => {
		if (growsItself || !input) return;
		input.style.height = "auto";
		input.style.height = `${input.scrollHeight}px`;
	};
	/*
	 * One effect for every path that changes the words, because there are five of them: a
	 * keystroke, a command picked from the menu, a draft handed back by a rewind, Escape
	 * clearing the field, and a send. They all set this signal, so tracking it is tracking
	 * all of them — and it runs after the DOM has the new value, which is when a measurement
	 * is worth taking.
	 */
	createEffect(() => {
		void text();
		fit();
	});
	onMount(fit);

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
	createEffect(() => {
		const handed = props.draft;
		if (!handed) return;
		void handed.at;
		setText(handed.text);
		if (!input) return;
		input.value = handed.text;
		input.focus();
		input.setSelectionRange(handed.text.length, handed.text.length);
	});

	/** A draft that is exactly `/` followed by a command fragment, while nothing is typed after it. */
	const SLASH = /^\/([a-z0-9_-]*)$/i;
	const fragment = createMemo(() => {
		const match = SLASH.exec(text());
		return match ? match[1]!.toLowerCase() : "";
	});
	const matches = createMemo(() => {
		// Only a draft that actually starts with `/` is a command draft; anything
		// else is prose and gets no menu.
		if (!text().startsWith("/")) return [];
		if (!fragment()) return props.commands;
		return props.commands.filter((command) => command.name.startsWith(fragment()));
	});
	const menuOpen = createMemo(() => matches().length > 0);

	const pick = (command: SlashCommand) => {
		// The argument placeholder stays for them to type over; a bare command sends
		// fine as-is.
		const value = `/${command.name}${command.arg ? ` ${command.arg}` : " "}`;
		setText(value);
		input.value = value;
		input.focus();
	};

	/** Whether there is anything to send. Also what decides send against stop, below. */
	const sendable = () => text().trim() !== "";

	const send = () => {
		// Enter with a command menu open completes the command instead of sending the
		// fragment — "/lo" Enter is "login", not an unknown command. A command typed
		// in full is already exact, so Enter sends it.
		const menu = matches();
		if (menu.length > 0 && menu[0]!.name !== fragment()) {
			pick(menu[0]!);
			return;
		}
		const value = text().trim();
		if (!value) return;
		props.onSend(value);
		setText("");
		input.value = "";
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
				{/*
					The menu floats *above* the whole stack rather than below it, because below is
					where the keyboard is on a phone and where the canvas is everywhere else — and
					above the stack rather than inside the controls row, because a completion list
					is about the text and not about the controls.
				*/}
				<div
					class="absolute bottom-[calc(100%+6px)] left-0 z-[12] flex max-h-[230px] w-[min(360px,100%)] flex-col gap-0.5 overflow-y-auto rounded-panel border border-line bg-panel p-[5px] shadow-panel"
					role="listbox"
					aria-label="Commands"
				>
					<For each={matches()}>
						{(command) => (
							<button
								class="flex cursor-pointer items-baseline gap-2.5 rounded-control border-0 bg-transparent px-[9px] py-[7px] text-left text-[13px] text-fg hover:bg-line"
								type="button"
								role="option"
								title={command.hint}
								onClick={() => pick(command)}
							>
								<span class="flex-none font-mono text-accent">
									/{command.name}
									{command.arg ? ` ${command.arg}` : ""}
								</span>
								<Show when={command.hint}>
									<span class="overflow-hidden text-[12px] text-ellipsis whitespace-nowrap text-muted">{command.hint}</span>
								</Show>
							</button>
						)}
					</For>
				</div>
			</Show>

			{/* 10 / 10 / 8: the bottom is short because the controls row has its own gap to
			    the text above it, and 10 under a 26px button reads as a hole. */}
			<div class="dockbox float rounded-row px-2.5 pt-2.5 pb-2">
				<textarea
					/*
					 * Grows to about six lines and then scrolls. Six because that is a
					 * paragraph — long enough to see a whole thought before sending it, short
					 * enough that the bar has not eaten the canvas it is floating over. 114px is
					 * six of 13px at 1.45.
					 *
					 * The 8px above the controls is the *row's* margin and not this field's
					 * padding, which is where it started: a textarea's padding is inside its
					 * scroll box, so once the draft was long enough to scroll the gap went with
					 * it and the seventh line sat on top of the buttons.
					 *
					 * 16px on a touch keyboard or the browser zooms the page when the field
					 * takes focus, which leaves the canvas at a scale nobody chose and the
					 * chrome half off screen.
					 */
					class="dockfield block max-h-[114px] min-h-[22px] w-full px-1 [field-sizing:content] pointer-coarse:text-[16px]"
					ref={input}
					rows="1"
					// The field had no accessible name at all; the placeholder is not one.
					aria-label="Message this agent"
					/* While a turn is running what you type is steering it, not starting
					   another one, and the field is the honest place to say so. */
					placeholder={props.busy ? "Steer this turn…" : "Draft something on a board, or ask…"}
					value={text()}
					onInput={(event) => setText(event.currentTarget.value)}
					onCompositionStart={() => (composing = true)}
					onCompositionEnd={() => {
						composing = false;
						endedAt = Date.now();
					}}
					onKeyDown={(event) => {
						// Both branches below are destructive — one clears the draft, the other
						// sends it — so both ask the input method first.
						if (imeOwns(event)) return;
						if (event.key === "Escape") {
							setText("");
							input.value = "";
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
					<ModeMenu modes={props.modes} mode={props.mode} onMode={props.onMode} />
					<ModelPicker model={props.model} models={props.models} onModel={props.onModel} onThinking={props.onThinking} />

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
			 * The context dial used to sit at the right end of this row. It is in the corner's
			 * `⋯` now (`chrome/ContextSummary.tsx`) — which is also why this row can go on a
			 * phone at all, rather than staying for the one thing in it that was not a keycap.
			 */}
			<div class="hintrow flex h-[18px] items-center gap-2 px-1.5 pointer-coarse:hidden">
				<Hints menuOpen={menuOpen()} />
			</div>
		</section>
	);
}

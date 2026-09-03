import type { ExtensionUiPrompt } from "@decks/protocol";
import Check from "lucide-solid/icons/check";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Icon } from "../icons.tsx";

/**
 * A runtime asking the user something (DESIGN §6.8).
 *
 * It used to be a card in the transcript, on the argument that the question belongs to the
 * conversation that raised it and a modal over a canvas hides what the question is about.
 * The first argument was right and the placement was still wrong: the transcript column is
 * away by default, so the first thing a Claude agent asked stopped the turn for a reason
 * nobody could see. It lives above the input bar now — small, not a modal, and where the
 * user's hands and attention already are.
 *
 * Which is also why the field focuses itself as the card appears: every dialog that has
 * one is asking for something to be typed or pasted *now* — a sign-in code, a name — and
 * a question over the input bar that needs a click before it will accept a paste is a
 * question that looks broken.
 */
export function Dialog(props: {
	prompt: ExtensionUiPrompt;
	onAnswer: (answer: { value?: string; confirmed?: boolean; cancelled?: true }) => void;
}) {
	const [text, setText] = createSignal(
		props.prompt.method === "editor" ? (props.prompt.prefill ?? "") : "",
	);

	/** The `choose` prompt, cast the way the rest of this file casts. */
	const choose = () => props.prompt as Extract<ExtensionUiPrompt, { method: "choose" }>;
	/** Ticked labels, for a question that takes more than one. */
	const [ticked, setTicked] = createSignal<string[]>([]);
	const toggle = (label: string) =>
		setTicked((was) => (was.includes(label) ? was.filter((entry) => entry !== label) : [...was, label]));
	/** Typing an answer the options do not have. */
	const [otherOpen, setOtherOpen] = createSignal(false);

	/**
	 * Focus a field as its card appears — see the note at the top of this file.
	 *
	 * A frame late, because the card slides in and a field focused before it is laid out
	 * scrolls the dock to a position it is about to leave.
	 */
	const focusOnMount = (element: HTMLInputElement) => {
		requestAnimationFrame(() => element.focus());
	};

	return (
		/*
		 * `.float` and `rounded-row`, which is exactly what the composer directly below it wears
		 * — the same surface colour, the same hairline, the same shadow rung and the same 14px
		 * corner — because the two are one column and a question is the row above the row you
		 * type in. It had a `--radius-panel` corner on `--bg` before, one step off the box it
		 * sits on top of.
		 *
		 * The accent-tinted border is the one thing left that marks this as a *question* rather
		 * than another float, and it overrides `.float`'s hairline rather than adding to it.
		 * `dialog-card` stays as a class so the dock's `align-self: stretch` rule can still
		 * find it.
		 */
		<div class="dialog-card float self-stretch rounded-row border-accent/40 px-2.5 py-2.5">
			<Switch>
				<Match when={props.prompt.method === "confirm"}>
					<div class="font-semibold">{(props.prompt as { title: string }).title}</div>
					<div class="mt-[3px] text-[12px] whitespace-pre-wrap text-muted">{(props.prompt as { message: string }).message}</div>
					<div class="mt-2 flex flex-wrap gap-1.5">
						<button class="btn" type="button" data-primary="true" onClick={() => props.onAnswer({ confirmed: true })}>
							Allow
						</button>
						<button class="btn" type="button" onClick={() => props.onAnswer({ confirmed: false })}>
							Deny
						</button>
					</div>
				</Match>

				<Match when={props.prompt.method === "select"}>
					<div class="font-semibold">{(props.prompt as { title: string }).title}</div>
					<div class="mt-2 flex flex-wrap gap-1.5">
						<For each={(props.prompt as { options: string[] }).options}>
							{(option, index) => (
								<button class="btn" type="button" data-primary={index() === 0} onClick={() => props.onAnswer({ value: option })}>
									{option}
								</button>
							)}
						</For>
						<button class="btn" type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Cancel
						</button>
					</div>
				</Match>

				{/*
					A question with reasons attached — Claude Code's `AskUserQuestion`.
					
					One button per option, stacked rather than in a row, because the sentence under
					each label is the part worth reading and a row has nowhere to put it. A single
					choice answers on the click; a multi-select ticks and waits for Done, since
					"which of these" has no answer until you have stopped choosing.
				*/}
				<Match when={props.prompt.method === "choose"}>
					{/* The tool's own 12-character chip: what the question is *about*, above what it asks. */}
					<Show when={choose().message}>
						{(header) => (
							<div class="meta mb-1">{header()}</div>
						)}
					</Show>
					<div class="font-semibold">{choose().title}</div>

					{/*
						`.rowlist` and `data-row`: the same object as a described choice in a menu —
						`styles/chrome.css` owns the grid, the 7px corner, the hover wash and the
						`.lb`/`.nt` pair. These used to be full-width slabs filled with `--line` at
						rest, which read as four disabled fields rather than four things to press, and
						was a second answer to a question that file had already answered.

						A tick in the icon column when it takes more than one, and *only* then: for a
						single choice the click is the answer, so a checkbox would be a control that
						shows what you already did and then vanishes with the card.
					*/}
					<div class="rowlist mt-2">
						<For each={choose().options}>
							{(option) => (
								<button
									type="button"
									data-row
									data-current={choose().multiple && ticked().includes(option.label) ? "true" : undefined}
									aria-pressed={choose().multiple ? ticked().includes(option.label) : undefined}
									onClick={() => (choose().multiple ? toggle(option.label) : props.onAnswer({ value: option.label }))}
								>
									<Show when={choose().multiple}>
										<span class="ic">
											<Icon of={Check} size={14} class={ticked().includes(option.label) ? "" : "opacity-0"} />
										</span>
									</Show>
									<span class="lb">{option.label}</span>
									<Show when={option.description}>
										<span class="nt whitespace-normal">{option.description}</span>
									</Show>
								</button>
							)}
						</For>
					</div>

					{/*
						The escape the tool promises and does not provide: "There should be no
						'Other' option, that will be provided automatically" — automatically means
						here. A question with four answers and no way to say "none of those" is a
						question that traps you.
					*/}
					<Show when={otherOpen()}>
						{/* `.field`, like every other place in the app that takes a typed value: a wash
						    rather than a box, and an accent ring *inset* on focus. The browser's own
						    focus ring was drawing a 2px black rectangle around a white field in the
						    middle of the dock. */}
						<label class="field mt-2 w-full [--field:28px]">
							<input
								ref={focusOnMount}
								value={text()}
								placeholder="Something else…"
								onInput={(event) => setText(event.currentTarget.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" && text().trim()) props.onAnswer({ value: text().trim() });
									if (event.key === "Escape") setOtherOpen(false);
								}}
							/>
						</label>
					</Show>

					<div class="mt-2 flex flex-wrap gap-1.5">
						<Show when={choose().multiple && !otherOpen()}>
							<button
								class="btn"
								type="button"
								data-primary="true"
								disabled={ticked().length === 0}
								onClick={() => props.onAnswer({ value: ticked().join(", ") })}
							>
								Done
							</button>
						</Show>
						<Show when={otherOpen()}>
							<button class="btn" type="button" data-primary="true" disabled={!text().trim()} onClick={() => props.onAnswer({ value: text().trim() })}>
								Send
							</button>
						</Show>
						<Show when={choose().other && !otherOpen()}>
							<button class="btn" type="button" onClick={() => setOtherOpen(true)}>
								Other…
							</button>
						</Show>
						<button class="btn" type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Cancel
						</button>
					</div>
				</Match>

				<Match when={props.prompt.method === "input" || props.prompt.method === "editor"}>
					<div class="font-semibold">{(props.prompt as { title: string }).title}</div>
					<label class="field mt-2 w-full [--field:28px]">
						<input
							ref={focusOnMount}
							value={text()}
							placeholder={(props.prompt as { placeholder?: string }).placeholder ?? ""}
							onInput={(event) => setText(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") props.onAnswer({ value: text() });
								if (event.key === "Escape") props.onAnswer({ cancelled: true });
							}}
						/>
					</label>
					<div class="mt-2 flex flex-wrap gap-1.5">
						<button class="btn" type="button" data-primary="true" onClick={() => props.onAnswer({ value: text() })}>
							Send
						</button>
						<button class="btn" type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Cancel
						</button>
					</div>
				</Match>

				{/* `custom` is a terminal screen; there is nothing here that could be one. */}
				<Match when={props.prompt.method === "custom"}>
					<div class="font-semibold">An extension asked for a terminal screen, which this app has no equivalent of.</div>
					<div class="mt-2 flex flex-wrap gap-1.5">
						<button class="btn" type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Dismiss
						</button>
					</div>
				</Match>

				{/*
				 * Sign-in is a *paste-the-code* flow, so the dialog has a field.
				 *
				 * It used to be a link and a "Done — I've signed in" button, which could not
				 * finish the flow it was offering: Claude Code prints the URL and then waits
				 * on stdin for the code the browser hands over at the end, so clicking Done
				 * told the deck a sign-in had happened that nothing had actually completed.
				 * The link opens the page; the field is where the browser's answer goes back.
				 */}
				<Match when={props.prompt.method === "login"}>
					<div class="font-semibold">{(props.prompt as { title: string }).title}</div>
					<div class="mt-[3px] text-[12px] whitespace-pre-wrap text-muted">{(props.prompt as { message: string }).message}</div>
					{/* Breakable, so a 450-character OAuth URL can be read and copied in the dock. */}
					{/* A wash rather than a bordered box on a bordered card, and the same corner as the
					    field under it. Breakable, so a 450-character OAuth URL can be read and copied
					    in the dock. */}
					<a
						class="mt-[7px] block rounded-control bg-line px-[9px] py-[7px] font-mono text-[11px] leading-normal break-all text-accent hover:bg-line-strong"
						href={(props.prompt as { url: string }).url}
						target="_blank"
						rel="noreferrer"
					>
						{(props.prompt as { url: string }).url}
					</a>
					<label class="field mt-2 w-full font-mono [--field:28px]">
						<input
							ref={focusOnMount}
							value={text()}
							autocomplete="off"
							spellcheck={false}
							placeholder={(props.prompt as { placeholder?: string }).placeholder ?? "Paste the code from the browser"}
							onInput={(event) => setText(event.currentTarget.value)}
							onKeyDown={(event) => {
								// Enter on a code that is not there yet would cancel the sign-in by
								// answering it emptily, so it only sends once there is something to send.
								if (event.key === "Enter" && text().trim()) props.onAnswer({ value: text() });
								if (event.key === "Escape") props.onAnswer({ cancelled: true });
							}}
						/>
					</label>
					<div class="mt-2 flex flex-wrap gap-1.5">
						<button
							class="btn"
							type="button"
							data-primary="true"
							disabled={!text().trim()}
							onClick={() => props.onAnswer({ value: text() })}
						>
							Sign in
						</button>
						<button class="btn" type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Cancel
						</button>
					</div>
				</Match>

				<Match when={props.prompt.method === "usage"}>
					<div class="font-semibold">{(props.prompt as { title: string }).title}</div>
					{/*
						A label and a number per line, with the numbers in the app's tabular figures so
						the column lines up on the digits rather than on the widths of the words. The
						label takes `.label`'s size and colour, which is what every other
						read-only pair in the app uses.
					*/}
					<div class="mt-[7px] grid gap-1">
						<For each={(props.prompt as { rows: { label: string; value: string }[] }).rows}>
							{(row) => (
								<div class="flex items-baseline justify-between gap-2.5">
									<span class="label">{row.label}</span>
									<span class="font-mono text-[12px] tabular-nums">{row.value}</span>
								</div>
							)}
						</For>
					</div>
					<div class="mt-2 flex flex-wrap gap-1.5">
						<button class="btn" type="button" data-primary="true" onClick={() => props.onAnswer({ confirmed: true })}>
							OK
						</button>
					</div>
				</Match>
			</Switch>
		</div>
	);
}

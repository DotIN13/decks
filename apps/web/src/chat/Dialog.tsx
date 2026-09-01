import type { ExtensionUiPrompt } from "@decks/protocol";
import { createSignal, For, Match, Switch } from "solid-js";

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
		<div class="dialog-card">
			<Switch>
				<Match when={props.prompt.method === "confirm"}>
					<div class="q">{(props.prompt as { title: string }).title}</div>
					<div class="m">{(props.prompt as { message: string }).message}</div>
					<div class="actions">
						<button type="button" data-primary="true" onClick={() => props.onAnswer({ confirmed: true })}>
							Allow
						</button>
						<button type="button" onClick={() => props.onAnswer({ confirmed: false })}>
							Deny
						</button>
					</div>
				</Match>

				<Match when={props.prompt.method === "select"}>
					<div class="q">{(props.prompt as { title: string }).title}</div>
					<div class="actions">
						<For each={(props.prompt as { options: string[] }).options}>
							{(option, index) => (
								<button type="button" data-primary={index() === 0} onClick={() => props.onAnswer({ value: option })}>
									{option}
								</button>
							)}
						</For>
						<button type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Cancel
						</button>
					</div>
				</Match>

				<Match when={props.prompt.method === "input" || props.prompt.method === "editor"}>
					<div class="q">{(props.prompt as { title: string }).title}</div>
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
					<div class="actions">
						<button type="button" data-primary="true" onClick={() => props.onAnswer({ value: text() })}>
							Send
						</button>
						<button type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Cancel
						</button>
					</div>
				</Match>

				{/* `custom` is a terminal screen; there is nothing here that could be one. */}
				<Match when={props.prompt.method === "custom"}>
					<div class="q">An extension asked for a terminal screen, which this app has no equivalent of.</div>
					<div class="actions">
						<button type="button" onClick={() => props.onAnswer({ cancelled: true })}>
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
					<div class="q">{(props.prompt as { title: string }).title}</div>
					<div class="m">{(props.prompt as { message: string }).message}</div>
					<a class="url" href={(props.prompt as { url: string }).url} target="_blank" rel="noreferrer">
						{(props.prompt as { url: string }).url}
					</a>
					<input
						class="code"
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
					<div class="actions">
						<button
							type="button"
							data-primary="true"
							disabled={!text().trim()}
							onClick={() => props.onAnswer({ value: text() })}
						>
							Sign in
						</button>
						<button type="button" onClick={() => props.onAnswer({ cancelled: true })}>
							Cancel
						</button>
					</div>
				</Match>

				<Match when={props.prompt.method === "usage"}>
					<div class="q">{(props.prompt as { title: string }).title}</div>
					<div class="usage-rows">
						<For each={(props.prompt as { rows: { label: string; value: string }[] }).rows}>
							{(row) => (
								<div class="row">
									<span class="label">{row.label}</span>
									<span class="value">{row.value}</span>
								</div>
							)}
						</For>
					</div>
					<div class="actions">
						<button type="button" data-primary="true" onClick={() => props.onAnswer({ confirmed: true })}>
							OK
						</button>
					</div>
				</Match>
			</Switch>
		</div>
	);
}

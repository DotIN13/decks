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
 */
export function Dialog(props: {
	prompt: ExtensionUiPrompt;
	onAnswer: (answer: { value?: string; confirmed?: boolean; cancelled?: true }) => void;
}) {
	const [text, setText] = createSignal(
		props.prompt.method === "editor" ? (props.prompt.prefill ?? "") : "",
	);

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

				<Match when={props.prompt.method === "login"}>
					<div class="q">{(props.prompt as { title: string }).title}</div>
					<div class="m">{(props.prompt as { message: string }).message}</div>
					<a class="url" href={(props.prompt as { url: string }).url} target="_blank" rel="noreferrer">
						{(props.prompt as { url: string }).url}
					</a>
					<div class="actions">
						<button type="button" data-primary="true" onClick={() => props.onAnswer({ confirmed: true })}>
							Done — I've signed in
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

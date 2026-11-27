import { For, Show, type JSX } from "solid-js";
import { m } from "@decks/i18n";

/** Where a key goes in a hint's sentence: the message is asked with this in each key's place, then split around it. */
const KEY = "\u0001";

/** A hint, one element and a whole phrase in the language shown, with its key drawn as a keycap where the phrase puts it. */
function Hint(props: { words: (key: string) => string; keys: JSX.Element }) {
	const parts = () => props.words(KEY).split(KEY);
	return (
		<span class="hint">
			<For each={parts()}>
				{(part, index) => (
					<>
						{part}
						{index() < parts().length - 1 ? props.keys : null}
					</>
				)}
			</For>
		</span>
	);
}

/**
 * What the keyboard can do here, under the box.
 *
 * Copied from picone's composer hint row: each hint is one element, a whole phrase.
 *
 * The separators are drawn in CSS by the hint that follows one (`.hint + .hint::before`),
 * so hiding a hint takes its dot with it and never leaves an orphan.
 */
export function Hints(props: {
	/** While the slash menu is up the keyboard means something else, so the row says so. */
	menuOpen: boolean;
	/**
	 * Whether `@` completes anything yet.
	 *
	 * Picone's third hint is `@ for memory`; here it is **`@ for cards`**, because a
	 * card is the thing this app has a lot of and a subject is not a thing it has at all.
	 * Off by default, and the fallback is Shift+Enter — the same trade picone makes when a
	 * workspace has no subjects. A hint for a key that does nothing is worse than the
	 * ordinary hint it displaced, so this only turns on when the mention menu is built.
	 */
	mentions?: boolean;
	/** The agent is working: Enter steers it, and Ctrl+Enter (⌘ on a Mac) queues for the turn's end. */
	busy?: boolean;
}) {
	return (
		<span class="flex min-w-0 items-center gap-2">
			<Show
				when={props.menuOpen}
				fallback={
					<>
						<Show when={props.busy} fallback={<Hint words={(key) => m.composer_hint_send({ key })} keys={<kbd>⏎</kbd>} />}>
							<Hint words={(key) => m.composer_hint_steer({ key })} keys={<kbd>⏎</kbd>} />
							<Hint
								words={(key) => m.composer_hint_queue({ key })}
								keys={
									<>
										<kbd>{/Mac/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd>+<kbd>⏎</kbd>
									</>
								}
							/>
						</Show>
						<Hint words={(key) => m.composer_hint_commands({ key })} keys={<kbd>/</kbd>} />
						<Show
							when={props.mentions}
							fallback={
								<Hint
									words={(key) => m.composer_hint_newline({ key })}
									keys={
										<>
											<kbd>⇧</kbd>+<kbd>⏎</kbd>
										</>
									}
								/>
							}
						>
							<Hint words={(key) => m.composer_hint_mention({ key })} keys={<kbd>@</kbd>} />
						</Show>
					</>
				}
			>
				{/* The same three slots, re-labelled: while a menu owns the arrow keys, what
				    Enter and Escape do is the thing worth knowing and "⏎ to send" is wrong. */}
				<Hint
					words={(key) => m.composer_hint_choose({ key })}
					keys={
						<>
							<kbd>↑</kbd>
							<kbd>↓</kbd>
						</>
					}
				/>
				<Hint words={(key) => m.composer_hint_complete({ key })} keys={<kbd>Tab</kbd>} />
				<Hint words={(key) => m.composer_hint_dismiss({ key })} keys={<kbd>Esc</kbd>} />
			</Show>
		</span>
	);
}

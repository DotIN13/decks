import { Show } from "solid-js";

/**
 * What the keyboard can do here, under the box.
 *
 * Copied from picone's composer hint row, ranks and all, because the ranking is the idea:
 * each hint is one element that either fits or does not, so **whole phrases** drop out as
 * the bar narrows rather than words wrapping inside them. Half a hint is worse than no
 * hint — "⏎ to" tells you nothing and costs you a line.
 *
 * The ranks are Tailwind variants and not a media query in `dock.css`, which is not a
 * stylistic preference: a `@media` block in the components layer still loses to a utility
 * on the same element (see the long note in `index.css`), so a rule that hides rank 3 there
 * would be beaten by the `flex` this row is laid out with and would silently do nothing.
 * Rank 3 goes at 620px and rank 2 at 470px, both measured against the *window* — under
 * 1100px the dock is full width, so the window is what the row's own width tracks.
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
	 * Picone's third hint is `@ for memory`; here it is **`@ for boards`**, because a
	 * board is the thing this app has a lot of and a subject is not a thing it has at all.
	 * Off by default, and the fallback is Shift+Enter — the same trade picone makes when a
	 * workspace has no subjects. A hint for a key that does nothing is worse than the
	 * ordinary hint it displaced, so this only turns on when the mention menu is built.
	 */
	mentions?: boolean;
}) {
	return (
		<span class="flex min-w-0 items-center gap-2">
			<Show
				when={props.menuOpen}
				fallback={
					<>
						<span class="hint">
							<kbd>⏎</kbd> to send
						</span>
						<span class="hint max-[470px]:hidden">
							<kbd>/</kbd> for commands
						</span>
						<Show
							when={props.mentions}
							fallback={
								<span class="hint max-[620px]:hidden">
									<kbd>⇧</kbd>+<kbd>⏎</kbd> for a new line
								</span>
							}
						>
							<span class="hint max-[620px]:hidden">
								<kbd>@</kbd> for boards
							</span>
						</Show>
					</>
				}
			>
				{/* The same three slots, re-labelled: while a menu owns the arrow keys, what
				    Enter and Escape do is the thing worth knowing and "⏎ to send" is wrong. */}
				<span class="hint">
					<kbd>↑</kbd>
					<kbd>↓</kbd> to choose
				</span>
				<span class="hint max-[470px]:hidden">
					<kbd>Tab</kbd> to complete
				</span>
				<span class="hint max-[620px]:hidden">
					<kbd>Esc</kbd> to dismiss
				</span>
			</Show>
		</span>
	);
}

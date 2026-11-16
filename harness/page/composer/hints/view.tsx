import { Show } from "solid-js";
import { thisQueueKey } from "./actions.ts";

// What the keyboard can do here, under the box.

/** What the keyboard can do here, under the box. */
export function Hints(props: {
	/** While the slash menu is up the keyboard means something else, so the row says so. */
	menuOpen: boolean;
	/** Whether `@` completes anything yet. */
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
						<Show
							when={props.busy}
							fallback={
								<span class="hint">
									<kbd>⏎</kbd> to send
								</span>
							}
						>
							<span class="hint">
								<kbd>⏎</kbd> to steer
							</span>
							<span class="hint">
								<kbd>{thisQueueKey()}</kbd>+<kbd>⏎</kbd> to queue
							</span>
						</Show>
						<span class="hint">
							<kbd>/</kbd> for commands
						</span>
						<Show
							when={props.mentions}
							fallback={
								<span class="hint">
									<kbd>⇧</kbd>+<kbd>⏎</kbd> for a new line
								</span>
							}
						>
							<span class="hint">
								<kbd>@</kbd> for an agent
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
				<span class="hint">
					<kbd>Tab</kbd> to complete
				</span>
				<span class="hint">
					<kbd>Esc</kbd> to dismiss
				</span>
			</Show>
		</span>
	);
}

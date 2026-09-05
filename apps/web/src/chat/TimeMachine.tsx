import ArchiveRestore from "lucide-solid/icons/archive-restore";
import Eye from "lucide-solid/icons/eye";
import GitBranch from "lucide-solid/icons/git-branch";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import { createMemo } from "solid-js";
import { Icon } from "../icons.tsx";
import { Popover } from "../ui/Popover.tsx";

/**
 * The way back to a message, on the message.
 *
 * **On your own bubbles, because your message is the point you would go back to.** The app
 * has always worked this way — `onPreview`, `onRewind`, `onFork` and `onRestore` are
 * addressed to the entry a message became — and the reason is still the right one: a second
 * row of notches down the side of the history was the same thing drawn twice, once as a
 * transcript and once as a scrubber.
 *
 * What is new is that it is a **visible button with a menu** rather than three squares you
 * had to hover a bubble to find. Two consequences worth the 22px: a touchscreen can reach it
 * at all, and each action gets a sentence — "Rewind" alone does not say that the words come
 * back to the input bar, and that is the fact that decides whether you dare press it.
 *
 * ### Pointing at it used to preview, and no longer does
 *
 * Hovering the handle started a preview with no dwell delay, and picking the row *held* one
 * that outlived the pointer. Two ways in, one of which you could take by accident, and both
 * ending in the same state: every board amber and inert, with the only way out inside this
 * menu. What that produced is a canvas somebody is stuck in without having asked for
 * anything — and a reading of the boards that changes while your cursor drifts across a
 * transcript is not a feature, it is a flinch.
 *
 * So there is one way in and it is a press. Which also makes this menu what it says it is:
 * **look, take back, branch, put back** — four deliberate acts on one point in the
 * conversation, none of them reachable by drifting.
 */
export function TimeMachine(props: {
	/** The session entry this message became — the address every action is sent to. */
	entryId: string;
	/** Whether the canvas is currently showing this point in history. Adds the way out. */
	previewing?: boolean;
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
}) {
	/*
	 * The prop, read through a memo of our own — and it is not a cache.
	 *
	 * `previewing` arrives as a compiled getter over an expression in `Stream`, and Solid
	 * creates that computation the first time anybody reads it. The first reader here was a
	 * row's click handler, which runs with no owner, so the computation was created with
	 * nothing to dispose it and Solid said so. Reading it once here, during render, puts it
	 * under this component's owner instead.
	 */
	const previewing = createMemo(() => props.previewing === true);

	/*
	 * The handle that closes the menu, captured on the way past.
	 *
	 * `Popover` owns `open` and only hands it to the trigger, so this is where a caller can
	 * get at it. The alternative was a second copy of the open state in here to drive it
	 * with, which is exactly the bug where the menu is gone and the button still looks
	 * pressed — one piece of state, in the component that does the placing.
	 */
	let dismiss: (() => void) | undefined;
	/*
	 * The menu goes first, and the act follows.
	 *
	 * The other way round, picking "Preview" set a signal that the menu's own rows read — the
	 * Restore row appears when a preview is up — and the row was recomputed inside an owner
	 * that the same batch had just disposed. Solid says so out loud ("computations created
	 * outside a `createRoot`"), and what it costs is a computation per pick that nothing will
	 * ever clean up. Closing first means the act lands on a menu that is already gone.
	 */
	const pick = (act: () => void) => {
		dismiss?.();
		act();
	};

	return (
		<Popover
			/*
			 * Above the button rather than below it. Both cover something — the column is a
			 * full-height stack of cards — and what is above a message is the history you have
			 * already read past, while below it is the newest turn and the reply you are
			 * probably waiting on. `Popover` flips it when there is no room above.
			 */
			placement="top-start"
			class="w-[min(268px,calc(100vw-32px))]"
			label="Go back to this message"
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return (
					<button
						class="stream-rw"
						type="button"
						ref={api.ref}
						data-open={api.open}
						aria-label="Go back to this message"
						aria-haspopup="menu"
						aria-expanded={api.open}
						title="Preview, rewind, fork or restore from this message"
						/*
						 * A press, and only a press. This used to preview on `mouseenter` and on
						 * `focus`, and put it back on the way out — which meant the canvas could
						 * change under a cursor that was on its way somewhere else, and a keyboard
						 * roving the transcript previewed every message it passed.
						 */
						onClick={api.toggle}
					>
						<Icon of={RotateCcw} size={12} />
					</button>
				);
			}}
		>
			<button
				type="button"
				data-row
				data-current={previewing()}
				onClick={() =>
					pick(() => {
						// Pressed while it is already the shown past: put the canvas back. Not the
						// only way out any more — the canvas has a badge with a Leave in it, and
						// Escape — but a control that cannot undo itself is still a bad control.
						props.onPreview(previewing() ? null : props.entryId);
					})
				}
			>
				<span class="ic">
					<Icon of={Eye} size={13} />
				</span>
				<span class="lb">{previewing() ? "Stop previewing" : "Preview"}</span>
				<span class="nt">Show the canvas as it was at this message. Nothing is written, and Escape puts it back.</span>
			</button>

			<button
				type="button"
				data-row
				onClick={() =>
					pick(() => {
						props.onPreview(null);
						props.onRewind(props.entryId);
					})
				}
			>
				<span class="ic">
					<Icon of={RotateCcw} size={13} />
				</span>
				<span class="lb">Rewind to here</span>
				<span class="nt">Take back everything after it — and these words go back into the input bar.</span>
			</button>

			<button
				type="button"
				data-row
				onClick={() =>
					pick(() => {
						props.onPreview(null);
						props.onFork(props.entryId);
					})
				}
			>
				<span class="ic">
					<Icon of={GitBranch} size={13} />
				</span>
				<span class="lb">Fork from here</span>
				<span class="nt">Keep this history and start a second agent from this point.</span>
			</button>

			{/*
			 * Restore, always — it is the fourth thing you can do to a point, not a reward for
			 * having previewed one.
			 *
			 * It used to appear only while a preview was up, on the argument that "keep this" is
			 * the obvious next thing to want once you are looking at the past. That argument was
			 * standing on the hover: previewing was free and constant, so "you are already
			 * looking at it" was the ordinary state of the menu. With one deliberate way in, a
			 * row that is usually not there is a row nobody knows about — and the menu stops
			 * being a list of what you can do to this message.
			 *
			 * Behind the rule, because this is the one that writes to the boards.
			 */}
			<div class="rule" />
			<button
				type="button"
				data-row
				onClick={() => pick(() => props.onRestore(props.entryId))}
			>
				<span class="ic">
					<Icon of={ArchiveRestore} size={13} />
				</span>
				<span class="lb">Restore</span>
				<span class="nt">Write the boards back to how they were here. The conversation stays where it is.</span>
			</button>
		</Popover>
	);
}

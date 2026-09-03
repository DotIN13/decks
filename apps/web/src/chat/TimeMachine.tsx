import ArchiveRestore from "lucide-solid/icons/archive-restore";
import Eye from "lucide-solid/icons/eye";
import GitBranch from "lucide-solid/icons/git-branch";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import { createMemo, createSignal, Show } from "solid-js";
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
 * had to hover a bubble to find. Three consequences worth the 22px:
 *
 * - The behaviour hover already had is *written down*. "Preview" is what pointing at the
 *   button does; a row that says so is the difference between a feature and an accident.
 * - A touchscreen can reach it at all. There is no hovering there, and this was the only
 *   route to the time machine.
 * - Each action gets a sentence. "Rewind" alone does not say that the words come back to
 *   the input bar, and that is the fact that decides whether you dare press it.
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
	/**
	 * A preview asked for by name, rather than one that follows the cursor.
	 *
	 * Pointing at the button previews and leaving puts it back — that is the cheap gesture
	 * and it should cost nothing to abandon. Picking the row means you want to *look*, so
	 * the preview outlives both the menu closing and the pointer leaving, and only an
	 * explicit act clears it again.
	 */
	const [held, setHeld] = createSignal(false);

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
			onOpenChange={(open) => {
				if (!open && !held()) props.onPreview(null);
			}}
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
						title="Preview, rewind, or fork from this message"
						/*
						 * Hovering previews, with no dwell delay: you only get here by reaching for
						 * the thing itself, so the reach is the intent. Focus does the same, which is
						 * what gives a keyboard the preview at all.
						 */
						onMouseEnter={() => props.onPreview(props.entryId)}
						onMouseLeave={() => {
							if (!api.open && !held()) props.onPreview(null);
						}}
						onFocus={() => props.onPreview(props.entryId)}
						onBlur={() => {
							if (!api.open && !held()) props.onPreview(null);
						}}
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
						// Pressed while it is already the shown past: put the canvas back. The row
						// is the only visible handle on a held preview, so it has to be able to
						// undo itself.
						if (previewing()) {
							setHeld(false);
							props.onPreview(null);
							return;
						}
						setHeld(true);
						props.onPreview(props.entryId);
					})
				}
			>
				<span class="ic">
					<Icon of={Eye} size={13} />
				</span>
				<span class="lb">{previewing() ? "Stop previewing" : "Preview"}</span>
				<span class="nt">Show the canvas as it was at this message. Hovering the button does this too.</span>
			</button>

			<button
				type="button"
				data-row
				onClick={() =>
					pick(() => {
						setHeld(false);
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
						setHeld(false);
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
			 * Only while a preview is up, and that is the point of it: restoring writes the
			 * boards back for real, and offering that beside "have a look" makes the reversible
			 * act and the permanent one the same size. Once you are looking at the past, "keep
			 * this" is the obvious next thing to want.
			 */}
			<Show when={previewing()}>
				<div class="rule" />
				<button
					type="button"
					data-row
					onClick={() =>
						pick(() => {
							setHeld(false);
							props.onRestore(props.entryId);
						})
					}
				>
					<span class="ic">
						<Icon of={ArchiveRestore} size={13} />
					</span>
					<span class="lb">Restore</span>
					<span class="nt">Write the boards back to how they were here. The conversation stays where it is.</span>
				</button>
			</Show>
		</Popover>
	);
}

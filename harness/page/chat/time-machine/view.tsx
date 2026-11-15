import ArchiveRestore from "lucide-solid/icons/archive-restore";
import Eye from "lucide-solid/icons/eye";
import GitBranch from "lucide-solid/icons/git-branch";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import { createMemo, For, Show } from "solid-js";
import { Icon } from "@decks/ui";
import { Popover } from "@decks/ui";
import { runAct } from "./actions.ts";
import { actRows, type Act } from "./model.ts";

// The way back to a message, on the message: a menu of preview, rewind, fork and restore.

/** The way back to a message, on the message. */
export function TimeMachine(props: {
	/** The session entry this message became, the address every action is sent to. */
	entryId: string;
	/** Whether the canvas is currently showing this point in history. Adds the way out. */
	previewing?: boolean;
	onPreview: (entryId: string | null) => void;
	onRewind: (entryId: string) => void;
	onFork: (entryId: string) => void;
	onRestore: (entryId: string) => void;
}) {
	/* The prop, read through a memo of our own, and it is not a cache. */
	const previewing = createMemo(() => props.previewing === true);

	/* The handle that closes the menu, captured on the way past. */
	let dismiss: (() => void) | undefined;
	return (
		<Popover
			/*
			 * Above the button rather than below it. Both cover something, the column is a full-height stack of
			 * cards, and what is above a message is the history you have already read past, while below it is
			 * the newest turn and the reply you are probably waiting on.
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
						 * A press, and only a press. This used to preview on `mouseenter` and on `focus`, and put it back
						 * on the way out, which meant the canvas could change under a cursor that was on its way
						 * somewhere else, and a keyboard roving the transcript previewed every message it passed.
						 */
						onClick={api.toggle}
					>
						<Icon of={RotateCcw} size={12} />
					</button>
				);
			}}
		>
			<For each={actRows(previewing())}>
				{(row) => (
					<>
						<Show when={row.act === "restore"}>
							<div class="rule" />
						</Show>
						<button type="button" data-row data-current={row.act === "preview" ? previewing() : undefined} onClick={() => runAct(row.act, props, previewing(), dismiss)}>
							<span class="row-icon">
								<Icon of={ICONS[row.act]} size={13} />
							</span>
							<span class="row-label">{row.label}</span>
							<span class="row-note">{row.note}</span>
						</button>
					</>
				)}
			</For>
		</Popover>
	);
}

const ICONS: Record<Act, typeof Eye> = { preview: Eye, rewind: RotateCcw, fork: GitBranch, restore: ArchiveRestore };

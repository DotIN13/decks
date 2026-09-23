import type { Identity } from "@decks/protocol";
import PictureInPicture2 from "lucide-solid/icons/picture-in-picture-2";
import SquarePen from "lucide-solid/icons/square-pen";
import X from "lucide-solid/icons/x";
import { createSignal, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { AgentEdit } from "./AgentEdit.tsx";
import { Icon } from "../ui/icons.tsx";
import { AgentFace } from "./AgentPill.tsx";
import { closeWords, since, statusWords } from "./agent-order.ts";
import { canHover } from "../lib/media.ts";
import type { AgentRow as Row } from "./agent-sections.ts";

/**
 * One agent in the panel's Agents tab, in one of two heights.
 *
 * It was four lines (name; state; workspace and tags; the last thing said), about 90px a row,
 * and the panel held eight. Now:
 *
 * - **one line**: face, name, runtime, time. The face's ring is the state, and the hover card
 *   the panel draws beside the row says the rest.
 * - **two lines**: the same, and under it what the agent is doing when it is asking, working
 *   or finished unread, or else the last thing it said, the way a chat list shows a message.
 *
 * The square beside the search switches the two. The time gives its column to the buttons
 * when the row is approached, and on a touch screen they are always there.
 */
export function AgentRow(props: {
	row: Row;
	identity: Identity | undefined;
	onFocus: () => void;
	onClose: () => void;
	/** Replace *your* tags on this agent. Absent means the row cannot be customised. */
	onTags?: (tags: string[]) => void;
	/**
	 * Put a live view of this agent's conversation on the canvas.
	 *
	 * Here rather than only on the conversation you are reading, because the better half of
	 * a mirror is the agent you are *not* talking to — and this list is where you are
	 * looking at them. Absent means the row cannot be mirrored.
	 */
	onMirror?: () => void;
	/**
	 * Move this agent into a workspace, or out of one with `null`.
	 *
	 * Both writers of this field land on the same value — the agent through
	 * `stage.me.setWorkspace`, you through here — so this is not "your workspace" the way the
	 * tags beside it are yours. Absent means the row cannot be moved.
	 */
	onWorkspace?: (workspace: string | null) => void;
	/**
	 * Rename this agent — the same field `stage.me({ name })` writes.
	 *
	 * Yours as well as the agent's, because a chat called `Agent 3` is a chat you should be
	 * able to name without asking it to name itself. Absent means the window's name field is
	 * a label.
	 */
	onRename?: (name: string) => void;
	/**
	 * Every workspace in use, for the popup's suggestions.
	 *
	 * The one thing that stops this feature's likeliest failure — a second spelling of a
	 * project that already exists — so the names in use are offered as a `datalist` rather than
	 * left to memory. Read off the identities the panel already holds; no extra fetch.
	 */
	workspaces?: string[];
	/** Whether another agent already answers to a name, for the window's red line. */
	taken?: (name: string) => boolean;
	/** One line (name, runtime, time) or two (and what it is doing); the panel's square switches them. */
	lines: 1 | 2;
	/** The pointer or focus arrived on the row (its box) or left it (`undefined`), for the hover card. */
	onHover?: (at: DOMRect | undefined) => void;
}) {
	const chat = () => props.row.chat;
	const name = () => props.identity?.name ?? chat().name;
	/** Whether this row's edit window is open. One per row, and only the open one is drawn. */
	const [editing, setEditing] = createSignal(false);
	/** Off the row, where `agent-sections.ts` put it — one source for one fact, like the tags. */
	const workspace = () => props.row.workspace;
	/** The tooltip if this agent can be closed, and `undefined` if it cannot. */
	const close = () => closeWords(chat().state, name());

	/*
	 * The state, and on a touch screen the time with it.
	 *
	 * A pointer keeps the time where the card puts it — the right end of the name line — and
	 * gives that column up to the two buttons when the row is approached. A finger has no
	 * "approach", so those buttons are drawn on every row at all times and the column is
	 * never free; the time rides down here instead of being lost.
	 *
	 * Read once rather than watched: a machine does not change from a trackpad to a
	 * touchscreen mid-session, and `CanvasOps` reads it the same way.
	 */
	const touch = !canHover();
	/** Worth a line of its own: asking, working, or finished and unread. */
	const busy = () => !chat().dormant && props.row.status !== "idle";
	const stateWords = () => {
		const base = chat().dormant ? "Dormant" : statusWords(props.row.status, chat().state);
		return touch && chat().lastAt !== undefined ? `${base} · ${since(chat().lastAt)}` : base;
	};

	return (
		/*
		 * `.row-act` is the box the row and its × share, because a `<button>` cannot contain
		 * one — the same arrangement the dropdown row and the account row use, and the reason
		 * the wash belongs to the box rather than to the button inside it.
		 */
		<div class="agent-row row-act" data-lines={props.lines} data-current={props.row.current} data-status={props.row.status} data-dormant={chat().dormant ? "true" : undefined}>
			<button
				type="button"
				class="min-w-0 flex-1"
				data-row
				data-agent="true"
				data-current={props.row.current ? "true" : undefined}
				title={props.row.current ? `${name()} — the conversation on screen` : `Switch to ${name()}`}
				onClick={props.onFocus}
				onPointerEnter={(event) => canHover() && props.onHover?.(event.currentTarget.getBoundingClientRect())}
				onPointerLeave={() => props.onHover?.(undefined)}
				onFocus={(event) => props.onHover?.(event.currentTarget.getBoundingClientRect())}
				onBlur={() => props.onHover?.(undefined)}
				/* Delete closes it, for the keyboard, exactly as the dropdown row does. */
				onKeyDown={(event) => {
					if (event.key !== "Delete" && event.key !== "Backspace") return;
					event.preventDefault();
					event.stopPropagation();
					if (close()) props.onClose();
				}}
			>
				{/*
					28px, where the dropdown's is 20: this is the one place an agent's own drawing is
					worth seeing at a size, and several on this deck have drawn one.

					Wrapped in `.row-icon`, which is the row vocabulary's icon slot and not decoration —
					`[data-row]:not(:has(> .row-icon))` collapses the grid to a single column, so without
					it the avatar and the name stacked instead of sitting side by side.
				*/}
				<span class="row-icon">
					<AgentFace chat={chat()} identity={props.identity} unread={props.row.unread} size={props.lines === 1 ? 20 : 26} ring={props.lines === 1 ? 1.5 : 1.75} />
				</span>

				<span class="agent-body">
					<span class="agent-line">
						<span class="row-label block truncate">{name()}</span>
						<span class="kind" data-dormant={chat().dormant ? "true" : undefined}>{chat().kind}</span>
						<span class="ago meta tabular-nums" data-yield>{since(chat().lastAt)}</span>
					</span>

					{/*
						The second line, only in the two-line view: what it is doing while that is
						worth knowing, and otherwise the last thing it said. Tags and the workspace
						are not on the row any more: the section heading names the workspace, the
						search still matches both, and the edit window shows them.
					*/}
					<Show when={props.lines === 2}>
						<Show when={busy() || !chat().lastLine} fallback={<span class="agent-said">{chat().lastLine}</span>}>
							<span class="agent-state">
								<span class="agent-swatch" data-status={props.row.status} aria-hidden="true" />
								<span class="min-w-0 flex-1 truncate">{stateWords()}</span>
							</span>
						</Show>
					</Show>
				</span>
			</button>

			{/*
				Edit this agent: the pen, and a window rather than a popover.
				
				Inside `.row-act` and *not* a `[data-row]`, for the reason the × is not one: this
				list is roved by the arrow keys, and a second stop per row would double every
				journey through it. It is reachable by Tab from the row instead.

				The window is in a `Portal` because the panel is a scrolling column with its own
				`overflow`, and a modal drawn inside one is a modal clipped to a 264px strip.
			*/}
			<Show when={props.onTags}>
				{(onTags) => (
					<>
						<button
							class="agent-tagbtn"
							type="button"
							data-on={editing() || undefined}
							title={`Edit ${name()}`}
							aria-label={`Edit ${name()}: name, workspace and tags`}
							onClick={(event) => {
								event.stopPropagation();
								setEditing(true);
							}}
						>
							{/*
								A pen, at the × beside it: 13px, the same stroke, the same 20px slot.
								It was a `+`, which said *add one more* — right for a row of chips you
								are appending to, wrong for the only control on a row that opens a
								thing you edit.
							*/}
							<Icon of={SquarePen} size={13} />
						</button>
						<Show when={editing()}>
							<Portal>
								<AgentEdit
									agentId={chat().id}
									name={name()}
									userTags={props.row.userTags}
									face={<AgentFace chat={chat()} identity={props.identity} size={22} ring={1.5} />}
									{...(props.taken ? { taken: props.taken } : {})}
									{...(workspace() ? { workspace: workspace() } : {})}
									workspaces={props.workspaces ?? []}
									onRename={(next) => props.onRename?.(next)}
									onTags={onTags()}
									onWorkspace={(next) => props.onWorkspace?.(next)}
									onClose={() => setEditing(false)}
								/>
							</Portal>
						</Show>
					</>
				)}
			</Show>

			{/*
				**Absent, rather than disabled, on an agent that cannot be closed.** The registry
				refuses anything mid-turn and the row already says "running tools…" — a control
				that cannot be pressed is worth drawing when its absence would be a mystery, and
				this is not a mystery.
			*/}
			{/*
				A mirror, beside the ×, and revealed by the same hover.

				It shares `.close`'s styling deliberately: these are both things you can do
				*to* the row rather than parts of what the row says, and a second vocabulary
				for the second one would only be a second thing to keep in step.

				`agent-mirrorbtn` is the one thing that has to be its own name. `.agent-list` lays these
				buttons out by hand — they are out of the flow, so nothing else can — and "which slot
				is this one in" is asked of the class. Without it the mirror took the ×'s slot.
			*/}
			<Show when={props.onMirror}>
				{(mirror) => (
					<button
						class="close agent-mirrorbtn"
						type="button"
						title={`Put ${name()}'s conversation on the canvas`}
						aria-label={`Mirror ${name()} on the canvas`}
						onClick={(event) => {
							event.stopPropagation();
							mirror()();
						}}
					>
						<Icon of={PictureInPicture2} size={13} />
					</button>
				)}
			</Show>
			<Show when={close()}>
				{(words) => (
					<button
						class="close"
						type="button"
						title={words()}
						aria-label={`Close ${name()}`}
						onClick={(event) => {
							event.stopPropagation();
							props.onClose();
						}}
					>
						<Icon of={X} size={13} />
					</button>
				)}
			</Show>
		</div>
	);
}


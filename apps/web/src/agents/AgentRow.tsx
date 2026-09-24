import type { Identity } from "@decks/protocol";
import PictureInPicture2 from "lucide-solid/icons/picture-in-picture-2";
import SquarePen from "lucide-solid/icons/square-pen";
import X from "lucide-solid/icons/x";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { Portal } from "solid-js/web";
import { AgentEdit } from "./AgentEdit.tsx";
import { Icon } from "../ui/icons.tsx";
import { AgentFace } from "./AgentPill.tsx";
import { closeWords, rowWords, since, statusWords } from "./agent-order.ts";
import { canHover } from "../lib/media.ts";
import type { AgentRow as Row } from "./agent-sections.ts";

/**
 * One agent in the panel's Agents tab, in one of two heights.
 *
 * It was four lines (name; state; workspace and tags; the last thing said), about 90px a row,
 * and the panel held eight. Now:
 *
 * - **one line**: face, name, runtime, and what it is doing. The face's ring is the state too,
 *   and the hover card the panel draws beside the row says the rest.
 * - **two lines**: the same, and under it the tags it is working under, or the last thing it
 *   said when it has none, the way a chat list shows a message.
 *
 * **The state is where the time used to be, and the tags are where the last words used to be.**
 * The time on its own answered a question nobody had — `4m` says an agent is quiet but not
 * whether it is quiet *waiting for an answer* — so the right-hand column now reads `waiting for
 * you`, `running tools…` or `idle · 2h`, which is the state and the time in the same width. The
 * state has left the second line with it, so the line below can say what the agent is working
 * on rather than repeating the line above.
 *
 * The square beside the search switches the two heights. The state gives its column to the
 * buttons when the row is approached, and on a touch screen they are always there — so there
 * the state rides on the second line instead, the one column a finger never covers.
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
	/** Asking, working, or finished and unread: worth a swatch, and worth reading before the name's time. */
	const busy = () => !chat().dormant && props.row.status !== "idle";
	const stateWords = () => {
		const base = chat().dormant ? "Dormant" : statusWords(props.row.status, chat().state);
		return touch && chat().lastAt !== undefined ? `${base} · ${since(chat().lastAt)}` : base;
	};
	/**
	 * The state in the register a 264px row can afford: `waiting for you`, `idle · 2h`.
	 *
	 * `rowWords` is the agent dropdown's own wording, so two lists of the same agents cannot come
	 * to describe one differently. It carries the time itself where the time is the interesting
	 * half of the answer, which is why nothing else on the row carries one.
	 *
	 * **A dormant agent reads `dormant · 2h`**, in the shape an idle one reads: the state and when
	 * it last ran, which are two different questions and both worth answering in the width there
	 * is. Dormant rather than idle because both are true and only one of them explains why
	 * nothing is happening — the runtime behind this one is not running at all.
	 */
	const shortState = () => {
		if (!chat().dormant) return rowWords(props.row.status, chat().state, chat().lastAt);
		return chat().lastAt === undefined ? "dormant" : `dormant · ${since(chat().lastAt)}`;
	};

	/**
	 * The tags on the second line: the agent's own first, then yours — what it says it is doing,
	 * then what you say it is, which is the hover card's order and its reasoning.
	 *
	 * Two, then `+n`. A row is scanned rather than read, and chips that wrapped would make the
	 * rows different heights, which is the one thing a list you scan cannot have.
	 */
	const TAGS = 2;
	/*
	 * Read off the **identity**, not off `row.tags`, and that is not a preference.
	 *
	 * The panel keeps its rows in a store and updates them with `reconcile`, so that a state
	 * change writes a word on one row instead of rebuilding the list (`LeftPanel`). Reconciling
	 * an array of plain strings does not notify a reader of that array: measured, a tag arriving
	 * reached `row.tags` — the panel's search matched it at once — and the row went on drawing
	 * the last thing the agent said until something else redrew it. `identities[id]` is the
	 * object `agent-sections.ts` copies those tags *from*, it is reconciled as an object, and
	 * reading it here is both reactive and one hop closer to the source.
	 */
	const tags = () => [
		...(props.identity?.tags ?? props.row.tags).map((text) => ({ text, mine: false })),
		...(props.identity?.userTags ?? props.row.userTags).map((text) => ({ text, mine: true })),
	];
	/**
	 * What the second line says: the tags, else the last thing said.
	 *
	 * Except on a touch screen, where the buttons hold the first line's right-hand column at all
	 * times — there a busy agent spends the second line saying so, because that is the only place
	 * left to say it, and a quiet one falls through to the same two answers as everywhere else.
	 */
	const second = (): "state" | "tags" | "said" | "none" => {
		if (touch && busy()) return "state";
		if (tags().length > 0) return "tags";
		if (chat().lastLine) return "said";
		return touch ? "state" : "none";
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
					26px on a two-line row and 20 on a one-line one, where the dropdown's is 20: this is
					the one place an agent's own drawing is worth seeing at a size.

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
						{/*
								Where the time was. `data-yield` is what hands this column to the buttons on
								approach (`chrome.css`), and it is the column the hover card puts its own
								time in — so the card reads as this row with more room.
							*/}
							<span class="ago meta tabular-nums" data-yield data-busy={busy() ? "true" : undefined} title={stateWords()}>
								<Show when={busy()}>
									<span class="agent-swatch" data-status={props.row.status} aria-hidden="true" />
								</Show>
								<span class="truncate">{shortState()}</span>
							</span>
					</span>

					{/*
						The second line, only in the two-line view: what this agent is working
						under, and the last thing it said when it is working under nothing. Not the
						workspace — the section heading above the row names it — and the search
						still matches every one of these whether the row draws it or not.
					*/}
					<Show when={props.lines === 2}>
						<Switch>
							<Match when={second() === "tags"}>
								<span class="tags agent-tags">
									<For each={tags().slice(0, TAGS)}>
										{(tag) => (
											<span class="tag" data-mine={tag.mine ? "true" : undefined} title={tag.mine ? `Your tag: ${tag.text}` : `${name()} is working on ${tag.text}`}>
												{tag.text}
											</span>
										)}
									</For>
									<Show when={tags().length > TAGS}>
										<span class="tag-more" title={tags().slice(TAGS).map((tag) => tag.text).join(", ")}>
											+{tags().length - TAGS}
										</span>
									</Show>
								</span>
							</Match>
							<Match when={second() === "said"}>
								<span class="agent-said">{chat().lastLine}</span>
							</Match>
							<Match when={second() === "state"}>
								<span class="agent-state">
									<span class="agent-swatch" data-status={props.row.status} aria-hidden="true" />
									<span class="min-w-0 flex-1 truncate">{stateWords()}</span>
								</span>
							</Match>
						</Switch>
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


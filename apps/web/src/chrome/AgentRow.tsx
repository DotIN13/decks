import type { Identity } from "@decks/protocol";
import SquarePen from "lucide-solid/icons/square-pen";
import X from "lucide-solid/icons/x";
import { createSignal, For, onMount, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { Popover } from "../ui/Popover.tsx";
import { AgentFace } from "./AgentPill.tsx";
import { closeWords, since, statusWords } from "./agent-order.ts";
import { canHover } from "../lib/panels.ts";
import type { AgentRow as Row } from "./agent-sections.ts";

/**
 * One agent in the panel's Agents tab: **the hover card, laid flat.**
 *
 * It was four stacked things in four type sizes — a name line, a status line with its own
 * dot and sentence, a row of tags, and two clamped lines of italic quotation — five times
 * down the panel, and it read as a heap.
 *
 * The fix was not to invent a shape but to take one that was already right: `AgentHoverCard`
 * is the same five facts about the same object and nobody has complained about it. So this
 * row is that card's four lines, in the panel's width:
 *
 * 1. **the name**, with its runtime beside it and the time at the right
 * 2. **the state** — swatch, then the word
 * 3. **the tags**, when there are any
 * 4. **the last thing it said**, one line
 *
 * The runtime sits with the name rather than in the right-hand column, which is the one
 * place this parts from the card: `Rune claude` is one thing being identified, and the card
 * can afford to spread that over two lines where a 264px row reads it better as a phrase.
 *
 * What is different from the card is what a *list* has to do: the time gives its column to
 * the two buttons — `+` for your tags, × to close — when the row is approached, and on a
 * touch screen they are simply always there. The card has neither, because a card is
 * something you read and a row is something you act on.
 */
export function AgentRow(props: {
	row: Row;
	identity: Identity | undefined;
	onFocus: () => void;
	onClose: () => void;
	/** Replace *your* tags on this agent. Absent means the row cannot be customised. */
	onTags?: (tags: string[]) => void;
}) {
	const chat = () => props.row.chat;
	const name = () => props.identity?.name ?? chat().name;
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
		<div class="agent-row row-act" data-current={props.row.current} data-status={props.row.status} data-dormant={chat().dormant ? "true" : undefined}>
			<button
				type="button"
				class="min-w-0 flex-1"
				data-row
				data-agent="true"
				data-current={props.row.current ? "true" : undefined}
				title={props.row.current ? `${name()} — the conversation on screen` : `Switch to ${name()}`}
				onClick={props.onFocus}
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

					Wrapped in `.ic`, which is the row vocabulary's icon slot and not decoration —
					`[data-row]:not(:has(> .ic))` collapses the grid to a single column, so without
					it the avatar and the name stacked instead of sitting side by side.
				*/}
				<span class="ic">
					<AgentFace chat={chat()} identity={props.identity} unread={props.row.unread} size={28} ring={1.75} />
				</span>

				<span class="agent-body">
					{/*
						The card's first line: the name, and how long ago in the right-hand column.

						`data-yield` gives that column up when the row is approached — the two buttons
						arrive where the time was, rather than a 44px gutter standing empty down the
						whole list. On a touch screen the buttons are always there and the time is not:
						see `chrome.css`, where both halves of that live.
					*/}
					<span class="agent-line">
						<span class="lb block truncate">{name()}</span>
						<span class="kind" data-dormant={chat().dormant ? "true" : undefined}>{chat().kind}</span>
						<span class="ago meta tabular-nums" data-yield>{since(chat().lastAt)}</span>
					</span>

					{/*
						And the card's second line: the state in words, beside its swatch.

						One word for a parked agent, where the card would say "Idle": dormant is the
						reason nothing is happening, and it is not the same claim.
					*/}
					<span class="agent-state">
						<span class="agent-swatch" data-status={props.row.status} aria-hidden="true" />
						<span class="min-w-0 flex-1 truncate">{stateWords()}</span>
					</span>

					<Show when={props.row.tags.length + props.row.userTags.length > 0}>
						<span class="tags">
							<For each={props.row.tags}>{(tag) => <span class="tag">{tag}</span>}</For>
							<For each={props.row.userTags}>{(tag) => <span class="tag" data-mine="true">{tag}</span>}</For>
						</span>
					</Show>

					{/*
						The last thing it said — one line, no quotation marks, no italics.
						
						It was two clamped lines in italic inside curly quotes, which is three
						decorations on the least important thing in the row. A chat list does not
						quote the message either: its position under the name is what says whose it
						is.
					*/}
					<Show when={chat().lastLine}>{(line) => <span class="agent-said">{line()}</span>}</Show>
				</span>
			</button>

			{/*
				Your own tags, behind a `+`.

				Inside `.row-act` and *not* a `[data-row]`, for the reason the × is not one: this
				list is roved by the arrow keys, and a second stop per row would double every
				journey through it. It is reachable by Tab from the row instead.
			*/}
			<Show when={props.onTags}>
				{(onTags) => <Customise name={name()} tags={props.row.userTags} onTags={onTags()} />}
			</Show>

			{/*
				**Absent, rather than disabled, on an agent that cannot be closed.** The registry
				refuses anything mid-turn and the row already says "running tools…" — a control
				that cannot be pressed is worth drawing when its absence would be a mystery, and
				this is not a mystery.
			*/}
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

/**
 * Your tags on an agent, in a popup.
 *
 * A separate list from the agent's, which is the point rather than an implementation detail:
 * `stage.me.setTags` **replaces**, so one shared list would mean the agent's next call
 * silently deleted what you typed. They are stored in `Identity.userTags`, drawn outlined
 * where the agent's are filled, and the agent cannot read them — `stage.agents()` reports
 * `tags` and not `userTags`, because what you think of an agent is not something it should
 * be steering on.
 *
 * **No Save.** Every change is sent, as everything else in this app is; a popup with a Save
 * button is a popup you can leave in a state that looks applied and is not.
 */
function Customise(props: { name: string; tags: string[]; onTags: (tags: string[]) => void }) {
	const [draft, setDraft] = createSignal("");
	let entry: HTMLInputElement | undefined;

	/*
	 * Take the cursor when the popup opens — not when this component mounts.
	 *
	 * Three things were tried and the first two were wrong for the same reason. `autofocus`
	 * is an attribute the browser only acts on for nodes present at page load. `onMount`
	 * looked right and fired at the wrong moment: this component mounts with the **row**,
	 * and `Popover` renders its children only while open, so the input did not exist yet and
	 * the ref was undefined.
	 *
	 * So it hangs off `onOpenChange`, one frame later because the card is measured and placed
	 * after it mounts. Until this worked, focus stayed on the trigger: the first keystroke
	 * went to a button and the first Enter re-pressed it, closing the popup somebody had just
	 * opened in order to type into it.
	 */
	const focusEntry = () => requestAnimationFrame(() => entry?.focus());

	/*
	 * Split on **commas only**, not on whitespace.
	 *
	 * Splitting on both looked more generous and was wrong: a tag may contain spaces, which
	 * the server turns into hyphens — so `Panel CSS` is one tag called `panel-css`, and
	 * whitespace-splitting turned it into two called `panel` and `css`. A comma is the only
	 * separator somebody types deliberately.
	 *
	 * Nothing else is validated here. The server slugs, dedupes and caps whatever arrives
	 * (`agents/tags.ts`), and two places deciding what a tag may be is how they come to
	 * disagree — what comes back on the next `agent.identity` is the truth.
	 */
	const add = () => {
		const wanted = draft()
			.split(",")
			.map((part) => part.trim())
			.filter(Boolean);
		if (wanted.length === 0) return;
		setDraft("");
		props.onTags([...props.tags, ...wanted]);
	};

	return (
		<Popover
			placement="bottom-end"
			class="w-[228px]"
			label={`Your tags for ${props.name}`}
			onOpenChange={(open) => open && focusEntry()}
			trigger={(api) => (
				<button
					class="agent-tagbtn"
					type="button"
					ref={api.ref}
					data-on={api.open || undefined}
					title={`Your own tags for ${props.name}`}
					aria-label={`Your own tags for ${props.name}`}
					onClick={(event) => {
						event.stopPropagation();
						api.toggle();
					}}
				>
					{/*
						A pen, at the × beside it: 13px, the same stroke, the same 20px slot.
						
						It was a `+`, which said *add one more* — right for a row of chips you are
						appending to, wrong for the only control on a row that opens a thing you edit.
						And at 12px it sat a pixel light next to a 13px ×, which is the sort of
						difference nobody names and everybody sees.
					*/}
					<Icon of={SquarePen} size={13} />
				</button>
			)}
		>
			<div class="tagpop">
				<div class="label">Your tags for {props.name}</div>

				<Show
					when={props.tags.length > 0}
					fallback={<p class="nt m-0">None yet. These are yours — the agent cannot see or overwrite them.</p>}
				>
					<div class="tags">
						<For each={props.tags}>
							{(tag) => (
								<span class="tag" data-mine="true">
									{tag}
									<button
										type="button"
										class="tag-x"
										title={`Remove ${tag}`}
										aria-label={`Remove ${tag}`}
										onClick={() => props.onTags(props.tags.filter((other) => other !== tag))}
									>
										<Icon of={X} size={9} />
									</button>
								</span>
							)}
						</For>
					</div>
				</Show>

				{/*
					Focused on mount, not with `autofocus`.
					
					The attribute only acts on a node present at page load; this one is created when
					the popover opens, so it did nothing and the first keystroke went to the
					document. The popup exists to be typed into — one that opens with the cursor
					elsewhere costs a click to use.
				*/}
				{/*
					`flex-none` is load-bearing here, exactly as it is in the panel's header.

					`.field` carries `flex: 1` for the inspector's row of four, where it grows
					sideways. `.tagpop` is a flex *column*, so that grow is vertical and a
					`flex-basis: 0` beats a stated height — the field measured its input's
					min-content and came out 18px instead of 32.
				*/}
				<label class="field h-8 flex-none gap-1.5 rounded-md">
					<input
						ref={entry}
						type="text"
						spellcheck={false}
						class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint"
						placeholder="Add a tag…"
						value={draft()}
						onInput={(event) => setDraft(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								/* `Popover` reads Enter off the document and presses the roved row with it.
								   There is no row in here to press, but a keystroke that means "add this
								   tag" should not also be travelling to a menu's key handler. */
								event.stopPropagation();
								add();
							}
							// Backspace on an empty field takes the last one off, which is what every
							// tag field does and what a hand reaches for without being told.
							if (event.key === "Backspace" && !draft() && props.tags.length > 0) {
								event.preventDefault();
								props.onTags(props.tags.slice(0, -1));
							}
						}}
					/>
				</label>
				<p class="nt m-0">Four at most, lowercased and hyphenated. ⏎ to add.</p>
			</div>
		</Popover>
	);
}

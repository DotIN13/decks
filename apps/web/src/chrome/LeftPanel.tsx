import type { Board } from "@decks/protocol";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import Rows3 from "lucide-solid/icons/rows-3";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { BoardRow, BoardTile } from "./BoardRow.tsx";
import { panelSections, panelTally } from "./panel-groups.ts";
import type { AgentChat, Identity } from "@decks/protocol";
import { AgentRow } from "./AgentRow.tsx";
import { agentFoot, agentSections, agentTally } from "./agent-sections.ts";

/**
 * The left panel: one surface, **one list**, and a button that makes it go away.
 *
 * It replaces three things. The floating context rail, the floating agents panel and the
 * full-screen `AllBoards` modal all answered "what is on this canvas, and what else is
 * there" — and the first two could not be open at once because `lib/panels.ts` closed one
 * when the other opened. That is a tab strip with the strip left out: the relationship was
 * enforced in code and invisible on screen, which is why the third surface had nowhere to
 * live and became a modal over the canvas you were looking at.
 *
 * For a while the answer was a real tab strip: **Context** and **Deck**. That was one
 * surface too few and one list too many — everything in Context was also in Deck, so the two
 * tabs were the same list with a line drawn through it, and finding a board began with
 * guessing which side of the line the app had put it on *this second*.
 *
 * So there is one scroller with three headings in it — **on the canvas**, **held, not
 * shown**, **in the deck** — and one search field over all of it. `panel-groups.ts` owns the
 * grouping and argues it; what is left here is the surface. Agents were never a tab either:
 * a list you switch *with* is a selector, and it hangs off the thing it selects (the avatar
 * in the top-left pill).
 *
 * The first two sections are the **focused agent's**, all of them and nothing else — no
 * other agent's holdings appear anywhere, and a board somebody else is holding is simply in
 * the deck like any other. So nothing on this screen has to ask whose a row is.
 *
 * ### Folded means gone
 *
 * The panel is opened and closed by a **button** — the leftmost control in the top-left
 * pill, which owns `open` and passes it in here — and by `⌘\`. It is not summoned by the
 * cursor coming near the edge, which is what `lib/panels.ts` used to do: a surface you rely
 * on to know what an agent is holding should not arrive because of where the mouse happens
 * to be, and a button that disagrees with the screen is worse than no button.
 *
 * And **there is no 40px strip**. An earlier draft folded to one, holding the two tab icons
 * and a chevron, on the argument that a panel which disappears entirely is a keyboard
 * shortcut you have to remember. That argument dies with the hover: the strip existed
 * because a hover-summoned panel needed something to aim at, and **a button is that
 * something**. Folded, this component draws nothing at all — which is also what makes the
 * camera correct for free, since `lib/insets.ts` measures what is in the document and an
 * absent panel measures nothing.
 *
 * It must stay *mounted* while folded, though, because `⌘\` is registered here. Wrapping the
 * call site in a `<Show>` would take the shortcut away in exactly the state it is needed.
 *
 * ### Beside the canvas, or over it
 *
 * Under 1100px the panel is a **sheet** over the canvas rather than a panel beside it, and a
 * sheet must not carry `data-inset` — subtracting one fitted a 1600px board into the strip
 * beside it at 3.7%. That is why the breakpoint is a signal read from `matchMedia` rather
 * than a `@media` block: it changes which *attribute* is rendered, not only how the thing
 * looks, and CSS cannot tell the camera anything.
 *
 * The sheet starts under the pill instead of at the top of the window, so the button that
 * opened it is still there to close it. A sheet that covers its own dismiss control is a
 * trap, and on a 390px phone it would cover it by 250px.
 *
 * ### Presentational
 *
 * No socket, no app state: boards in, `onPick` out. The panel is a picture of what it is
 * given, and everything with a rule behind it — which board is in which section, what the
 * search matches — is in `panel-groups.ts`, where it can be tested without a DOM.
 */

/** How the list draws each board: a line, or a picture with a caption. */
export type Density = "list" | "grid";

/**
 * Which list the panel is showing.
 *
 * Two genuinely different collections, which is what makes a strip defensible here — see the
 * note on the `chats` prop.
 */
export type PanelTab = "boards" | "agents";

/** Below this the panel cannot stand beside the canvas, so it goes over it. */
const SHEET = 1100;

export function LeftPanel(props: {
	/** Every board there is. The list is all of them, in three sections. */
	boards: Board[];
	/** The board the canvas is centred on. */
	current?: string;
	/** The focused agent's in-play set: what is actually on the canvas. */
	inPlay?: string[];
	/** Agent id → the paths it holds, in attach order. `focused` picks this apart. */
	holdings: Record<string, string[]>;
	/** Whose canvas and shelf the first two sections are. */
	focused?: string;
	/** Folded is gone. Owned by the pill's button, so the two can never disagree. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * How the list draws its boards. Uncontrolled when absent.
	 *
	 * One setting for one list. It used to be remembered per tab — seven boards an agent
	 * chose are worth seeing as pictures and seventy-eight are not — and with the tabs gone
	 * that argument goes with them: the sections are the same list, and a density that
	 * changed halfway down it would be two lists again.
	 */
	density?: Density;
	onDensity?: (density: Density) => void;
	onPick: (board: Board) => void;
	/**
	 * Delete a board's file. Absent means no row has a delete on it.
	 *
	 * Every row has it, in all three sections: a board is a board wherever it is listed, and
	 * a rule that depends on which heading it is under is a rule to remember. The row does
	 * the asking — two presses, `BoardRow.tsx` — so by the time this is called it has been
	 * said twice.
	 *
	 * The grid has none: a tile is `RailItem`, the same component the canvas uses, and a
	 * destructive control there would be one on the thumbnails as well.
	 */
	onDelete?: (board: Board) => void;
	/** What is typed, for a caller that wants to keep it — `⌘K` opening on a query, say. */
	onSearch?: (query: string) => void;
	/**
	 * A stamp that means "find a board now": take the cursor into the search field.
	 *
	 * `⌘K` is the caller. A stamp rather than a boolean because pressing it twice in a row
	 * is two requests, and a flag would make the second one look like a state the panel was
	 * already in — the same reason `draft` and `scrollTo` carry one.
	 */
	findAt?: number;

	// --- the Agents tab ---------------------------------------------------------------
	/**
	 * Every chat, for the second tab.
	 *
	 * A tab strip is back, and it is not the one that was removed. **Context** and **Deck**
	 * were one collection with a line drawn through it — everything in Context was also in
	 * Deck, so finding a board began by guessing which side the app had put it on this
	 * second. Boards and agents overlap in *nothing*: no agent is in the boards list and no
	 * board is in the agents list, so the invariant that mattered — every item appears
	 * exactly once — stays true trivially rather than by argument.
	 */
	chats?: AgentChat[];
	identities?: Record<string, Identity>;
	unread?: Record<string, number>;
	onFocusAgent?: (id: string) => void;
	onCloseAgent?: (id: string) => void;
	/** Replace *your* tags on an agent. Absent means no row can be customised. */
	onAgentTags?: (id: string, tags: string[]) => void;
}) {
	const ids = createUniqueId();
	const [ownDensity, setOwnDensity] = createSignal<Density>("list");
	const [query, setQuery] = createSignal("");
	const [tab, setTab] = createSignal<PanelTab>("boards");
	const sheet = createSheet();

	/*
	 * Switching tabs clears the query.
	 *
	 * The one thing the old strip got right, and it was right for a reason that applies here
	 * and did not apply there: the two lists differ, so a query left over from the other one
	 * is a filter whose cause is off screen. Between Context and Deck it was the same list
	 * either way, which is why the strip went.
	 */
	const goTab = (next: PanelTab) => {
		if (next === tab()) return;
		setTab(next);
		setQuery("");
		props.onSearch?.("");
	};

	const agents = () =>
		agentSections({
			chats: props.chats ?? [],
			identities: props.identities ?? {},
			unread: props.unread ?? {},
			focused: props.focused,
			query: query(),
		});
	/** Every agent, unfiltered — what the foot counts and the placeholder says. */
	const allAgents = () => agentTally(agentSections({ chats: props.chats ?? [], identities: props.identities ?? {}, unread: props.unread ?? {}, focused: props.focused }));

	const density = () => props.density ?? ownDensity();
	let list: HTMLDivElement | undefined;
	let field: HTMLInputElement | undefined;

	/* `⌘K` used to open a tab as well as take the cursor. There is one list now, so finding
	   a board is typing at it — and the query it lands on is whatever was already there. */
	createEffect(() => {
		if (!props.findAt) return;
		// Next frame, or there is nothing to focus yet on a panel that was closed.
		requestAnimationFrame(() => {
			field?.focus();
			field?.select();
		});
	});

	const goDensity = (next: Density) => {
		setOwnDensity(next);
		props.onDensity?.(next);
	};
	const type = (next: string) => {
		setQuery(next);
		props.onSearch?.(next);
	};

	const sections = createMemo(() =>
		panelSections({
			boards: props.boards,
			focused: props.focused,
			holdings: props.holdings,
			inPlay: props.inPlay,
			query: query(),
		}),
	);
	const tally = createMemo(() => panelTally(sections()));

	/*
	 * `⌘\`, and the one guard it needs.
	 *
	 * Registered on the document rather than the panel, because the point of it is to work
	 * from the canvas — and it fires whether the panel is open or shut, which is the half a
	 * shortcut usually forgets. Not while a text field has focus: the dock's composer is a
	 * textarea that people type into for whole paragraphs, and a chord that folds the chrome
	 * on the way past a backslash is a chord that fires on a typo. `Escape` leaves this
	 * panel's own search field, which is how you get the shortcut back without a mouse.
	 */
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.key !== "\\" || !(event.metaKey || event.ctrlKey) || event.altKey) return;
			if (typing()) return;
			event.preventDefault();
			props.onOpenChange(!props.open);
		};
		document.addEventListener("keydown", keys);
		onCleanup(() => document.removeEventListener("keydown", keys));
	});

	/** The rows, in document order, for the arrow keys to walk. */
	const rows = () => [...(list?.querySelectorAll<HTMLElement>("[data-row]") ?? [])];
	const focusRow = (index: number) => {
		const all = rows();
		if (all.length === 0) return;
		all[Math.min(Math.max(0, index), all.length - 1)]?.focus();
	};

	/*
	 * Up and down walk the rows; Enter is the button's own, so nothing here has to fake it.
	 * A list you can only reach with Tab is a list of seventy-eight tab stops.
	 */
	const rove = (event: KeyboardEvent) => {
		const all = rows();
		if (all.length === 0) return;
		const here = all.indexOf(document.activeElement as HTMLElement);
		if (event.key === "ArrowDown") focusRow(here + 1);
		else if (event.key === "ArrowUp") {
			if (here === 0) field?.focus();
			else focusRow(here - 1);
		} else if (event.key === "Home") focusRow(0);
		else if (event.key === "End") focusRow(all.length - 1);
		else return;
		event.preventDefault();
	};

	return (
		<>
			<aside
				/*
				 * `data-inset` on the panel and *not* on the sheet — the one attribute in this
				 * component that changes what the camera believes. See `lib/insets.ts`.
				 */
				/*
				 * `data-inset` only while it is open *and* beside the canvas.
				 *
				 * The element is in the document either way now, so the attribute is the only
				 * thing telling the camera whether there is a panel to subtract — and a closed
				 * panel still has a box, because it is slid out rather than removed. A sheet
				 * never declares one: subtracting one fitted a 1600px board into the strip
				 * beside it at 3.7%.
				 */
				data-inset={props.open && !sheet() ? "left" : undefined}
				data-open={props.open ? "true" : "false"}
				aria-hidden={!props.open}
				data-sheet={sheet() ? "true" : undefined}
				aria-label="Boards"
				class={`float panel-shell fixed z-10 flex w-[264px] max-w-[86vw] flex-col p-2 ${
					sheet()
						? "top-[calc(max(12px,env(safe-area-inset-top))_+_52px)] bottom-0 left-0"
						: "top-[calc(max(12px,env(safe-area-inset-top))_+_52px)] bottom-[calc(12px_+_env(safe-area-inset-bottom))] left-[max(12px,env(safe-area-inset-left))]"
				}`}
			>
				{/*
					The header: which list, then a field over it.

					**Both controls are 32px**, which is `--control-md` — the height a labelled chip
					in the dock already is, so the panel's header matches the chrome across the top
					of the app instead of sitting 4px shorter than everything in it. It was 28px
					(`--field`), a value chosen for a box *inside a row*; asked twice whether that
					read short, the answer was twice yes.

					A strip is back, and `PanelTab` says why it is not the one that went: these are
					two collections rather than one with a line through it.

					On a coarse pointer both stay at 40px, which the field already had and which is
					under the 44px the panel uses for anything pressed.
				*/}
				<div class="flex flex-none flex-col gap-2 pb-3">
					<Show when={props.chats}>
						{/*
							The app's `.seg`, at `h-8` — 28px buttons inside 2px of padding is a 32px
							strip, matching the field below it. The removed Context/Deck strip was the
							same object at `h-6`.
						*/}
						<div class="seg w-full" role="tablist" aria-label="Panel">
							<For each={["boards", "agents"] as PanelTab[]}>
								{(name) => (
									<button
										type="button"
										role="tab"
										id={`${ids}-tab-${name}`}
										aria-selected={tab() === name}
										aria-controls={`${ids}-list`}
										/* One tab stop for the strip, arrows within it — the ARIA tabs pattern,
										   which is what keeps the panel three stops rather than five. */
										tabindex={tab() === name ? 0 : -1}
										data-on={tab() === name}
										class="h-7 text-[11.5px] pointer-coarse:h-9"
										onClick={() => goTab(name)}
										onKeyDown={(event) => {
											if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
											event.preventDefault();
											const next: PanelTab = name === "boards" ? "agents" : "boards";
											goTab(next);
											document.getElementById(`${ids}-tab-${next}`)?.focus();
										}}
									>
										{name === "boards" ? "Boards" : "Agents"}
									</button>
								)}
							</For>
						</div>
					</Show>
					{/*
						`.field` is 24px by default; the header's rhythm wants 32, and a utility beats
						the layer it is defined in — which is the whole reason that layer exists.

						`flex-none` is load-bearing, not tidying. `.field` carries `flex: 1` for the
						inspector's row of four, where it grows sideways; in a *column* that grow is
						vertical, and a `flex-basis: 0` beats a stated height — so the field measured
						its input's min-content and came out 19px instead of 32.
					*/}
					<label class="field h-8 flex-none gap-1.5 rounded-md pointer-coarse:h-10 pointer-coarse:gap-2 pointer-coarse:px-2.5">
						<Icon of={Search} class="flex-none text-faint" size={13} />
						{/*
							16px on a touch keyboard, like the composer's field and for the same reason:
							below 16 the browser zooms the page when the input takes focus, which leaves
							the canvas at a scale nobody chose and the chrome half off screen. It is the
							one number in this component that is not about how it looks.
						*/}
						<input
							ref={field}
							type="text"
							spellcheck={false}
							class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint pointer-coarse:text-[16px]"
							/* Says what it will match, which for agents includes the tags — “who else is
							   on panel-css” is the question tags exist to answer, and this is the surface
							   with room to show the answer. */
							placeholder={
								tab() === "agents"
									? `Search ${allAgents().total} agent${allAgents().total === 1 ? "" : "s"} or tags`
									: `Search ${props.boards.length} board${props.boards.length === 1 ? "" : "s"}`
							}
							value={query()}
							onInput={(event) => type(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									// Clear first, leave second: two presses, and the second is what
									// hands `⌘\` and the canvas's own keys back.
									event.preventDefault();
									if (query()) type("");
									else event.currentTarget.blur();
								}
								if (event.key === "ArrowDown") {
									event.preventDefault();
									focusRow(0);
								}
								// The commonest search is two letters from one answer.
								if (event.key === "Enter") {
									const only = rows();
									if (only.length === 1) only[0]?.click();
								}
							}}
						/>
						<Show when={query()}>
							{/* `.iconbtn` is 28px, and 44px on a coarse pointer, which would burst a
							    24px field — so this one is sized by a utility instead. */}
							<button
								type="button"
								class="iconbtn size-5 flex-none rounded-sm pointer-coarse:size-8"
								aria-label="Clear the search"
								onClick={() => {
									type("");
									field?.focus();
								}}
							>
								<Icon of={X} size={12} />
							</button>
						</Show>
					</label>
				</div>

				<div
					ref={list}
					id={`${ids}-list`}
					/*
					 * `items` as well as `panel-list`, and it is not decoration: `RailItem` roots
					 * its viewport observer at the nearest `.items`, so a grid tile can tell
					 * whether it is on screen. Without it the observer falls back to the window
					 * and mounts a document for every board in the deck at once.
					 */
					class="panel-list items"
					data-density={density()}
					onKeyDown={rove}
				>
					<Show when={tab() === "agents"}>
						<For each={agents()}>
							{(section) => (
								<div class="panel-section" data-kind={section.kind}>
									<div class="panel-meta meta">
										<span class="truncate">{section.label}</span>
										<span class="flex-1" />
										<span class="n tabular-nums">{section.rows.length}</span>
									</div>
									{/*
										`.rowlist` is the row vocabulary — the grid, the corner, the hover, the
										current wash, `.row-act` and its ×, and the `.lb`/`.nt` type scale. The
										agent row wants all of that and two overrides (a 28px icon column and a
										top-aligned action), which `.agent-list` in `panel.css` supplies.

										Re-implementing it instead is how two lists in one panel come to nearly
										match: the board rows above are the same object.
									*/}
									<div class="rowlist agent-list">
									<For each={section.rows}>
										{(row) => (
											<AgentRow
												row={row}
												identity={props.identities?.[row.chat.id]}
												onFocus={() => props.onFocusAgent?.(row.chat.id)}
												onClose={() => props.onCloseAgent?.(row.chat.id)}
												{...(props.onAgentTags ? { onTags: (tags: string[]) => props.onAgentTags?.(row.chat.id, tags) } : {})}
											/>
										)}
									</For>
									</div>
								</div>
							)}
						</For>

						{/* The same shape of empty state the boards list has, and the same reasoning:
						    a panel that is blank for a good reason still looks broken without it. */}
						<Show when={agents().length === 0}>
							<p class="m-0 px-1 py-2 text-[12px] leading-normal text-faint">
								{allAgents().total === 0 ? "No agents yet. Start one with `+`." : `No agent matches “${query().trim()}”.`}
							</p>
						</Show>
					</Show>

					<Show when={tab() === "boards"}>
					<For each={sections()}>
							{(section) => (
								<div
									class="panel-section"
									/* So a stylesheet or a check can name *which* section without reading its
									   label — "is this the focused agent's own list, or somebody else's" is the
									   question the whole panel turns on. */
									data-kind={section.kind}
								>
									{/*
										The section label: a 20px line *inside* the list's rhythm, not a
										32px bar above it. Sentence case at 11.5px/500 — `.meta` in
										`styles/chrome.css` is that decision, made once.
									*/}
									{/* `.n` is the right-hand column the rows' dots and bins also stand in —
									    see `panel.css`. One column down the right edge, whatever is in it. */}
									<div class="panel-meta meta">
										<span class="truncate">{section.label}</span>
										<span class="flex-1" />
										<span class="n tabular-nums">{section.rows.length}</span>
									</div>
									{/*
										The branch is outside the `For`, and it has to be.
										*
										* `For` maps its items once each and calls the callback untracked — that
										* is what makes it keyed rather than re-rendering — so a `density()`
										* read *inside* the callback is a read nothing is listening to. The
										* rows kept the shape they were first drawn with and the toggle in the
										* foot did nothing but change one attribute.
										*
										* Two `For`s rather than a `Show` per row: the choice is the list's,
										* not each row's, so paying for it per row would be paying for it
										* seventy-eight times to answer the same question.
									*/}
									<Show
										when={density() === "grid"}
										fallback={
											<For each={section.rows}>
												{(row) => (
													<BoardRow
														board={row.board}
														current={props.current === row.board.path}
														dim={row.dim}
														onCanvas={row.onCanvas}
														{...(props.onDelete ? { onDelete: () => props.onDelete?.(row.board) } : {})}
														onPick={() => props.onPick(row.board)}
													/>
												)}
											</For>
										}
									>
										<For each={section.rows}>
											{(row) => (
												<BoardTile
													board={row.board}
													current={props.current === row.board.path}
													dim={row.dim}
													onPick={() => props.onPick(row.board)}
												/>
											)}
										</For>
									</Show>
								</div>
							)}
					</For>

					{/*
						An empty list is a real state and the commonest one on a fresh deck, so it
						says which empty it is. A panel that is blank for a good reason still looks
						broken if it does not give the reason.

						There is one of these now where there were two — a deck with no boards in it,
						and a search that matched none of them. The third case the tabs needed, "this
						agent holds nothing", is not an empty state at all any more: the list carries
						on into the deck below it.
					*/}
					<Show when={sections().length === 0}>
						<p class="m-0 px-1 py-2 text-[12px] leading-normal text-faint">
							{props.boards.length === 0
								? "This deck has no boards yet. Ask for one."
								: `Nothing in the deck matches “${query().trim()}”.`}
						</p>
					</Show>
					</Show>
				</div>

				{/* The foot: what the list adds up to, and how it is drawn. 24px, 8px above it. */}
				<div class="panel-foot meta">
					{/*
						What the list adds up to: its size, and how much of it is the agent's.

						While a search is running it says how many of the deck matched, because that
						is the number that changed. The held count rides along when there is one —
						the sections say it too, but they scroll and this does not.
					*/}
					<span class="truncate">
						{tab() === "agents"
							? agentFoot(allAgents(), query().trim() ? agentTally(agents()).total : undefined)
							: tally().shown === props.boards.length
								? `${props.boards.length} board${props.boards.length === 1 ? "" : "s"}${tally().held > 0 ? ` · ${tally().held} held` : ""}`
								: `${tally().shown} of ${props.boards.length} match`}
					</span>
					<span class="flex-1" />
					{/*
						The density toggle belongs to Boards.

						Pictures or rows is a question about *thumbnails*; an agent has no second
						rendering, so on the Agents tab the control would be a switch with one
						position. Hidden rather than disabled: a disabled control asks to be
						explained, and its absence here explains itself.
					*/}
					<div class="seg" style={tab() === "agents" ? { display: "none" } : undefined}>
						<button
							type="button"
							class="grid place-items-center px-1.5 pointer-coarse:h-8 pointer-coarse:px-3"
							data-on={density() === "list"}
							aria-label="Show boards as a list"
							aria-pressed={density() === "list"}
							onClick={() => goDensity("list")}
						>
							<Icon of={Rows3} size={12} />
						</button>
						<button
							type="button"
							class="grid place-items-center px-1.5 pointer-coarse:h-8 pointer-coarse:px-3"
							data-on={density() === "grid"}
							aria-label="Show boards as a grid"
							aria-pressed={density() === "grid"}
							onClick={() => goDensity("grid")}
						>
							<Icon of={LayoutGrid} size={12} />
						</button>
					</div>
				</div>
			</aside>
		</>
	);
}

/**
 * Whether the panel has to go over the canvas rather than beside it.
 *
 * A signal and not a media query, because what changes across this line is `data-inset` —
 * see the note at the top. `matchMedia` in a `try` for the same reason `lib/panels.ts` does
 * it: a test environment without one should get the desktop answer, not an exception.
 */
function createSheet(): () => boolean {
	let query: MediaQueryList | undefined;
	try {
		query = window.matchMedia(`(max-width: ${SHEET}px)`);
	} catch {
		return () => false;
	}
	const [sheet, setSheet] = createSignal(query.matches);
	const sync = (event: MediaQueryListEvent) => setSheet(event.matches);
	query.addEventListener("change", sync);
	onCleanup(() => query?.removeEventListener("change", sync));
	return sheet;
}

/** Is a text field taking keys right now? Then this component's chord is not for it. */
function typing(): boolean {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return false;
	return active.isContentEditable || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement;
}

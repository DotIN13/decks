import type { Board, Identity } from "@decks/protocol";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import Rows3 from "lucide-solid/icons/rows-3";
import Search from "lucide-solid/icons/search";
import X from "lucide-solid/icons/x";
import { createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { BoardRow, BoardTile } from "./BoardRow.tsx";
import { contextSections, contextTally, filterBoards } from "./panel-groups.ts";

/**
 * The left panel: one surface, two tabs, and a button that makes it go away.
 *
 * It replaces three things. The floating context rail, the floating agents panel and the
 * full-screen `AllBoards` modal all answered "what is on this canvas, and what else is
 * there" — and the first two could not be open at once because `lib/panels.ts` closed one
 * when the other opened. That is a tab strip with the strip left out: the relationship was
 * enforced in code and invisible on screen, which is why the third surface had nowhere to
 * live and became a modal over the canvas you were looking at.
 *
 * So: **Context**, which leads because it *is* the canvas written down, and **Deck**, which
 * is every board there is. Agents are not a third tab — a list you switch *with* is a
 * selector, not a browser, and it now hangs off the thing it selects (the avatar in the
 * top-left pill). What is left here are the two lists you *read*.
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

export type PanelTab = "context" | "deck";
/** How the list draws each board: a line, or a picture with a caption. */
export type Density = "list" | "grid";

/** Below this the panel cannot stand beside the canvas, so it goes over it. */
const SHEET = 1100;

export function LeftPanel(props: {
	/** The whole deck, for the Deck tab. */
	boards: Board[];
	/** The board the canvas is centred on. */
	current?: string;
	/** The focused agent's in-play set: what is actually on the canvas. */
	inPlay?: string[];
	/** Agent id → the paths it holds, in attach order. Every agent, not just the focused one. */
	holdings: Record<string, string[]>;
	/** Whose context the first tab is showing. */
	focused?: string;
	/** Names and colours: the third section's label, and its rows' thumbnail borders. */
	identities?: Record<string, Identity>;
	/** Folded is gone. Owned by the pill's button, so the two can never disagree. */
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Which tab, if the caller wants to remember it. Uncontrolled when absent. */
	tab?: PanelTab;
	onTabChange?: (tab: PanelTab) => void;
	/**
	 * How the *showing* tab draws its boards. Reported back with the tab it belongs to,
	 * because it is remembered per tab: seven boards an agent chose are worth seeing as
	 * pictures and seventy-eight are not, so Context can stay a grid while Deck is a list.
	 */
	density?: Density;
	onDensity?: (density: Density, tab: PanelTab) => void;
	onPick: (board: Board) => void;
	/** What is typed, for a caller that wants to keep it — `⌘K` opening on a query, say. */
	onSearch?: (query: string) => void;
}) {
	const ids = createUniqueId();
	const [ownTab, setOwnTab] = createSignal<PanelTab>("context");
	const [ownDensity, setOwnDensity] = createSignal<Density>("list");
	const [query, setQuery] = createSignal("");
	const sheet = createSheet();

	const tab = () => props.tab ?? ownTab();
	const density = () => props.density ?? ownDensity();
	let list: HTMLDivElement | undefined;
	let field: HTMLInputElement | undefined;

	const goTab = (next: PanelTab) => {
		setOwnTab(next);
		props.onTabChange?.(next);
		// The search belongs to the list under it, so switching lists clears it. A query left
		// over from the other tab is a filter you cannot see the cause of.
		type("");
	};
	const goDensity = (next: Density) => {
		setOwnDensity(next);
		props.onDensity?.(next, tab());
	};
	const type = (next: string) => {
		setQuery(next);
		props.onSearch?.(next);
	};

	const sections = createMemo(() =>
		contextSections({
			boards: props.boards,
			focused: props.focused,
			holdings: props.holdings,
			inPlay: props.inPlay,
			identities: props.identities,
			query: query(),
		}),
	);
	const tally = createMemo(() => contextTally(sections()));
	const deck = createMemo(() => filterBoards(props.boards, query()));
	const who = () => (props.focused ? props.identities?.[props.focused]?.name : undefined);

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
		<Show when={props.open}>
			<aside
				/*
				 * `data-inset` on the panel and *not* on the sheet — the one attribute in this
				 * component that changes what the camera believes. See `lib/insets.ts`.
				 */
				data-inset={sheet() ? undefined : "left"}
				data-sheet={sheet() ? "true" : undefined}
				aria-label="Boards"
				class={`float panel-shell fixed z-10 flex w-[264px] max-w-[86vw] flex-col p-2 ${
					sheet()
						? "top-[calc(max(12px,env(safe-area-inset-top))_+_52px)] bottom-0 left-0"
						: "top-[calc(max(12px,env(safe-area-inset-top))_+_52px)] bottom-[calc(12px_+_env(safe-area-inset-bottom))] left-[max(12px,env(safe-area-inset-left))]"
				}`}
			>
				{/*
					The header, on the 4 / 8 / 12 scale — the only scale in here, and every gap in
					this component is one of those three numbers.

					24px tabs, 8px, a 28px field, 12px to the list. It is *shorter* than the 88px
					it replaces while every control in it is taller, because what was removed is a
					bar rather than air: the caps eyebrow that used to sit above the list is now a
					line inside it. (The rhythm table's "72px header" adds the tab buttons at 24
					and forgets the strip's 2px of padding; built, it is 76px.)
				*/}
				<div class="flex flex-none flex-col gap-2 pb-3">
					<div class="seg w-full" role="tablist" aria-label="Boards panel">
						<For each={["context", "deck"] as PanelTab[]}>
							{(name) => (
								<button
									type="button"
									role="tab"
									id={`${ids}-tab-${name}`}
									aria-selected={tab() === name}
									aria-controls={`${ids}-list`}
									/* One tab stop for the strip, arrows within it — the ARIA tabs pattern,
									   and the reason the panel is three stops rather than five. */
									tabindex={tab() === name ? 0 : -1}
									data-on={tab() === name}
									class="h-6 text-[11px]"
									onClick={() => goTab(name)}
									onKeyDown={(event) => {
										if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
										event.preventDefault();
										const next: PanelTab = name === "context" ? "deck" : "context";
										goTab(next);
										(event.currentTarget.parentElement?.querySelector(`#${ids}-tab-${next}`) as HTMLElement | null)?.focus();
									}}
								>
									{name === "context" ? "Context" : "Deck"}
								</button>
							)}
						</For>
					</div>

					{/*
						`.field` is 24px by default; the header's rhythm wants 28, and a utility beats
						the layer it is defined in — which is the whole reason that layer exists.

						`flex-none` is load-bearing, not tidying. `.field` carries `flex: 1` for the
						inspector's row of four, where it grows sideways; in a *column* that grow is
						vertical, and a `flex-basis: 0` beats a stated height — so the field measured
						its input's min-content and came out 19px instead of 28.
					*/}
					<label class="field h-7 flex-none gap-1.5 rounded-md">
						<Icon of={Search} class="flex-none text-faint" size={13} />
						<input
							ref={field}
							type="text"
							spellcheck={false}
							class="min-w-0 flex-1 border-0 bg-none text-[12px] text-fg outline-none placeholder:text-faint"
							placeholder={
								tab() === "context"
									? `Search ${who() ? `${who()}’s ` : ""}${tally().held} board${tally().held === 1 ? "" : "s"}`
									: `Search ${props.boards.length} boards`
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
								class="iconbtn size-5 flex-none rounded-sm"
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
					role="tabpanel"
					aria-labelledby={`${ids}-tab-${tab()}`}
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
					<Show when={tab() === "context"}>
						<For each={sections()}>
							{(section) => (
								<div class="panel-section">
									{/*
										The section label: a 20px line *inside* the list's rhythm, not a
										32px bar above it. Sentence case at 11.5px/500 — `.meta` in
										`styles/chrome.css` is that decision, made once.
									*/}
									<div class="panel-meta meta" style={section.tint ? { color: section.tint } : undefined}>
										<span class="truncate">{section.label}</span>
										<span class="flex-1" />
										<span class="tabular-nums">{section.rows.length}</span>
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
														tint={row.tint}
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
													tint={row.tint}
													onPick={() => props.onPick(row.board)}
												/>
											)}
										</For>
									</Show>
								</div>
							)}
						</For>
					</Show>

					<Show when={tab() === "deck"}>
						<Show
							when={density() === "grid"}
							fallback={
								<For each={deck()}>
									{(board) => (
										<BoardRow
											board={board}
											current={props.current === board.path}
											// Nothing is dimmed here. Browsing the deck, "held" and "up" are
											// not two states worth telling apart — marking the ones not on the
											// canvas made the whole list look switched off rather than read.
											onCanvas={(props.inPlay ?? []).includes(board.path)}
											onPick={() => props.onPick(board)}
										/>
									)}
								</For>
							}
						>
							<For each={deck()}>
								{(board) => <BoardTile board={board} current={props.current === board.path} onPick={() => props.onPick(board)} />}
							</For>
						</Show>
					</Show>

					{/*
						An empty list is a real state and the commonest one on a fresh deck, so it
						says which empty it is. A panel that is blank for a good reason still looks
						broken if it does not give the reason.
					*/}
					<Show when={tab() === "context" && sections().length === 0}>
						<p class="m-0 px-1 py-2 text-[12px] leading-normal text-faint">
							<Show
								when={query()}
								fallback={
									<>
										{who() ?? "This agent"} is not holding any boards yet. Ask for one, or{" "}
										<button class="cursor-pointer border-0 bg-none p-0 text-[12px] text-accent underline" type="button" onClick={() => goTab("deck")}>
											browse the deck
										</button>
										.
									</>
								}
							>
								Nothing in this context matches “{query().trim()}”. The{" "}
								<button class="cursor-pointer border-0 bg-none p-0 text-[12px] text-accent underline" type="button" onClick={() => goTab("deck")}>
									Deck tab
								</button>{" "}
								searches all {props.boards.length}.
							</Show>
						</p>
					</Show>
					<Show when={tab() === "deck" && deck().length === 0}>
						<p class="m-0 px-1 py-2 text-[12px] leading-normal text-faint">
							{props.boards.length === 0 ? "This deck has no boards yet. Ask for one." : `Nothing in the deck matches “${query().trim()}”.`}
						</p>
					</Show>
				</div>

				{/* The foot: what the list adds up to, and how it is drawn. 24px, 8px above it. */}
				<div class="panel-foot meta">
					<span class="truncate">
						{tab() === "context"
							? `${tally().held} held · ${tally().onCanvas} on canvas`
							: deck().length === props.boards.length
								? `${props.boards.length} board${props.boards.length === 1 ? "" : "s"}`
								: `${deck().length} of ${props.boards.length} match`}
					</span>
					<span class="flex-1" />
					<div class="seg">
						<button
							type="button"
							class="grid place-items-center px-1.5"
							data-on={density() === "list"}
							aria-label="Show boards as a list"
							aria-pressed={density() === "list"}
							onClick={() => goDensity("list")}
						>
							<Icon of={Rows3} size={12} />
						</button>
						<button
							type="button"
							class="grid place-items-center px-1.5"
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
		</Show>
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

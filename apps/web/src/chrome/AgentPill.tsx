import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import type { LucideIcon } from "lucide-solid";
import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import FileText from "lucide-solid/icons/file-text";
import MousePointer2 from "lucide-solid/icons/mouse-pointer-2";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import RectangleHorizontal from "lucide-solid/icons/rectangle-horizontal";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import Undo2 from "lucide-solid/icons/undo-2";
import Pencil from "lucide-solid/icons/pencil";
import Hand from "lucide-solid/icons/hand";
import X from "lucide-solid/icons/x";
import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { AgentMark } from "../chat/agent-marks.tsx";
import type { CanvasMode, Tool } from "../canvas/Editor.ts";
import { Icon } from "../icons.tsx";
import { Popover, type Placement } from "../ui/Popover.tsx";
import { agentList, agentStatus, closeWords, rowWords } from "./agent-order.ts";
import { AgentHoverCard } from "./AgentHoverCard.tsx";

/**
 * The top-left cluster: the panel, the agent, the tools, undo.
 *
 * One pill where there were three things — a title bar, a free-standing palette and a
 * hover-triggered rail — and the merge is the point rather than a tidy-up. It buys three
 * things the boards asked for by name: **one `data-inset="top"` instead of two**, so the
 * canvas's own box is one measurement; **an empty top centre**, which is where notices land
 * and they used to have to dodge the palette; and **a line that fits a 393px phone**, which
 * two clusters never did.
 *
 * The tools live *inside* it, `V`/`S`/`C`/`T`/`E` and undo, and under 1100px they fold into
 * one control that opens them as a menu — the pill is the width of its contents and a
 * narrow window has other things to spend it on. The folding is Tailwind variants in the
 * markup rather than a `@media` block in the stylesheet, because a layer keeps its
 * precedence inside a media query and would lose to the utilities beside it; the long note
 * at the top of `index.css` is the story of finding that out.
 *
 * Presentational on purpose. It takes the chats, the identities and a callback per verb —
 * nothing here reads the socket or `App`'s state, so the whole cluster can be drawn from a
 * fixture.
 */

/*
 * The tools, moved in from `canvas/Palette.tsx` rather than imported from it.
 *
 * The palette does not export its list, and it is about to stop existing — the tools are
 * children of this pill now — so copying the five entries here and letting the integrator
 * delete the file is a smaller change than exporting from a component on its way out. The
 * keys in the tooltips are handled by the stage, beside the camera shortcuts, since a board
 * frame is its own document and a keypress over one never reaches a component either way.
 */
interface ToolEntry {
	tool: Tool;
	icon: LucideIcon;
	label: string;
	key: string;
}

/* A non-empty tuple rather than an array: `select` is the fallback when the current tool is
   somehow not one of these, and typing it this way is how that fallback is a fact rather
   than a `!`. */
const TOOLS: [ToolEntry, ...ToolEntry[]] = [
	{ tool: "select", icon: MousePointer2, label: "Select, drag, resize", key: "V" },
	{ tool: "sticky", icon: StickyNote, label: "Sticky note", key: "S" },
	{ tool: "card", icon: RectangleHorizontal, label: "Card", key: "C" },
	{ tool: "text", icon: Type, label: "Text", key: "T" },
	{ tool: "embed", icon: FileText, label: "Embed a file", key: "E" },
];

/*
 * The tools fold away under 1100px; the agent and the panel button stay at any width.
 *
 * `max-[1100px]:hidden` is written out at each site rather than held in a constant, and
 * that is not laziness: Tailwind finds classes by scanning the source text, so a class name
 * assembled from a variable is a class name that never gets generated. A constant here
 * would have compiled, run, and quietly done nothing.
 */

/**
 * An agent's face: its avatar or its initial, filled with *who* and ringed with *what*.
 *
 * Here rather than in `AgentStack.tsx`, where the corner's faces are, because four things
 * draw this circle — this pill, the stack, a dropdown row, the hover card — and the only
 * thing that differs between them is the diameter. Everything else is `styles/agents.css`;
 * `size` and `ring` are the whole API.
 *
 * `aria-hidden`, because every caller pairs it with a name: a dropdown row is a button
 * whose accessible name is the agent's, and the stack's faces carry an `aria-label` each.
 * An icon that names itself twice is worse than one that does not name itself.
 */
export function AgentFace(props: {
	chat: AgentChat;
	identity: Identity | undefined;
	/** What makes an idle agent read as `done`. Zero, or omitted, and idle is idle. */
	unread?: number;
	/** Diameter. 24 in the corner and the pill, 20 in a dropdown row. */
	size?: number;
	/** The ring's thickness *and* its offset — they are one number, or the gap stops
	 *  looking like a gap. 2 at 24px, 1.5 at 20px. */
	ring?: number;
	class?: string;
}) {
	const colour = () => props.identity?.color ?? "var(--color-accent)";
	const avatar = () => props.identity?.avatar;
	return (
		<span
			class={`agent-face ${props.class ?? ""}`}
			data-status={agentStatus(props.chat.state, props.unread ?? 0)}
			style={{
				"--face": `${props.size ?? 24}px`,
				"--ring": `${props.ring ?? 2}px`,
				/* A drawn avatar may have its own transparency, and a colour behind it would
				   show through as a halo rather than as the agent's identity. */
				"--fill": avatar() ? "transparent" : colour(),
			}}
			aria-hidden="true"
		>
			<Show when={avatar()} fallback={(props.identity?.name ?? props.chat.name).slice(0, 1).toUpperCase()}>
				{(src) => <img src={src()} alt="" />}
			</Show>
		</span>
	);
}

/**
 * The agent list — every agent, and the only place an idle one appears.
 *
 * Exported because two controls open it: the chevron beside the active agent's name, and
 * the `+n` chip in the top-right stack. One list, two ways in — so it is a component with a
 * `trigger` rather than markup inside the pill, and `AgentStack` borrows it.
 *
 * No last line on a row. The rows say *state*, not content: a 264px row with a truncated
 * sentence in it is the chat list, which is what the hover card and the boards panel are
 * for.
 *
 * ### The × per row, and where the keyboard argument went
 *
 * This list said "no close button" until now, and the reason was real: `Popover` treats Tab
 * on a row as "pick this one and close", which is the completion behaviour that makes the
 * list usable without a mouse — so a second control on the line is a control Tab can never
 * reach. What that argument left out is that **the panel it deferred to no longer exists.**
 * The rewrite deleted the chat list, and `agent.remove` went from "somewhere else" to
 * nowhere: a live protocol message, handled by the server, with no caller in the app and
 * its old stylesheet (`.chat-row-wrap .close`) still sitting in `index.css`. There was no
 * way to close a chat at all.
 *
 * So the × is here, and the keyboard is answered rather than traded away: **Delete or
 * Backspace on the roving row closes it**, and the × is not a `[data-row]`, so the arrows
 * still step one line at a time instead of alternating name, ×, name, ×. Both routes ask
 * `closing()` first — the registry refuses a chat whose runtime is mid-turn, and a control
 * that knows it will fail should say so before the press, not after.
 */
export function AgentMenu(props: {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	/** `kind` is the runtime, chosen here because it cannot change afterwards. */
	onNew: (kind?: AgentKind) => void;
	/** Take a chat off the list. The transcript is a file on disk and stays there. */
	onClose: (id: string) => void;
	/** What the server hands a new agent unless told otherwise. */
	defaultKind: AgentKind;
	/** The control that opens it, given `Popover`'s api so it can draw itself pressed. */
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	placement?: Placement;
	label?: string;
}) {
	/** Whether the runtime row has unfolded into its two choices. */
	const [picking, setPicking] = createSignal(false);

	/*
	 * Which row the card is describing, and where that row is.
	 *
	 * `held` keeps the last row after the pointer leaves so the card fades out with words
	 * still in it — the same arrangement `AgentStack` makes, and for the same reason: a card
	 * emptied the instant it starts fading is a card that fades out blank.
	 */
	type Anchor = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;
	const [over, setOver] = createSignal<{ id: string; at: Anchor } | undefined>();
	const [held, setHeld] = createSignal<{ id: string; at: Anchor } | undefined>();
	let exit: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(exit));

	/**
	 * At once, and it lingers 80ms on the way out — which is exactly what the corner stack
	 * does with the same card (`AgentStack`).
	 *
	 * There was a 350ms wait before the card, to stop a pointer run down five rows from
	 * flashing five cards. The fear was reasonable and the cure was worse: the same card
	 * summoned from the corner arrives instantly, so one hover felt broken and the other
	 * did not, and 350ms of nothing is long enough to conclude there is nothing to see.
	 *
	 * What actually stops the flashing is the grace on the way *out*: leaving a row does not
	 * take the card down for 80ms, so entering the next one inside that window moves it
	 * rather than replacing it. A card that slides down the list is not a card that blinks
	 * five times — and it is the behaviour of the surface next to it.
	 */
	/**
	 * The box the card hangs off: level with the row, clear of the *menu*.
	 *
	 * A row is inset from the popover's edge by its padding, so a card placed beside the row
	 * overlapped the menu's own border by three pixels — visible as a card that looks stuck
	 * to the list rather than beside it. Taking the row's vertical extent and the popover's
	 * right edge is the anchor that means what the design says: beside the menu, aligned to
	 * the row.
	 */
	const anchorFor = (row: HTMLElement): Anchor => {
		const at = row.getBoundingClientRect();
		const card = row.closest(".popover")?.getBoundingClientRect();
		return {
			top: at.top,
			bottom: at.bottom,
			height: at.height,
			left: card?.left ?? at.left,
			right: card?.right ?? at.right,
			width: (card?.right ?? at.right) - (card?.left ?? at.left),
		};
	};

	const point = (id: string, at: Anchor) => {
		clearTimeout(exit);
		setOver({ id, at });
		setHeld({ id, at });
	};

	const unpoint = (id: string) => {
		clearTimeout(exit);
		exit = setTimeout(() => setOver((was) => (was?.id === id ? undefined : was)), 80);
	};

	const describing = () => {
		const id = (over() ?? held())?.id;
		return id ? props.chats.find((chat) => chat.id === id) : undefined;
	};

	/*
	 * `Popover` closes on Escape and on a press outside, but a row picked *inside* it has to
	 * say so — and the card's children are not handed an api. So the trigger's `toggle` is
	 * kept as it renders, which is always before the card exists.
	 */
	let dismiss: (() => void) | undefined;

	const pick = (run: () => void) => {
		setPicking(false);
		dismiss?.();
		run();
	};

	return (
		<Popover
			placement={props.placement ?? "bottom-start"}
			label={props.label ?? "Agents"}
			class="w-[264px]"
			onOpenChange={(open) => !open && setPicking(false)}
			trigger={(api) => {
				dismiss = () => api.open && api.toggle();
				return props.trigger(api);
			}}
		>
			<For each={agentList(props.chats, props.unread, props.focused)}>
				{(chat) => {
					const status = () => agentStatus(chat.state, props.unread[chat.id] ?? 0);
					const name = () => props.identities[chat.id]?.name ?? chat.name;
					/** The tooltip if this chat can be closed, and `undefined` if it cannot. */
					const close = () => closeWords(chat.state, name());
					return (
						/*
						 * The row and its × in one box, which is `.row-act` in `chrome.css` — a
						 * `<button>` cannot contain a `<button>`, and the wash has to belong to the
						 * box or it stops 22px short of the row's own right edge.
						 */
						<div class="row-act">
							<button
								type="button"
								role="menuitem"
								data-row
								data-flat="true"
								data-agent="true"
								data-status={status()}
								/* Washed rather than ticked: the row is describing the window you are
								   already in, and a tick would imply the list is a setting. */
								data-current={props.focused === chat.id ? "true" : undefined}
								class="min-w-0 flex-1"
								onClick={() => pick(() => props.onFocus(chat.id))}
								/*
								 * The card is summoned by pointing and by focus, which is the keyboard's
								 * equivalent — the arrows rove this list, so without the focus half the
								 * detail would be mouse-only, and the roving exists precisely so the list
								 * can be used without one.
								 */
								onPointerEnter={(event) => point(chat.id, anchorFor(event.currentTarget))}
								onPointerLeave={() => unpoint(chat.id)}
								onFocus={(event) => point(chat.id, anchorFor(event.currentTarget))}
								onBlur={() => unpoint(chat.id)}
								/*
								 * Delete is the × for the keyboard, and it is on the row because the row
								 * is what the arrows rove onto. `Popover`'s own handler reads Escape and
								 * the arrows off the document and ignores these two, so nothing has to
								 * be coordinated — but the event still stops here, or a Backspace meant
								 * for a chat would also be the browser's go-back.
								 */
								onKeyDown={(event) => {
									if (event.key !== "Delete" && event.key !== "Backspace") return;
									event.preventDefault();
									event.stopPropagation();
									if (close()) props.onClose(chat.id);
								}}
							>
								<AgentFace chat={chat} identity={props.identities[chat.id]} unread={props.unread[chat.id] ?? 0} size={20} ring={1.5} />
								{/*
									`block`, because `.lb` is a flex row and `text-overflow` does not apply to
									one — a long name would have overflowed the row rather than ellipsing.

									`nm` keeps the name at 600 where the rest of this menu's labels are 400: a
									row you pick an *agent* from is not a row you pick a command from. See
									`chrome.css`, where both halves of that are stated together.
								*/}
								<span class="lb nm block truncate">{name()}</span>
								{/*
									Which runtime, in the word the server uses. The chip the panel row and the
									hover card also wear, so the three surfaces name a runtime identically —
									`.kind` in `styles/chrome.css` argues for the word over a badge on the face.
								*/}
								<span class="kind" data-dormant={chat.dormant ? "true" : undefined}>{chat.kind}</span>
								{/*
									`data-yield` says these words give ground for the × rather than a square
									standing empty beside them until it arrives: the last column of a row is one
									short status, and 22px reserved there is a ragged gutter down the whole list.
									So the slot opens on approach and the words slide left by it — see `.row-act`
									in `chrome.css`, which is also where the touch case lives, since there is
									nothing to approach with on a phone and the slot simply stays open.
								*/}
								<span class="meta flex-none text-[10px] tabular-nums" data-yield>{rowWords(status(), chat.state, chat.lastAt)}</span>
							</button>

							{/*
								Not a `[data-row]`, and that is the whole reason the arrows still work: the
								rove list is built from that attribute, so an × carrying it would make every
								journey through the list twice as long. It is also why picking it does not
								close the menu — `Popover` closes on a row click and this is not one — which
								is right on its own terms, since closing three chats is one visit to the list.

								**Absent, rather than disabled, on a chat that cannot be closed.** The
								registry refuses anything mid-turn, and the row already says why: it keeps its
								words instead of swapping them for a greyed-out button whose tooltip repeats
								"still working". A control that cannot be pressed is worth drawing when its
								absence would be a mystery, and "typing…" is not a mystery.
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
											props.onClose(chat.id);
										}}
									>
										<Icon of={X} size={13} />
									</button>
								)}
							</Show>
						</div>
					);
				}}
			</For>

			<div class="rule" />

			{/*
			 * New agent, with its runtime beside it.
			 *
			 * Two rows on one line rather than a row with a button in it: a button inside a
			 * button is invalid, and a non-`[data-row]` control here would be the one thing in
			 * the menu the arrow keys could not reach. Both halves carry `data-row`, so the
			 * keyboard roves onto either and the highlight is the popover's own.
			 */}
			{/*
				`w-auto` on both halves, which is the whole reason this line works.

				`.popover [data-row]` is `width: 100%`, so that an ordinary row fills the card —
				and two rows sharing a line each claimed all of it. `flex-none` then held the
				runtime button at 250px while the label shrank to its `+` icon, which is what
				"New / pi / agent" stacked in three lines actually was.

				`whitespace-nowrap` on the label for the same reason in miniature: "New agent" is
				two words and there is no width at which breaking them is better than eliding.
			*/}
			<div class="flex items-center gap-1">
				<button type="button" role="menuitem" data-row data-flat="true" class="w-auto min-w-0 flex-1" onClick={() => pick(() => props.onNew(props.defaultKind))}>
					<Icon of={Plus} size={13} class="flex-none text-muted" />
					<span class="lb whitespace-nowrap">New agent</span>
				</button>
				<button
					type="button"
					role="menuitem"
					data-row
					data-flat="true"
					class="w-auto flex-none px-2 text-[11px] whitespace-nowrap text-faint"
					aria-expanded={picking()}
					aria-label={`Runtime for a new agent — ${props.defaultKind}`}
					title="The runtime cannot change once an agent exists"
					onClick={() => setPicking((was) => !was)}
				>
					{props.defaultKind}
					<Icon of={ChevronDown} size={11} class="chev" />
				</button>
			</div>

			{/*
			 * The runtime is not a setting on a new agent, it is the same question as "new
			 * agent" asked once — a live session cannot swap the process behind it — so
			 * picking one here *creates* rather than remembering a preference.
			 */}
			<Show when={picking()}>
				<For each={["claude", "pi"] as AgentKind[]}>
					{(kind) => (
						<button type="button" role="menuitem" data-row data-flat="true" onClick={() => pick(() => props.onNew(kind))}>
							{/* `flex-none`: an `<svg>` in a flex row shrinks to nothing beside a
							    `flex-1` label, and has. */}
							<AgentMark class="flex-none" agent={kind} size={13} />
							<span class="lb flex-1">New {kind} agent</span>
							<Show when={kind === props.defaultKind}>
								<Icon of={Check} size={13} class="flex-none text-faint" />
							</Show>
						</button>
					)}
				</For>
			</Show>
					{/*
				One card for the whole menu, mounted with it and only unhidden on hover.
				
				`beside`, not under: a card centred beneath a row would cover the rows below it,
				which are the ones being compared. It is the same component the corner faces
				summon — the detail lives in one place and is reachable from either list.
			*/}
			<Show when={describing()}>
				{(chat) => (
					<AgentHoverCard
						chat={chat()}
						identity={props.identities[chat().id]}
						unread={props.unread[chat().id] ?? 0}
						anchor={(over() ?? held())!.at}
						shown={over() !== undefined}
						beside
					/>
				)}
			</Show>
		</Popover>
	);
}

export function AgentPill(props: {
	/**
	 * Browse or edit. Browse is the default and the safe one.
	 *
	 * In browse mode a board is a *document*: text selects and copies, a game plays, a click
	 * is an ordinary click. In edit mode it is a *drawing*: components drag, a click selects,
	 * a double-click retypes a run of words. Both pan and zoom.
	 *
	 * The toggle lives here because the tools do, and because the tools are meaningless in
	 * browse mode — they insert components. They fold away with it rather than sitting there
	 * inert, which is the same argument the corner makes about a control that cannot act.
	 */
	mode: CanvasMode;
	onMode: (mode: CanvasMode) => void;
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onNew: (kind?: AgentKind) => void;
	onClose: (id: string) => void;
	defaultKind: AgentKind;
	/** Whether the boards panel is showing. A button, not a hover — folded means gone. */
	boardsOpen: boolean;
	onToggleBoards: () => void;
	tool: Tool;
	onTool: (tool: Tool) => void;
	/** Undo the last edit to the selected board. Absent when there is nothing to undo. */
	onUndo?: () => void;
}) {
	const active = () => props.chats.find((chat) => chat.id === props.focused);
	const name = () => {
		const chat = active();
		return chat ? (props.identities[chat.id]?.name ?? chat.name) : undefined;
	};
	const current = () => TOOLS.find((entry) => entry.tool === props.tool) ?? TOOLS[0];

	return (
		/*
		 * `data-inset="top"` and nothing about its size stated twice: `lib/insets.ts`
		 * measures whatever carries the attribute, so the pill may grow a control without
		 * anything else in the app being told.
		 */
		<div
			/*
			 * `w-max`, not the shrink-to-fit an absolute box gets by default.
			 *
			 * Shrink-to-fit is `min(max(min-content, available), max-content)`, and the name in
			 * here is `truncate` — so its *min*-content is nearly zero and the browser was
			 * entitled to squeeze it to a couple of letters while the tools carried on at their
			 * natural size. The result read as the tools being drawn on top of the agent's name.
			 * `max-content` says: give every child the room it asked for, and let the pill be as
			 * wide as that comes to. The name's own `max-w` is what stops a long one running
			 * away with the line.
			 */
			class="float pill absolute top-3 left-3 z-20 w-max"
			data-inset="top"
		>
			{/*
			 * The panel, as a button.
			 *
			 * It used to arrive when the cursor got near the left edge — a panel that comes
			 * at you — and the 40px strip it left behind existed only because a hover target
			 * had to be aimed at. One button, one signal, and folded means gone.
			 */}
			<button
				type="button"
				class="iconbtn"
				data-on={props.boardsOpen ? "soft" : undefined}
				aria-pressed={props.boardsOpen}
				title="Boards (⌘\)"
				aria-label={props.boardsOpen ? "Hide the boards panel" : "Show the boards panel"}
				onClick={() => props.onToggleBoards()}
			>
				<Icon of={PanelLeft} size={15} />
			</button>

			{/* Hairlines are decoration, and the first thing to go when the line is short. */}
			<span class="pill-sep max-[640px]:hidden" aria-hidden="true" />

			{/*
			 * The active agent, with the same ring it would carry in the corner — which is also
			 * why it has no face over there. A face in two corners is one too many.
			 *
			 * `flex-none` on the group and a `max-w` on the name, rather than `min-w-0` and
			 * letting it shrink. The pill is absolutely positioned with no width, so its width
			 * is shrink-to-fit — and an `overflow: hidden` child with `min-width: 0` inside one
			 * contributes *nothing* to that calculation. The pill sized itself as if the name
			 * were not there and laid the tools out on top of it: "Claude" came out as two
			 * clipped letters under the select tool.
			 *
			 * So the name takes the room it needs and stops at 160px, which is about twenty
			 * characters. Past that a name is not being read but recognised, and the dropdown
			 * spells it out in full.
			*/}
			<Show
				when={active()}
				fallback={
					<span class="label px-1">No agent</span>
				}
			>
				{(chat) => (
					<span class="flex flex-none items-center gap-[7px] pl-0.5">
						<AgentFace chat={chat()} identity={props.identities[chat().id]} unread={props.unread[chat().id] ?? 0} />
						{/*
							The name goes on a phone; the face stays.

							At 393px with 44px touch targets the pill came to 305px and ran 42px
							into the corner cluster — two floats overlapping, which is the one
							thing a floating chrome must not do. The name is the cheapest 67px
							in it: the avatar still says whose window this is, its ring still
							says what the agent is doing, and the dropdown spells the name out
							the moment you reach for it.

							**768, where everything else in this pill unfolds at 640** — and the
							two numbers are the same sum done twice. Without the name the two
							clusters come to 548px of content, so 640 leaves them 92px apart;
							*with* one they come to as much as 708, because `max-w-[160px]` is
							what a name is allowed to cost. A single breakpoint would have to be
							the larger of the two, which would hold the buttons back 128px for
							a string that is not one of them.
						*/}
						<span class="max-w-[160px] truncate text-[12px] font-semibold max-[768px]:hidden">{name()}</span>
					</span>
				)}
			</Show>

			<AgentMenu
				chats={props.chats}
				identities={props.identities}
				focused={props.focused}
				unread={props.unread}
				onFocus={props.onFocus}
				onNew={props.onNew}
				onClose={props.onClose}
				defaultKind={props.defaultKind}
				label="Agents"
				trigger={(api) => (
					<button
						type="button"
						class="iconbtn"
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						data-on={api.open ? "soft" : undefined}
						title="Switch agent (⌘J)"
						aria-label={name() ? `Agents — currently ${name()}` : "Agents"}
						onClick={api.toggle}
					>
						<Icon of={ChevronDown} size={12} />
					</button>
				)}
			/>

			<span class="pill-sep" aria-hidden="true" />

			{/*
				Browse or edit, and it is the first thing after the agent because it changes what
				every control to its right means.

				A pencil when you are browsing (press it to start editing) and a hand when you
				are editing (press it to stop) — the icon is **what pressing it does**, not what
				mode you are in, which is the convention every drawing tool has settled on and
				the opposite of what reads naturally when you write the markup.

				No confirmation. A single press is right for something this reversible, and the
				guard against pressing it by accident is that editing *looks* different — see
				`.stage[data-mode]` and the badge in `Stage.tsx`. A dialog in front of a mode
				switch is a dialog you learn to dismiss without reading.
			*/}
			<button
				type="button"
				class="iconbtn"
				/*
				 * `soft` — the grey wash the panel toggle wears, not the accent fill.
				 *
				 * The accent is for one of a set: which tool is selected, read from across the
				 * window. Editing is not one of a set, it is a thing being *held* — the same
				 * kind of fact as "the panel is open" — and `data-on="soft"` is the state this
				 * file's own note reserves for exactly that. It was the accent, which put the
				 * loudest control in the pill next to the tool that is actually chosen and made
				 * the two look like peers.
				 */
				data-on={props.mode === "edit" ? "soft" : undefined}
				aria-pressed={props.mode === "edit"}
				title={props.mode === "edit" ? "Stop editing — back to browsing" : "Edit the boards: drag components, retype text"}
				aria-label={props.mode === "edit" ? "Stop editing" : "Edit the boards"}
				onClick={() => props.onMode(props.mode === "edit" ? "browse" : "edit")}
			>
				<Icon of={props.mode === "edit" ? Hand : Pencil} size={15} />
			</button>

			{/*
				The tools, and only while editing.

				They insert components, which is editing by definition — in browse mode they
				would be five controls that cannot act. Gone rather than disabled, for the reason
				the corner gives about the close button on a busy agent: a control that cannot be
				pressed is worth drawing when its absence would be a mystery, and the pencil
				beside them is not a mystery.
			*/}
			<Show when={props.mode === "edit"}>
			<span class="pill-sep max-[1100px]:hidden" aria-hidden="true" />

			{/*
				The tools, at any width that has room for five of them.

				`palette` as well as the utilities, and it is not decoration: it is the name the
				canvas checks address this group by, and it is still the same group of controls —
				what changed is which cluster it sits in. Renaming a handle because a thing moved
				house is how a suite stops testing what it says it tests.
			*/}
			<span class="palette flex items-center gap-1 max-[1100px]:hidden" role="group" aria-label="Tools">
				<For each={TOOLS}>
					{(entry) => (
						<button
							type="button"
							class="iconbtn"
							data-on={props.tool === entry.tool ? "true" : undefined}
							aria-pressed={props.tool === entry.tool}
							title={`${entry.label} (${entry.key})`}
							aria-label={entry.label}
							onClick={() => props.onTool(entry.tool)}
						>
							<Icon of={entry.icon} size={15} />
						</button>
					)}
				</For>
			</span>

			{/*
			 * And below it, the same five as a menu.
			 *
			 * The trigger wears the *current* tool's icon rather than a generic one, so
			 * folding the group costs the tool count but not the tool you are holding —
			 * which is the only one of the five you need to see at a glance.
			 */}
			<span class="hidden max-[1100px]:block">
				<Popover
					placement="bottom-start"
					label="Tools"
					class="w-[212px]"
					trigger={(api) => (
						<button
							type="button"
							class="iconbtn"
							ref={api.ref}
							aria-haspopup="menu"
							aria-expanded={api.open}
							data-on="true"
							title={`${current().label} (${current().key})`}
							aria-label={`Tools — currently ${current().label}`}
							onClick={api.toggle}
						>
							<Icon of={current().icon} size={15} />
						</button>
					)}
				>
					<For each={TOOLS}>
						{(entry) => (
							<button
								type="button"
								role="menuitem"
								data-row
								data-flat="true"
								data-current={props.tool === entry.tool ? "true" : undefined}
								onClick={() => props.onTool(entry.tool)}
							>
								<Icon of={entry.icon} size={14} class="flex-none text-muted" />
								<span class="lb flex-1">{entry.label}</span>
								<span class="meta flex-none text-[10px]">{entry.key}</span>
							</button>
						)}
					</For>
					{/*
						Undo joins them under 640px, where it leaves the line.

						It is not a tool — it does not change what a click on the canvas does —
						but this menu is the editing chrome on a touchscreen, and a rule plus a
						row is cheaper than 53px of a 320px line. The button stays in the pill at
						every width that can hold it, because reaching for undo through a menu is
						worse than reaching for it directly.
					*/}
					<Show when={props.onUndo}>
						{(undo) => (
							<>
								<span class="rule hidden max-[640px]:block" />
								<button type="button" role="menuitem" data-row data-flat="true" onClick={() => undo()()} class="hidden max-[640px]:flex">
									<Icon of={Undo2} size={14} class="flex-none text-muted" />
									<span class="lb flex-1">Undo the last edit</span>
									<span class="meta flex-none text-[10px]">⌘Z</span>
								</button>
							</>
						)}
					</Show>
				</Popover>
			</span>

			{/*
			 * Undo, last, behind its own rule.
			 *
			 * Not a tool — it does not change what a click on the canvas does — and it sits
			 * with them anyway, because this pill is the editing chrome and on a touchscreen
			 * it is the *only* editing chrome. ⌘Z remains the desktop's answer; this is the
			 * one for a device with no ⌘.
			 */}
			<Show when={props.onUndo}>
				{(undo) => (
					<>
						<span class="pill-sep max-[640px]:hidden" aria-hidden="true" />
						<button
							type="button"
							class="iconbtn max-[640px]:hidden"
							title="Undo the last edit to this board (⌘Z)"
							aria-label="Undo the last edit to this board"
							onClick={() => undo()()}
						>
							<Icon of={Undo2} size={15} />
						</button>
					</>
				)}
			</Show>
			</Show>
		</div>
	);
}

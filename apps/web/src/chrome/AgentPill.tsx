import { PALETTE, type ComponentKind } from "@decks/board-kit";
import type { AgentChat, AgentKind, Canvas, Identity } from "@decks/protocol";
import type { LucideIcon } from "lucide-solid";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import House from "lucide-solid/icons/house";
import MousePointer2 from "lucide-solid/icons/mouse-pointer-2";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import ImageIcon from "lucide-solid/icons/image";
import RectangleHorizontal from "lucide-solid/icons/rectangle-horizontal";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import Undo2 from "lucide-solid/icons/undo-2";
import FileText from "lucide-solid/icons/file-text";
import Pencil from "lucide-solid/icons/pencil";
import Brush from "lucide-solid/icons/brush";
import Hand from "lucide-solid/icons/hand";
import Trash2 from "lucide-solid/icons/trash-2";
import X from "lucide-solid/icons/x";
import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { AgentMark } from "./agent-marks.tsx";
import type { CanvasMode, Tool } from "../canvas/Editor.ts";
import { Icon } from "../ui/icons.tsx";
import { Popover, type Placement } from "../ui/Popover.tsx";
import { isNews, runtimes } from "../state/deck.ts";
import { canHover } from "../lib/media.ts";
import { agentList, agentStatus, closeWords, dropdownFaces, rowWords, workspaceRuns } from "./agent-order.ts";
import { AgentHoverCard } from "./AgentHoverCard.tsx";
import { DispatchTabs } from "./DispatchView.tsx";
import type { DispatchTab } from "./dispatch-view.ts";

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

/*
 * The icons, one per kind, and *all* of them — a `Partial` here would let a kind gain a
 * palette key in the vocabulary and appear with no icon, which is a button with a hole in it.
 * The rest of a button — its label, its key, the order — is `@decks/board-kit`'s.
 */
const ICONS: Record<ComponentKind, LucideIcon> = {
	sticky: StickyNote,
	card: RectangleHorizontal,
	text: Type,
	embed: FileText,
	image: ImageIcon,
};

/* A non-empty tuple rather than an array: `select` is the fallback when the current tool is
   somehow not one of these, and typing it this way is how that fallback is a fact rather
   than a `!`. */
const TOOLS: [ToolEntry, ...ToolEntry[]] = [
	{ tool: "select", icon: MousePointer2, label: "Select, drag, resize", key: "V" },
	...PALETTE.map((component) => ({
		tool: component.kind as Tool,
		icon: ICONS[component.kind],
		label: component.label,
		key: component.key.toUpperCase(),
	})),
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
 * Every runtime an agent can be, as rows — the whole of "add an agent", written once.
 *
 * Two controls open this list: the `+` in the top-left pill, and the `+ New agent` row at the
 * foot of the agents menu that unfolds in place. They are the same question asked from two
 * places — a live session cannot swap the process behind it, so choosing a runtime *is*
 * creating the agent — and a list copied per caller is how "New claude agent" and "New
 * Claude agent" end up in the same menu as two different things.
 *
 * The list comes from the server, which is the only thing that knows what this machine
 * has: the runtime's own name for itself, and whether it can start here. A runtime that
 * cannot is disabled and says why — an option that fails on the first prompt is worse than
 * one that is not offered.
 */
function AgentChoices(props: { onPick: (kind: AgentKind) => void }) {
	return (
		<For each={runtimes()}>
			{(runtime) => (
				<button
					type="button"
					role="menuitem"
					data-row
					data-flat="true"
					disabled={!runtime.available}
					title={runtime.reason ?? ""}
					onClick={() => props.onPick(runtime.kind)}
				>
					{/* `flex-none`: an `<svg>` in a flex row shrinks to nothing beside a
					    `flex-1` label, and has. */}
					<AgentMark class="flex-none" agent={runtime.kind} size={13} />
					<span class="lb flex-1">New {runtime.label} agent</span>
					<Show when={!runtime.available}>
						<span class="flex-none text-[11px] text-faint">not installed</span>
					</Show>
				</button>
			)}
		</For>
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
	/**
	 * Who is on the canvas on screen, by id. The menu's first section.
	 *
	 * An agent is on every canvas it has worked in, so this is not a filter of the list but a
	 * cut through it: the same agent is *here* in one room and *anywhere* in the next. Empty,
	 * or absent on the dashboard, and the menu is one list grouped by workspace as before.
	 */
	here?: string[];
	/** The control that opens it, given `Popover`'s api so it can draw itself pressed. */
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	placement?: Placement;
	label?: string;
	/** Rows of the caller's own, under the rule and above New agent: the composer puts the dispatcher there. */
	foot?: JSX.Element;
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

	/*
	 * Not on a touch screen, and not as a rule about small windows: the card is a *hover*
	 * card, and a finger cannot hover.
	 *
	 * `pointerenter` fires on a tap, so a list of agents on a phone answered the first tap
	 * with a card and needed a second one to switch — the card arriving instead of the
	 * thing you asked for. It reads as the tap being eaten, which is what it is. Everything
	 * the card says is on the row underneath it anyway; on a phone the row is the answer.
	 */
	const point = (id: string, at: Anchor) => {
		if (!canHover()) return;
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

	/*
	 * The dropdown's rows, and what the cap held back.
	 *
	 * The menu used to draw every chat, which was fine while the deck kept fifteen of them
	 * (`agent-order.ts` — `DROPDOWN_CAP`). Now that nothing is pruned it is unbounded, and a
	 * card over the canvas is not where a hundred rows should land. The remainder is a
	 * sentence rather than a bare number: the panel is the surface that scrolls, and this is
	 * the only place that says so.
	 */
	const listed = () => dropdownFaces(agentList(props.chats, props.unread, props.focused));
	/**
	 * The same rows, cut into workspace runs — and nothing at all when nobody has one.
	 *
	 * A heading over a run of rows is what the panel does with a section; this is the same idea
	 * in a 264px card, where there is no room for three of them and the cap already says how many
	 * rows it is not drawing. See `workspaceRuns`: the rows keep the order they were ranked in,
	 * and the headings appear only once there is more than one group to tell apart.
	 */
	const runs = (): Array<{ label: string | undefined; chats: AgentChat[] }> => {
		const shown = listed().shown;
		const here = new Set(props.here ?? []);
		/*
		 * In a room: **here, then anywhere** — the two questions this menu is opened with, in
		 * the order they are asked. Picking from either only changes who the composer
		 * addresses; an agent from `Anywhere` joins this canvas by working on it, which is
		 * the server's own rule (`session.canvasIds`) and not something the menu has to do.
		 *
		 * Off a canvas the old cut stands: one list, in workspace runs.
		 */
		const inside = here.size > 0 ? shown.filter((chat) => here.has(chat.id)) : [];
		/* Nobody from this room in the list — an empty canvas, or a list cut down by a search
		   that matched nothing here — so there is no *here* to draw, and `Anywhere` alone would
		   be a heading that told the reader nothing. */
		if (inside.length === 0) return workspaceRuns(shown, props.identities);
		const outside = shown.filter((chat) => !here.has(chat.id));
		return [{ label: "Here", chats: inside }, ...(outside.length > 0 ? [{ label: "Anywhere", chats: outside }] : [])];
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
			<For each={runs()}>
				{(run) => (
					<>
						{/*
							What this run of rows has in common, where they have anything.

							`.group` is the class that already labels a run of rows in a menu — the accounts
							picker and the settings rows use it — so a workspace heading here is the same
							object as every other label over a group, rather than a fourth kind of small text.
							Not a `[data-row]`: the arrows should reach the agents, and a heading is not one.
						*/}
						<Show when={run.label}>{(label) => <div class="group">{label()}</div>}</Show>
						<For each={run.chats}>
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
					</>
				)}
			</For>

			{/*
			 * What the cap hid, said rather than counted away.
			 *
			 * The corner can get away with a bare `+n` because its label is already a count of
			 * faces. Here a list that stopped at the cap with nothing under it would read as the
			 * whole list, and every agent below the thirteenth would be invisible — so the number
			 * is in a sentence, and the sentence names where the rest are.
			 *
			 * Not a `[data-row]`: the arrows should reach the agents, and a line that only reports
			 * a count is not one to land on.
			 */}
			<Show when={listed().more > 0}>
				<p class="m-0 px-2 py-1.5 text-[11px] leading-normal text-faint">
					{listed().more} more {listed().more === 1 ? "agent" : "agents"} — open the Agents panel.
				</p>
			</Show>

			<div class="rule" />
			{props.foot}

			{/*
				New agent, as one control that unfolds.

				It was two: a label that created an agent on the server's default runtime, and a chip
				beside it, showing that runtime's name, that opened the four choices. So the menu
				asked you to know which runtime you wanted before it showed you one — and the runtime
				is the one thing about a new agent that cannot be changed afterwards. The pair is one
				button now, and pressing it shows the four.

				A row rather than a row with a button in it: a button inside a button is invalid, and a
				non-`[data-row]` control here would be the one thing in the menu the arrow keys could
				not reach.

				`aria-expanded` is load-bearing rather than descriptive: `Popover` reads it to tell a
				disclosure inside the menu from a choice that should close it, so without it the press
				that unfolds the list would take the menu with it.
			*/}
			<button
				type="button"
				role="menuitem"
				data-row
				data-flat="true"
				aria-expanded={picking()}
				aria-label="New agent: choose its runtime"
				title="The runtime cannot change once an agent exists"
				onClick={() => setPicking((was) => !was)}
			>
				<Icon of={Plus} size={13} class="flex-none text-muted" />
				<span class="lb flex-1 whitespace-nowrap">New agent</span>
				<Icon of={ChevronDown} size={11} class="flex-none text-muted" />
			</button>

			{/*
			 * The runtime is not a setting on a new agent, it is the same question as "new
			 * agent" asked once — a live session cannot swap the process behind it — so
			 * picking one here *creates* rather than remembering a preference.
			 */}
			<Show when={picking()}>
				<AgentChoices onPick={(kind) => pick(() => props.onNew(kind))} />
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
	/** Whether the draw tool is on, and how to turn it on and off. Browse mode only. */
	drawing: boolean;
	onDrawing: (drawing: boolean) => void;
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onNew: (kind?: AgentKind) => void;
	onClose: (id: string) => void;
	/** Whether the boards panel is showing. A button, not a hover — folded means gone. */
	boardsOpen: boolean;
	onToggleBoards: () => void;
	tool: Tool;
	onTool: (tool: Tool) => void;
	/** Undo the last edit to the selected board. Absent when there is nothing to undo. */
	onUndo?: () => void;
	/**
	 * Which surface is up. On a stage the pill is the agent's, with Home grown into it; on
	 * the dashboard it is the deck's, and the editing controls hide because there is no
	 * board to edit. One element with two faces, so the eye has one thing to follow.
	 */
	surface?: "dispatch" | "stage";
	/** Back to the dashboard. Drawn only on a stage. */
	onHome?: () => void;
	/**
	 * The canvas on screen, when one is open: its name, and who is on it.
	 *
	 * The faces the name used to carry are gone. They were a second roster in a line that
	 * already has one — the agent you are addressing is drawn beside them, so the active
	 * agent appeared twice — and who is in the room is the panel's "On this canvas" section,
	 * where there is room to say what each of them is doing. `agents` stays, because the
	 * agents menu cuts itself into *here* and *anywhere* by it.
	 */
	canvas?: { id: string; name: string; agents: string[] };
	onRenameCanvas?: (name: string) => void;
	/** Rename the agent you are talking to, from its own name in the line. Absent and the name is a label. */
	onRenameAgent?: (id: string, name: string) => void;
	/**
	 * Every canvas in the deck, for the switcher in the pill's canvas segment.
	 *
	 * The canvas is the place, so moving between rooms belongs beside the name of the room
	 * you are in rather than on the dashboard alone: Home is for leaving, this is for going
	 * next door. Absent and the name is a label with no chevron.
	 */
	canvases?: Canvas[];
	onOpenCanvas?: (id: string) => void;
	onNewCanvas?: () => void;
	/** Remove a canvas from the deck, from the switcher's rows. Boards stay. */
	onRemoveCanvas?: (id: string) => void;
	/** How many tasks want a person: the badge on Home, and on the Boards tab. */
	wantsYou?: number;
	/** How many boards an agent named since the person last read them: the dot on the Boards tab. */
	news?: number;
	/**
	 * The dashboard's tabs, drawn in the pill where the agent and the + are on a stage.
	 * On the dashboard the pill is the deck's, and the deck's three views are the thing to
	 * switch between; the agents are the sidebar's.
	 */
	tab?: DispatchTab;
	onTab?: (tab: DispatchTab) => void;
}) {
	const onStage = () => props.surface !== "dispatch";
	const active = () => props.chats.find((chat) => chat.id === props.focused);
	const name = () => {
		const chat = active();
		return chat ? (props.identities[chat.id]?.name ?? chat.name) : undefined;
	};
	const current = () => TOOLS.find((entry) => entry.tool === props.tool) ?? TOOLS[0];

	return (
		/*
		 * `data-inset="top"` and nothing about its size stated twice: `camera/insets.ts`
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
			class="float pill absolute top-3 z-20 w-max"
			/*
			 * Clear of the sidebar, which is a full-height column now: the pill starts where
			 * the canvas does. An inline style rather than a class, because the inset is a
			 * measured variable (`camera/insets.ts`) and a utility class cannot read one.
			 */
			style={{ left: "calc(var(--inset-left, 0px) + 12px)", transition: "left 160ms ease" }}
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
			 * Home, grown into the pill on a stage.
			 *
			 * The one way back to the dashboard that is always on screen. Its badge is the
			 * count of tasks that want a person, because a refused dispatch is the one thing
			 * the dashboard has to say to somebody who is looking at a canvas. The segment
			 * animates from zero width so the pill reads as one thing changing face rather
			 * than two toolbars swapping.
			 */}
			<span class="pill-home" data-on={onStage() ? "true" : undefined} aria-hidden={!onStage()}>
				<button
					type="button"
					class="chipbtn pill-home-btn max-[480px]:hidden"
					title="Back to the dashboard (Esc)"
					aria-label="Home: back to the dashboard"
					tabindex={onStage() ? 0 : -1}
					onClick={() => props.onHome?.()}
				>
					<Icon of={ArrowLeft} size={13} />
					<span>Home</span>
					<Show when={(props.wantsYou ?? 0) > 0}>
						<span class="pill-home-n">{props.wantsYou}</span>
					</Show>
				</button>
				{/* On a phone the same door is one icon, like the buttons beside it: the two
				    toolbars share 390px there, and a labelled chip was the difference between
				    meeting and overlapping. The badge rides on its corner. */}
				<button
					type="button"
					class="iconbtn pill-home-icon hidden max-[480px]:grid"
					title="Back to the dashboard"
					aria-label="Home: back to the dashboard"
					tabindex={onStage() ? 0 : -1}
					onClick={() => props.onHome?.()}
				>
					<Icon of={House} size={17} />
					<Show when={(props.wantsYou ?? 0) > 0}>
						<span class="pill-home-n pill-home-icon-n">{props.wantsYou}</span>
					</Show>
				</button>
				<span class="pill-sep" aria-hidden="true" />
			</span>

			<Show when={onStage() && props.canvas}>
				{(canvas) => (
					<CanvasSegment
						id={canvas().id}
						name={canvas().name}
						canvases={props.canvases ?? []}
						onRename={(name) => props.onRenameCanvas?.(name)}
						{...(props.onOpenCanvas ? { onOpen: props.onOpenCanvas } : {})}
						{...(props.onNewCanvas ? { onNew: props.onNewCanvas } : {})}
						{...(props.onRemoveCanvas ? { onRemove: props.onRemoveCanvas } : {})}
					/>
				)}
			</Show>

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
			{/* On the dashboard: the three views, and nothing about agents. The sidebar has them. */}
			<Show when={!onStage()}>
				<DispatchTabs tab={props.tab ?? "boards"} onTab={(tab) => props.onTab?.(tab)} badge={props.wantsYou} news={props.news} />
			</Show>

			<Show when={onStage()}>
			{/* The face, the name and the chevron are one group: the agents menu opens from the
			    chevron and lines up with the group (`data-popover-anchor`, read by `ui/Popover`). */}
			<span class="flex items-center gap-1" data-popover-anchor>
			<Show
				when={active()}
				fallback={<span class="label px-1">No agent</span>}
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
						{/*
							Renamed in place, like the canvas beside it: a press on the name is a
							field, Escape keeps the old one. An agent names itself as its first act
							(`stage.me({ name })`), and this is the same act from your side — which
							is why `Agent 3` can be the thing it is *called* rather than a label you
							have to ask an agent to change on your behalf.
						*/}
						<EditableName
							name={name() ?? ""}
							label="Agent name"
							title={`Rename ${name()}`}
							class="pill-name pill-agent-name max-[768px]:hidden"
							onRename={(next) => props.onRenameAgent?.(chat().id, next)}
						/>
					</span>
				)}
			</Show>

			<AgentMenu
				chats={props.chats}
				identities={props.identities}
				focused={props.focused}
				unread={props.unread}
				here={props.canvas?.agents ?? []}
				onFocus={props.onFocus}
				onNew={props.onNew}
				onClose={props.onClose}
				label="Agents"
				trigger={(api) => (
					<button
						type="button"
						class="iconbtn max-[360px]:hidden"
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
			</span>

			{/*
				Add an agent, one press from the toolbar.

				The list existed and was three presses deep: the chevron, then `New agent`, then the
				runtime chip beside it — and the runtime is the one thing about a new agent that
				**cannot be changed afterwards**, so it was the last thing the flow asked. This is
				the same list (the same component, `AgentChoices`) one press from the toolbar, which
				is where "add" lives in every app the person using this has already met.

				Beside the selector it adds to, and not with the tools: adding an agent does not
				change what a click on the canvas does. That is also what keeps two `+`-shaped
				menus apart — the corner's is a new *board*.

				Fold-away below 640px, where the pill is a 393px line with 44px targets and four
				buttons already. Nothing is lost there: the chevron beside it opens the agents
				menu, whose `New agent` pair is the same two presses it always was.
			*/}
			<Popover
				placement="bottom-start"
				label="Add an agent"
				class="w-[248px]"
				trigger={(api) => (
					<button
						type="button"
						class="iconbtn max-[640px]:hidden"
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						data-on={api.open ? "soft" : undefined}
						title="Add an agent: pick its runtime"
						aria-label="Add an agent"
						onClick={api.toggle}
					>
						<Icon of={Plus} size={15} />
					</button>
				)}
			>
				<AgentChoices onPick={(kind) => props.onNew(kind)} />
			</Popover>

			<span class="pill-sep max-[360px]:hidden" aria-hidden="true" />
			</Show>

			{/*
				Browse or edit, and it is the first thing after the agent because it changes what
				every control to its right means.

				A pencil when you are browsing (press it to start editing) and a hand when you
				are editing (press it to stop) — the icon is **what pressing it does**, not what
				mode you are in, which is the convention every drawing tool has settled on and
				the opposite of what reads naturally when you write the markup.

				No confirmation. A single press is right for something this reversible, and the
				guard against pressing it by accident is that this button changes, the pencil for a hand
				— what used to stand behind it was a ring around the whole canvas in edit mode, and that
				ring is gone at the request of the person who works in this app (`index.css` says why).
				A dialog in front of a mode switch is a dialog you learn to dismiss without reading.
			*/}
			<Show when={onStage()}>
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
				title={props.mode === "edit" ? "Stop editing, back to browsing" : "Edit the boards: drag components, retype text"}
				aria-label={props.mode === "edit" ? "Stop editing" : "Edit the boards"}
				onClick={() => props.onMode(props.mode === "edit" ? "browse" : "edit")}
			>
				<Icon of={props.mode === "edit" ? Hand : Pencil} size={15} />
			</button>

			{/*
				Draw on the boards, while browsing. Held rather than chosen, like the pencil beside
				it, so it wears the same soft wash; its own tools are a row of their own
				(`InkBar.tsx`), because a pen, a marker, five colours and undo do not fit in here.
				Not offered while editing: a press there already means "this component".
			*/}
			<Show when={props.mode === "browse"}>
				<button
					type="button"
					class="iconbtn"
					data-on={props.drawing ? "soft" : undefined}
					aria-pressed={props.drawing}
					title={props.drawing ? "Stop drawing" : "Draw on the boards"}
					aria-label={props.drawing ? "Stop drawing" : "Draw on the boards"}
					onClick={() => props.onDrawing(!props.drawing)}
				>
					<Icon of={Brush} size={15} />
				</button>
			</Show>


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
			</Show>
		</div>
	);
}

/**
 * A name you rename in place: a button that becomes a field.
 *
 * Two names in this pill work this way — the canvas's and the agent's — and the rules are
 * the same for both: Enter or leaving the field keeps what was typed, Escape keeps the old
 * name, and an empty field is not a name. One component, because a second copy of six lines
 * is where the two come to behave differently.
 *
 * The field is not a `contenteditable` or a permanently-live input: a name that is always
 * editable is a name you rename by mistake while reaching for the chevron beside it.
 */
function EditableName(props: {
	name: string;
	/** What the field is called, for a screen reader. */
	label: string;
	/** The tooltip on the button, which is where the verb is said. */
	title: string;
	/** The button's classes, so the two callers can look like what they sit in. */
	class: string;
	max?: number;
	onRename: (name: string) => void;
}) {
	const [editing, setEditing] = createSignal(false);
	let field: HTMLInputElement | undefined;
	const finish = (keep: boolean) => {
		const next = field?.value.trim() ?? "";
		setEditing(false);
		if (keep && next && next !== props.name) props.onRename(next);
	};
	return (
		<Show
			when={editing()}
			fallback={
				<button type="button" class={props.class} title={props.title} onClick={() => setEditing(true)}>
					{props.name}
				</button>
			}
		>
			<input
				ref={(element) => {
					field = element;
					queueMicrotask(() => element.select());
				}}
				class="pill-name-field"
				value={props.name}
				aria-label={props.label}
				maxLength={props.max ?? 40}
				onKeyDown={(event) => {
					if (event.key === "Enter") finish(true);
					if (event.key === "Escape") {
						event.stopPropagation();
						finish(false);
					}
				}}
				onBlur={() => finish(true)}
			/>
		</Show>
	);
}

/**
 * The open canvas: its name, and the way to the next room.
 *
 * The name is a button that turns into a field: Enter or leaving it keeps the new name, Escape
 * keeps the old one. It used to carry the faces of everybody on the canvas as well, and they
 * are gone: the agent you are talking to is drawn two controls along, so its face was in the
 * line twice, and who else is in the room is a question the panel answers properly.
 *
 * The chevron is the switcher. **Clicking the name renames, clicking the chevron
 * moves** — two verbs on one segment, which is the same division the agent beside it makes
 * (the face is who you are with, the chevron is who else there is), so nothing new has to be
 * learnt to tell them apart.
 */
function CanvasSegment(props: {
	id: string;
	name: string;
	/** Every canvas in the deck; the switcher's list. */
	canvases: Canvas[];
	onRename: (name: string) => void;
	onOpen?: (id: string) => void;
	onNew?: () => void;
	onRemove?: (id: string) => void;
}) {
	/*
	 * A bin on every row, asked twice, as the panel's canvas rows ask: the first press arms
	 * it and the second removes. One armed at a time — arming another disarms the first —
	 * and closing the menu forgets it.
	 */
	const [armed, setArmed] = createSignal<string | undefined>();
	let waiting: ReturnType<typeof setTimeout> | undefined;
	const disarm = () => {
		clearTimeout(waiting);
		setArmed(undefined);
	};
	const pressBin = (id: string) => {
		if (armed() !== id) {
			clearTimeout(waiting);
			setArmed(id);
			waiting = setTimeout(disarm, 4000);
			return;
		}
		disarm();
		props.onRemove?.(id);
	};
	return (
		<span class="pill-canvas">
			<EditableName
				name={props.name}
				label="Canvas name"
				title="Rename this canvas"
				class="chipbtn pill-name"
				onRename={props.onRename}
			/>
			{/*
				The rooms, from the room you are in.
				
				Ordered as the server sends them, which is by name: a shelf you can predict beats
				one that reshuffles itself as agents work. The dot is the canvas's own changed mark
				(`isNews`) — something was put up there since you last looked — and it is the one
				reason to leave a room you had not thought of leaving.
			*/}
			<Show when={props.onOpen ?? props.onNew}>
				<Popover
					placement="bottom-start"
					label="Canvases"
					class="w-[248px]"
					onOpenChange={disarm}
					trigger={(api) => (
						<button
							type="button"
							class="iconbtn"
							ref={api.ref}
							aria-haspopup="menu"
							aria-expanded={api.open}
							data-on={api.open ? "soft" : undefined}
							title="Open another canvas"
							aria-label={`Canvases — currently ${props.name}`}
							onClick={api.toggle}
						>
							<Icon of={ChevronDown} size={12} />
						</button>
					)}
				>
					<For each={props.canvases}>
						{(canvas) => (
							<div class="row-act">
							<button
								type="button"
								class="min-w-0 flex-1"
								role="menuitem"
								data-row
								data-flat="true"
								/* Washed, not ticked, exactly as the agent rows are: the row describes the
								   room you are already in rather than a setting you have chosen. */
								data-current={canvas.id === props.id ? "true" : undefined}
								onClick={() => props.onOpen?.(canvas.id)}
							>
								<span class="lb nm block truncate">{canvas.name}</span>
								<Show when={canvas.id === props.id}>
									<span class="meta flex-none text-[10px]">you are here</span>
								</Show>
								<Show when={canvas.id !== props.id && isNews(canvas)}>
									<span class="pill-canvas-news" aria-label="Something new here" />
								</Show>
							</button>
							<Show when={props.onRemove}>
								<button
									type="button"
									class="close"
									data-armed={armed() === canvas.id ? "true" : undefined}
									title={armed() === canvas.id ? `Press again to remove ${canvas.name} — its boards stay` : `Remove ${canvas.name}`}
									aria-label={armed() === canvas.id ? `Remove ${canvas.name} — press again to confirm` : `Remove ${canvas.name}`}
									onClick={(event) => {
										event.stopPropagation();
										pressBin(canvas.id);
									}}
								>
									<Icon of={Trash2} size={12} />
								</button>
							</Show>
							</div>
						)}
					</For>
					<Show when={props.onNew}>
						<div class="rule" />
						<button type="button" role="menuitem" data-row data-flat="true" onClick={() => props.onNew?.()}>
							<Icon of={Plus} size={13} class="flex-none text-muted" />
							<span class="lb flex-1 whitespace-nowrap">New canvas</span>
						</button>
					</Show>
				</Popover>
			</Show>
			<span class="pill-sep" aria-hidden="true" />
		</span>
	);
}

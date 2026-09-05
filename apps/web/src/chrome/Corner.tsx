import type { AgentChat, AgentKind, AgentUsage, Identity } from "@decks/protocol";
import type { LucideIcon } from "lucide-solid";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Maximize from "lucide-solid/icons/maximize";
import MessageSquare from "lucide-solid/icons/message-square";
import Eraser from "lucide-solid/icons/eraser";
import FilePlus from "lucide-solid/icons/file-plus";
import MoreHorizontal from "lucide-solid/icons/more-horizontal";
import ZoomIn from "lucide-solid/icons/zoom-in";
import ZoomOut from "lucide-solid/icons/zoom-out";
import { For, Show } from "solid-js";
import { Icon } from "../icons.tsx";
import { historyButton, toggleHistory } from "../lib/edge.ts";
import { Popover } from "../ui/Popover.tsx";
import { AgentStack } from "./AgentStack.tsx";
import { agentOrder } from "./agent-order.ts";
import { contextLevel, contextPercent } from "./context-usage.ts";
import { ContextRing } from "./ContextRing.tsx";

/**
 * The top-right cluster: who is working, how close you are, and the way into the
 * conversation.
 *
 * Four things in one 40px pill, in that order, and the order is the argument: the faces are
 * the most informative thing in this corner, so they are furthest from the edge and they
 * are the last thing to fold. Under 1100px **the faces stay and the zoom chip goes into
 * `⋯`** — three faces plus the chip take 106px and earn every one of them, while a
 * percentage you can also read from the canvas does not.
 *
 * As with the left cluster, the folding is Tailwind variants in the markup rather than a
 * `@media` block in `agents.css`: a layer keeps its precedence inside a media query, so the
 * stylesheet would lose to the utilities on the same element and do nothing at all.
 */

/** The zoom stops the menu offers, as percentages. */
const STOPS = [50, 100, 200];
/** The same limits the old zoombar used, so a menu row and a wheel gesture agree. */
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 4;
/** One notch, matching the buttons this menu replaced. */
const STEP = 1.25;

/*
 * The zoom chip folds away under 1100px; the faces and the two buttons stay.
 *
 * Written out at each site rather than held in a constant, because Tailwind finds classes
 * by scanning the source text — a class name assembled from a variable compiles, runs, and
 * quietly generates no CSS at all.
 */

export function Corner(props: {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onNew: (kind?: AgentKind) => void;
	/** Passed through to the `+n` chip's dropdown, which is the pill's list. */
	onClose: (id: string) => void;
	defaultKind: AgentKind;
	/** The camera's scale, 1 being 100%. */
	zoom: number;
	onZoom: (zoom: number) => void;
	/** Frame what is on the canvas — the `0` key's job, and the button beside the readout. */
	onFit: () => void;
	/** A new, empty board, straight onto the canvas. */
	onNewBoard: () => void;
	/**
	 * Take every board off the canvas.
	 *
	 * Off the canvas and *not* out of the agent's context — the context is the agent's, and
	 * nobody should be able to strip what it is working from by tidying the view. That is
	 * the same distinction `board.hide` has always drawn, said with a button.
	 */
	onClearStage: () => void;
	/** Whether there is anything up there to clear. */
	onCanvas: number;
	/**
	 * How full the focused agent's context is, and what it has cost. Drawn inside `⋯`.
	 *
	 * It used to be a ring under the input bar. The menu is where a number you read rather
	 * than act on belongs — see `ContextSummary.tsx` — and the only part that has to stay
	 * outside is the warning, which is why the trigger below takes its level.
	 */
	usage?: AgentUsage;
	/**
	 * Open the usage panel — the plan, the spend, and what has been driving it.
	 *
	 * The `⋯` row's job, on a touchscreen only: a phone has no dial under the input bar, so
	 * the reading it does have here is also the way in to the rest of it.
	 */
	onContext: () => void;
	/** The `⋯` menu, which is the integrator's: it collects whatever has folded. */
	/**
	 * The three secondary controls, as menu rows at every width.
	 *
	 * Passed in rather than built here, because what belongs in an overflow is a question
	 * about the *app* — the canvas cheat sheet, the settings, the theme — and this
	 * component's business is the corner. A callback would have been the smaller API and
	 * the wrong one: it leaves the caller to invent a second menu, and then there are two
	 * menus in one corner disagreeing about their shadows.
	 */
	overflow: Array<{ label: string; icon: LucideIcon; note?: string; onPick: () => void }>;
}) {
	const percent = () => Math.round(props.zoom * 100);
	const clamp = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

	/*
	 * Whether the stack drew anything, asked here rather than reported by it.
	 *
	 * The separator after the faces belongs to this pill, not to the stack — and it must not
	 * be drawn when there is nothing on its left. Nothing active is the *common* case and it
	 * should look like the common case: a zoom chip and two buttons, exactly what the polish
	 * pass drew, with no hairline hanging off the end.
	 */
	const anyActive = () => agentOrder(props.chats, props.unread, props.focused).length > 0;

	return (
		<div class="float pill absolute top-3 right-3 z-20" data-inset="top">
			<AgentStack
				chats={props.chats}
				identities={props.identities}
				focused={props.focused}
				unread={props.unread}
				onFocus={props.onFocus}
				onNew={props.onNew}
				onClose={props.onClose}
				defaultKind={props.defaultKind}
			/>

			<Show when={anyActive()}>
				{/* Between the faces and the camera — and gone with the faces, which leave on a
				    coarse pointer. A hairline with nothing on one side of it is not a divider. */}
				<span class="pill-sep pointer-coarse:hidden" aria-hidden="true" />
			</Show>

			{/*
			 * The zoom readout is the control.
			 *
			 * It used to be three buttons and a number that did nothing — the number is the
			 * thing you read and the thing you want to change, so pressing it is the shortest
			 * route between the two. `--control-md` rather than `--control`, because a labelled
			 * chip is read far more often than it is pressed.
			 */}
			<span class="flex items-center max-[1100px]:hidden">
				<Popover
					placement="bottom-end"
					label="Zoom"
					class="w-[196px]"
					trigger={(api) => (
						<button
							type="button"
							class="chipbtn tabular-nums"
							ref={api.ref}
							aria-haspopup="menu"
							aria-expanded={api.open}
							title="Zoom"
							aria-label={`Zoom — ${percent()}%`}
							onClick={api.toggle}
						>
							{percent()}%
							<Icon of={ChevronDown} size={10} class="chev" />
						</button>
					)}
				>
					<For each={STOPS}>
						{(stop) => (
							<button
								type="button"
								role="menuitem"
								data-row
								data-flat="true"
								data-current={percent() === stop ? "true" : undefined}
								onClick={() => props.onZoom(stop / 100)}
							>
								<span class="lb flex-1 tabular-nums">{stop}%</span>
							</button>
						)}
					</For>

					<div class="rule" />

					{/* The two steps, so the menu is also the place a trackpad-less machine
					    zooms. The factor is the wheel's own, not a rounder number, so pressing
					    a row and rolling a wheel land on the same stops. */}
					{/* `data-keep-open`: a stepper is pressed more than once, so the menu it lives in
					    has to survive the press. Every other row here closes it. */}
					<button type="button" role="menuitem" data-row data-keep-open data-flat="true" onClick={() => props.onZoom(clamp(props.zoom * STEP))}>
						<Icon of={ZoomIn} size={13} class="flex-none text-muted" />
						<span class="lb flex-1">Zoom in</span>
						<span class="meta flex-none text-[10px]">⌘=</span>
					</button>
					<button type="button" role="menuitem" data-row data-keep-open data-flat="true" onClick={() => props.onZoom(clamp(props.zoom / STEP))}>
						<Icon of={ZoomOut} size={13} class="flex-none text-muted" />
						<span class="lb flex-1">Zoom out</span>
						<span class="meta flex-none text-[10px]">⌘-</span>
					</button>
				</Popover>
			</span>

			{/*
			 * Fit, as a button rather than a row in the zoom menu.
			 *
			 * It was the menu's first row, which put the one camera control people reach for
			 * *by name* two clicks and a read behind a percentage — and hid it entirely under
			 * 1100px, where the readout folds away and a trackpad is least likely. It is the
			 * `0` key's twin, and the keyless devices are exactly the ones that need it drawn.
			 *
			 * Beside the readout and inside the camera group, because "how close am I" and
			 * "frame what is up" are the same question asked twice; it folds into `⋯` at 640px
			 * with the other two, where a fourth 44px target would push the pill into the
			 * agent cluster.
			 */}
			<button
				type="button"
				class="iconbtn max-[640px]:hidden"
				title="Fit the boards on the canvas (0)"
				aria-label="Fit the boards on the canvas"
				onClick={() => props.onFit()}
			>
				<Icon of={Maximize} size={15} />
			</button>

			<span class="pill-sep max-[640px]:hidden" aria-hidden="true" />

			{/*
			 * What the canvas holds: one board more, or none at all.
			 *
			 * Beside the camera rather than in the overflow, because these two are about the
			 * *canvas* and the overflow is about the app — the cheat sheet, the settings, the
			 * theme. Adding a board and clearing the stage are the two things you do to a
			 * canvas that are not looking at it.
			 *
			 * Clearing is disabled with nothing up rather than hidden. A control that comes
			 * and goes with the state it acts on is a control you have to hunt for at exactly
			 * the moment you want it, and the count in the title is what says why it is off.
			 */}
			<button
				type="button"
				class="iconbtn max-[640px]:hidden"
				title="A new board, on the canvas"
				aria-label="A new board, on the canvas"
				onClick={() => props.onNewBoard()}
			>
				<Icon of={FilePlus} size={15} />
			</button>
			<button
				type="button"
				class="iconbtn max-[640px]:hidden"
				disabled={props.onCanvas === 0}
				title={
					props.onCanvas === 0
						? "Nothing is on the canvas"
						: `Take all ${props.onCanvas} boards off the canvas — they stay in the agent's context`
				}
				aria-label="Clear the canvas"
				onClick={() => props.onClearStage()}
			>
				<Icon of={Eraser} size={15} />
			</button>

			<span class="pill-sep max-[1100px]:hidden" aria-hidden="true" />

			{/*
			 * The conversation, and its three states.
			 *
			 * `off`, `on`, and `yield` — wanted, but the inspector has the right edge for the
			 * moment. Three rather than two because **yielded must not look like off**: a
			 * button that goes dark when something borrows its surface is a button that has
			 * silently forgotten what you asked it for. `lib/edge.ts` owns the bit; the only
			 * thing here is the translation into the attribute `.iconbtn` draws from.
			 */}
			<button
				type="button"
				class="iconbtn"
				data-on={historyButton() === "on" ? "true" : historyButton() === "yield" ? "yield" : undefined}
				aria-pressed={historyButton() !== "off"}
				title={historyButton() === "yield" ? "Conversation — the inspector has the edge (⌘/)" : "Conversation (⌘/)"}
				aria-label={historyButton() === "off" ? "Show the conversation" : "Hide the conversation"}
				onClick={() => toggleHistory()}
			>
				<Icon of={MessageSquare} size={15} />
			</button>

			{/* Everything that folded, plus the deck's own commands. Its contents are the
			    integrator's — this is the handle. */}
			<Popover
				placement="bottom-end"
				label="More"
				class="w-[248px]"
				trigger={(api) => (
					<button
						ref={api.ref}
						type="button"
						class="iconbtn"
						aria-haspopup="menu"
						aria-expanded={api.open}
						data-on={api.open ? "soft" : undefined}
						/*
						 * The context warning, on the outside of the menu it moved into.
						 *
						 * Amber over 70% and red over 85%, on the glyph itself. A dial under the
						 * input bar told you this without being asked; a menu cannot, and a full
						 * context that only announces itself once you happen to open `⋯` is the
						 * one reading this app should never make you go and look for. Nothing at
						 * all below 70%, so the corner is unmarked in the ordinary case.
						 */
						data-level={contextLevel(props.usage)}
						title={
							contextLevel(props.usage)
								? `More — the context is ${Math.round(((props.usage?.contextTokens ?? 0) / (props.usage?.contextWindow || 1)) * 100)}% full`
								: "More"
						}
						aria-label="More"
						onClick={api.toggle}
					>
						<Icon of={MoreHorizontal} size={15} />
					</button>
				)}
			>
				{/*
					How full the context is — **one row, and only on a touchscreen.**
					
					The whole summary used to be inlined here at every width, and that was half
					right. On a phone there is no room under the input bar for anything, so a menu
					is the only place it can live. On a desktop it is back where it started, at the
					right end of the hint row under the box (`composer/ContextDial.tsx`): a reading
					you glance at twenty times an hour should not be behind a menu you have to open
					to take the glance.
					
					A row rather than the summary, because a menu is a list of places to go and this
					is now one of them — it opens the same numbers as a modal, which is the shape a
					phone can actually show them in.
				*/}
				<Show when={props.usage && contextPercent(props.usage) !== undefined}>
					<button
						type="button"
						role="menuitem"
						data-row
						data-flat="true"
						class="hidden pointer-coarse:flex"
						onClick={props.onContext}
					>
						<span class="ic">
							<ContextRing usage={props.usage} size={15} />
						</span>
						<span class="lb flex-1">Context usage</span>
						<span class="meta flex-none tabular-nums">{Math.round(contextPercent(props.usage) ?? 0)}%</span>
					</button>
					<span class="rule hidden pointer-coarse:block" />
				</Show>

				{/*
					The same three, as rows, on a screen too narrow for them.

					Four 44px buttons and a chip do not fit a 393px line beside a 184px pill —
					adding them to the corner is what pushed the two clusters back into overlap,
					which is the one thing a floating chrome cannot do. So on a phone they fold
					in here, where the app's own controls already are, and the menu is the only
					thing that grows.
				*/}
				<button
					type="button"
					data-row
					data-flat="true"
					class="hidden max-[640px]:flex"
					onClick={() => props.onFit()}
				>
					<span class="ic">
						<Icon of={Maximize} size={15} />
					</span>
					<span class="lb">Fit the boards</span>
				</button>
				<button
					type="button"
					data-row
					data-flat="true"
					class="hidden max-[640px]:flex"
					onClick={() => props.onNewBoard()}
				>
					<span class="ic">
						<Icon of={FilePlus} size={15} />
					</span>
					<span class="lb">A new board</span>
				</button>
				<button
					type="button"
					data-row
					data-flat="true"
					class="hidden max-[640px]:flex"
					disabled={props.onCanvas === 0}
					onClick={() => props.onClearStage()}
				>
					<span class="ic">
						<Icon of={Eraser} size={15} />
					</span>
					<span class="lb">Clear the canvas</span>
				</button>
				<span class="rule hidden max-[640px]:block" />

				<For each={props.overflow}>
					{(item) => (
						<button type="button" data-row data-flat={item.note ? undefined : "true"} onClick={item.onPick}>
							<span class="ic">
								<Icon of={item.icon} size={15} />
							</span>
							<span class="lb">{item.label}</span>
							<Show when={item.note}>{(note) => <span class="nt">{note()}</span>}</Show>
						</button>
					)}
				</For>
			</Popover>
		</div>
	);
}

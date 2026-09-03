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
import { createSignal, For, Show, type JSX } from "solid-js";
import { AgentMark } from "../chat/agent-marks.tsx";
import type { Tool } from "../canvas/Editor.ts";
import { Icon } from "../icons.tsx";
import { Popover, type Placement } from "../ui/Popover.tsx";
import { agentList, agentStatus, rowWords } from "./agent-order.ts";

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
 * No last line on a row, and no close button. The rows say *state*, not content: a 264px
 * row with a truncated sentence in it is the chat list, which is what the hover card and
 * the boards panel are for. And a `×` per row could not be reached from the keyboard —
 * `Popover` treats Tab on a row as "pick this one and close", which is the completion
 * behaviour that makes the list usable without a mouse and is worth more than a second
 * control per row. Closing a chat stays in the panel's list, where it always was.
 */
export function AgentMenu(props: {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	/** `kind` is the runtime, chosen here because it cannot change afterwards. */
	onNew: (kind?: AgentKind) => void;
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
					return (
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
							onClick={() => pick(() => props.onFocus(chat.id))}
						>
							<AgentFace chat={chat} identity={props.identities[chat.id]} unread={props.unread[chat.id] ?? 0} size={20} ring={1.5} />
							{/* `block`, because `.lb` is a flex row and `text-overflow` does not apply to one —
							    a long name would have overflowed the row rather than ellipsing. */}
							<span class="lb block truncate">{name()}</span>
							<span class="meta flex-none text-[10px] tabular-nums">{rowWords(status(), chat.state, chat.lastAt)}</span>
						</button>
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
			<div class="flex items-center gap-1">
				<button type="button" role="menuitem" data-row data-flat="true" class="min-w-0 flex-1" onClick={() => pick(() => props.onNew(props.defaultKind))}>
					<Icon of={Plus} size={13} class="flex-none text-muted" />
					<span class="lb font-normal">New agent</span>
				</button>
				<button
					type="button"
					role="menuitem"
					data-row
					data-flat="true"
					class="flex-none px-2 text-[11px] text-faint"
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
							<span class="lb flex-1 font-normal">New {kind} agent</span>
							<Show when={kind === props.defaultKind}>
								<Icon of={Check} size={13} class="flex-none text-faint" />
							</Show>
						</button>
					)}
				</For>
			</Show>
		</Popover>
	);
}

export function AgentPill(props: {
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onNew: (kind?: AgentKind) => void;
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
		<div class="float pill absolute top-3 left-3 z-20" data-inset="top">
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

			<span class="pill-sep" aria-hidden="true" />

			{/* The active agent, with the same ring it would carry in the corner — which is
			    also why it has no face over there. A face in two corners is one too many. */}
			<Show
				when={active()}
				fallback={
					<span class="label px-1">No agent</span>
				}
			>
				{(chat) => (
					<span class="flex min-w-0 items-center gap-[7px] pl-0.5">
						<AgentFace chat={chat()} identity={props.identities[chat().id]} unread={props.unread[chat().id] ?? 0} />
						<span class="truncate text-[12px] font-semibold">{name()}</span>
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
								<span class="lb flex-1 font-normal">{entry.label}</span>
								<span class="meta flex-none text-[10px]">{entry.key}</span>
							</button>
						)}
					</For>
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
						<span class="pill-sep" aria-hidden="true" />
						<button
							type="button"
							class="iconbtn"
							title="Undo the last edit to this board (⌘Z)"
							aria-label="Undo the last edit to this board"
							onClick={() => undo()()}
						>
							<Icon of={Undo2} size={15} />
						</button>
					</>
				)}
			</Show>
		</div>
	);
}

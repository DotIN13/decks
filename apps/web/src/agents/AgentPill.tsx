import { formatNumber, m } from "@decks/i18n";
import type { AgentChat, AgentKind, Identity } from "@decks/protocol";
import type { LucideIcon } from "lucide-solid";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import PanelLeft from "lucide-solid/icons/panel-left";
import Plus from "lucide-solid/icons/plus";
import Search from "lucide-solid/icons/search";
import Brush from "lucide-solid/icons/brush";
import MousePointer from "lucide-solid/icons/mouse-pointer-2";
import { createSignal, For, Show, type JSX } from "solid-js";
import { AgentMark } from "@decks/ui/agent-marks";
import type { CanvasMode } from "../state/selection.ts";
import { DecksMark, Icon, type Placement, Popover } from "@decks/ui";
import { runtimes } from "../state/deck.ts";
import { agentList, agentStatus, dropdownFaces, workspaceRuns } from "./agent-order.ts";
import { AgentMenuRow } from "./AgentMenuRow.tsx";
import { createMenuCard } from "./menu-card.ts";
import { AgentHoverCard } from "./AgentHoverCard.tsx";
import { AuthedImg } from "../lib/authed.tsx";

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
 * The tools that add things, and undo and redo, are the stage's own, in a column on the canvas's
 * left edge (`canvas/pen/PenBar.tsx`). A board's own edits still undo with ⌘Z inside the board.
 *
 * Presentational on purpose. It takes the chats, the identities and a callback per verb —
 * nothing here reads the socket or `App`'s state, so the whole cluster can be drawn from a
 * fixture.
 */

/**
 * An agent's face: its avatar or its initial, filled with *who* and ringed with *what*.
 *
 * Here, because the things that draw this circle — this pill, a dropdown row, the hover card —
 * differ only in
 * the diameter. Everything else is `styles/agents.css`;
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
	/** Diameter: 26 in the corner stack, 20 in the pill and a dropdown row, 24 when omitted. */
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
				{(src) => <AuthedImg src={src()} alt="" />}
			</Show>
		</span>
	);
}

/**
 * Every runtime an agent can be, as rows — the whole of "add an agent", written once.
 *
 * One list, behind one `+` (`NewAgentButton`) wherever an agent can be made: the top-left
 * pill, the composer and the panel. A live session cannot swap the process behind it, so
 * choosing a runtime *is* creating the agent — and a list copied per caller is how "New claude
 * agent" and "New Claude agent" end up in the same menu as two different things.
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
					<span class="menu-tile" aria-hidden="true">
						<AgentMark class="flex-none" agent={runtime.kind} size={13} />
					</span>
					<span class="row-label flex-1">{runtime.label}</span>
					<Show when={!runtime.available}>
						<span class="menu-note">{m.agents_not_installed()}</span>
					</Show>
				</button>
			)}
		</For>
	);
}

/**
 * Add an agent: a `+` that opens the runtimes, and picking one makes the agent.
 *
 * The same button and the same list in the top-left pill, the composer and the panel, so
 * "new agent" is one control learned once. The agent list itself only switches.
 */
export function NewAgentButton(props: {
	onNew: (kind: AgentKind) => void;
	placement?: Placement;
	/** Said in the tooltip and to a screen reader: "Add an agent", or "…in political-llm". */
	label?: string;
	class?: string;
	size?: number;
	/** Words beside the `+`, for a row that says what it does ("New agent"). */
	text?: string;
}) {
	let dismiss: (() => void) | undefined;
	return (
		<Popover
			placement={props.placement ?? "bottom-start"}
			label={m.agents_add()}
			class="w-[248px]"
			trigger={(api) => {
				dismiss = () => api.open && api.toggle();
				return (
					<button
						type="button"
						class={`icon-button new-agent ${props.class ?? ""}`}
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						data-on={api.open ? "soft" : undefined}
						title={m.agents_add_title({ label: props.label ?? m.agents_add() })}
						aria-label={props.label ?? m.agents_add()}
						onClick={api.toggle}
					>
						<Icon of={Plus} size={props.size ?? 15} />
						<Show when={props.text}>{(text) => <span class="new-agent-text">{text()}</span>}</Show>
					</button>
				);
			}}
		>
			<AgentChoices
				onPick={(kind) => {
					dismiss?.();
					props.onNew(kind);
				}}
			/>
		</Popover>
	);
}

/**
 * The agent list — every agent, and the only place an idle one appears.
 *
 * Exported because three controls open it: the chevron beside the active agent's name, the
 * `+n` chip in the top-right stack, and the composer's recipient chip. One list, three ways
 * in — so it is a component with a `trigger` rather than markup inside the pill.
 *
 * No last line on a row. The rows say *state*, not content: the last thing an agent said is
 * for the hover card and the panel's two-line rows.
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
	/** Take a chat off the list. The transcript is a file on disk and stays there. */
	onClose: (id: string) => void;
	/** The control that opens it, given `Popover`'s api so it can draw itself pressed. */
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	placement?: Placement;
	label?: string;
	/** Open the Agents panel, for the agents this list has no room for. Without it, the count is only said. */
	onMore?: () => void;
	/** Make an agent: a last row, "New agent", that opens the runtimes as a submenu beside it. */
	onNew?: (kind: AgentKind) => void;
}) {
	/* The one hover card the rows share, beside the menu (`menu-card.ts`). */
	const card = createMenuCard(() => props.chats);

	/*
	 * `Popover` closes on Escape and on a press outside, but a row picked *inside* it has to
	 * say so — and the card's children are not handed an api. So the trigger's `toggle` is
	 * kept as it renders, which is always before the card exists.
	 */
	let dismiss: (() => void) | undefined;

	const pick = (run: () => void) => {
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
	/* What the find field asks for: a name or a workspace. While it holds words every match is listed. */
	const [find, setFind] = createSignal("");
	const found = () => {
		const q = find().trim().toLowerCase();
		if (!q) return props.chats;
		return props.chats.filter((chat) => `${props.identities[chat.id]?.name ?? chat.name}\n${props.identities[chat.id]?.workspace ?? ""}`.toLowerCase().includes(q));
	};
	const listed = () => (find().trim() ? { shown: agentList(found(), props.unread, props.focused), more: 0 } : dropdownFaces(agentList(props.chats, props.unread, props.focused)));
	/**
	 * The same rows, cut into workspace runs — and nothing at all when nobody has one.
	 *
	 * A heading over a run of rows is what the panel does with a section; this is the same idea
	 * in a 264px card, where there is no room for three of them and the cap already says how many
	 * rows it is not drawing. See `workspaceRuns`: the rows keep the order they were ranked in,
	 * and the headings appear only once there is more than one group to tell apart.
	 */
	const runs = (): Array<{ label: string | undefined; chats: AgentChat[] }> => workspaceRuns(listed().shown, props.identities);

	return (
		<Popover
			placement={props.placement ?? "bottom-start"}
			label={props.label ?? m.agents_agents()}
			class="w-[280px]"
			onOpenChange={(open) => {
				if (!open) setFind("");
			}}
			trigger={(api) => {
				dismiss = () => api.open && api.toggle();
				return props.trigger(api);
			}}
		>
			<label class="field menu-find">
				<Icon of={Search} size={13} class="shrink-0 text-faint" />
				<input type="text" placeholder={m.agents_find()} aria-label={m.agents_find()} value={find()} onInput={(event) => setFind(event.currentTarget.value)} />
			</label>
			<Show when={find().trim() && found().length === 0}>
				<p class="m-0 px-2 py-2 text-note text-faint">{m.agents_find_none()}</p>
			</Show>
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
							{(chat) => (
								<AgentMenuRow
									chat={chat}
									identity={props.identities[chat.id]}
									unread={props.unread[chat.id] ?? 0}
									current={props.focused === chat.id}
									onPick={() => pick(() => props.onFocus(chat.id))}
									onClose={() => props.onClose(chat.id)}
									onPoint={(row) => card.point(chat.id, row)}
									onUnpoint={() => card.unpoint(chat.id)}
								/>
							)}
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
				<Show
					when={props.onMore}
					fallback={
						<p class="m-0 px-2 py-1.5 text-note leading-normal text-faint">
							{m.agents_menu_more_open({ count: listed().more, shown: formatNumber(listed().more) })}
						</p>
					}
				>
					{(more) => (
						<button type="button" role="menuitem" data-row data-flat="true" class="agent-menu-more" onClick={() => more()()}>
							<Icon of={PanelLeft} size={13} class="flex-none text-muted" />
							<span class="row-label flex-1 whitespace-nowrap">
								{m.agents_menu_more({ count: listed().more, shown: formatNumber(listed().more) })}
							</span>
							<span class="meta flex-none text-micro">{m.agents_panel()}</span>
						</button>
					)}
				</Show>
			</Show>

			{/*
				Adding an agent from the list you choose one from: a row that opens the runtimes
				beside it. `aria-haspopup="menu"` keeps this menu open while its submenu is.
			*/}
			<Show when={props.onNew}>
				{(onNew) => (
					<>
						<div class="rule" aria-hidden="true" />
						<Popover
							placement="right-start"
							label={m.agents_new()}
							class="w-[248px]"
							trigger={(api) => (
								<button
									type="button"
									role="menuitem"
									data-row
									data-flat="true"
									class="agent-menu-new"
									ref={api.ref}
									aria-haspopup="menu"
									aria-expanded={api.open}
									data-on={api.open ? "soft" : undefined}
									onClick={api.toggle}
								>
									<Icon of={Plus} size={13} class="flex-none text-muted" />
									<span class="row-label flex-1">{m.agents_new()}</span>
									<Icon of={ChevronRight} size={13} class="flex-none text-faint" />
								</button>
							)}
						>
							<AgentChoices
								onPick={(kind) => {
									dismiss?.();
									onNew()(kind);
								}}
							/>
						</Popover>
					</>
				)}
			</Show>

			{/*
				One card for the whole menu, mounted with it and only unhidden on hover.
				
				`beside`, not under: a card centred beneath a row would cover the rows below it,
				which are the ones being compared. It is the same component the corner faces
				summon — the detail lives in one place and is reachable from either list.
			*/}
			<Show when={card.describing()}>
				{(chat) => <AgentHoverCard chat={chat()} identity={props.identities[chat().id]} unread={props.unread[chat().id] ?? 0} anchor={card.anchor()} shown={card.shown()} beside />}
			</Show>
		</Popover>
	);
}

export function AgentPill(props: {
	/**
	 * The canvas's mode (`state/selection.ts`). This pill only ever asks for browse: a board is a
	 * *document* — text selects and copies, a game plays, a click is an ordinary click — and
	 * what is drawn still moves and retypes. Its pages are never edited from the canvas.
	 */
	mode: CanvasMode;
	onMode: (mode: CanvasMode) => void;
	/** Whether the draw tool is on, and how to turn it on and off. Browse mode only. */
	drawing: boolean;
	onDrawing: (drawing: boolean) => void;
	/** Whether the boards panel is showing. A button, not a hover — folded means gone. */
	panelOpen: boolean;
	onTogglePanel: () => void;
	/** The agents, for the switcher: a face and a name, one button, opening the agent list. */
	chats: AgentChat[];
	identities: Record<string, Identity>;
	focused: string | undefined;
	unread: Record<string, number>;
	onFocus: (id: string) => void;
	onNew: (kind: AgentKind) => void;
	onClose: (id: string) => void;
	/** Open the Agents panel, from the agent list's overflow row. */
	onMoreAgents?: () => void;
	/**
	 * The stage this conversation is on, and the way to every other one.
	 *
	 * A segment of its own behind the pill's own hairline, marked by a small stage glyph — not
	 * `Ada · deploy`, because a separator in this pill is a hairline everywhere else and a middle
	 * dot would be a second kind of separator on one line.
	 *
	 * The name is absent for a chat that has never drawn on one, and then the glyph stands alone:
	 * the way in cannot depend on already being somewhere. The whole segment is absent only when
	 * the deck keeps no stages at all.
	 */
	stage?: string;
	onStages?: () => void;
	stagesOpen?: boolean;
	/**
	 * The canvas on screen is a friend's, shared with you to view: who shared it. The pill says so
	 * beside the canvas's name, with the way to change it, which is your own copy (`onCopy`).
	 */
	viewOnly?: string;
	onCopy?: () => void;
}) {
	const active = () => props.chats.find((chat) => chat.id === props.focused);
	const name = () => {
		const chat = active();
		return chat ? (props.identities[chat.id]?.name ?? chat.name) : undefined;
	};

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
				class="icon-button"
				data-on={props.panelOpen ? "soft" : undefined}
				aria-pressed={props.panelOpen}
				title={m.agents_side_panel_title()}
				aria-label={props.panelOpen ? m.agents_side_panel_hide() : m.agents_side_panel_show()}
				onClick={() => props.onTogglePanel()}
			>
				<Icon of={PanelLeft} size={15} />
			</button>

			{/* Hairlines are decoration, and the first thing to go when the line is short. */}
			<span class="pill-sep" aria-hidden="true" />

			{/*
			 * The agent whose stage this is: its face and its name, as one button. Pressing it
			 * opens the agent list, and picking a row goes to that agent's stage.
			 *
			 * The name stops at 160px.
			 */}
			<AgentMenu
				chats={props.chats}
				identities={props.identities}
				focused={props.focused}
				unread={props.unread}
				onFocus={props.onFocus}
				onClose={props.onClose}
				{...(props.onMoreAgents ? { onMore: props.onMoreAgents } : {})}
				label={m.agents_agents()}
				trigger={(api) => (
					<button
						type="button"
						class="chip-button pill-agent"
						ref={api.ref}
						aria-haspopup="menu"
						aria-expanded={api.open}
						data-on={api.open ? "soft" : undefined}
						title={m.agents_switch()}
						aria-label={name() ? m.agents_pill_label({ name: name()! }) : m.agents_agents()}
						onClick={api.toggle}
					>
						<Show when={active()} fallback={<span class="pill-agent-name">{m.agents_none()}</span>}>
							{(chat) => <AgentFace chat={chat()} identity={props.identities[chat().id]} unread={props.unread[chat().id] ?? 0} size={20} ring={1.5} />}
						</Show>
						<Show when={name()}>{(label) => <span class="pill-agent-name">{label()}</span>}</Show>
						<Icon of={ChevronDown} size={12} />
					</button>
				)}
			/>
			<NewAgentButton onNew={props.onNew} />

			{/*
				The stage: what this agent's work is kept in, and the button that opens the manager.

				It had never been on screen at all, so two stages looked like one canvas that had
				changed. The name goes where it is read with the agent — this pill is already the
				answer to "whose work am I looking at" — and pressing it is the answer to "what else
				is there" (`canvases/CanvasManager.tsx`).
			*/}
			<Show when={props.onStages}>
				{(_on) => (
					<>
						<span class="pill-sep" aria-hidden="true" />
						<button
							type="button"
							class="chip-button pill-agent pill-stage"
							data-on={props.stagesOpen ? "soft" : undefined}
							aria-haspopup="dialog"
							aria-expanded={props.stagesOpen ?? false}
							title={props.stage ? m.agents_stage_title({ name: props.stage }) : m.agents_stages()}
							aria-label={props.stage ? m.agents_stage_label({ name: props.stage }) : m.agents_stage_none()}
							onClick={() => props.onStages?.()}
						>
							{/* The app's own mark, not a drawing of it: a stage is what the mark is a picture of. */}
							<span class="pill-stage-glyph" aria-hidden="true">
								<DecksMark size={15} />
							</span>
							<Show when={props.stage}>{(name) => <span class="pill-agent-name">{name()}</span>}</Show>
							<Icon of={ChevronDown} size={12} />
						</button>
						<Show when={props.viewOnly}>
							{(owner) => (
								<button
									type="button"
									class="chip-button pill-agent pill-view-only"
									title={m.agents_view_only_title({ owner: owner() })}
									onClick={() => props.onCopy?.()}
								>
									<span class="pill-agent-name">{m.agents_view_only()}</span>
								</button>
							)}
						</Show>
					</>
				)}
			</Show>

			<span class="pill-sep" aria-hidden="true" />


			{/*
				The two modes, as one set, and first after the agent because they change what every
				press on the canvas means: browse (the cursor) reads the boards and moves the drawing,
				draw (the brush) puts the pen on the stage. A board's own page is never edited from
				here. The one in force is pressed, in the accent, as a tool picked from a set is.

				No confirmation. A single press is right for something this reversible, and what guards
				against an accidental one is that the pressed button changes where you can see it.
			*/}
			<div class="mode-set" role="group" aria-label={m.agents_mode()}>
				<button
					type="button"
					class="icon-button"
					data-on={props.mode === "browse" && !props.drawing ? "true" : undefined}
					aria-pressed={props.mode === "browse" && !props.drawing}
					title={m.agents_browse_title()}
					aria-label={m.agents_browse_label()}
					onClick={() => {
						props.onDrawing(false);
						props.onMode("browse");
					}}
				>
					<Icon of={MousePointer} size={15} />
				</button>
				{/* Its own tools are a row of their own (`InkBar.tsx`): a pen, a marker, colours and undo do not fit in here. */}
				<button
					type="button"
					class="icon-button"
					data-on={props.drawing ? "true" : undefined}
					aria-pressed={props.drawing}
					title={m.agents_draw()}
					aria-label={m.agents_draw()}
					onClick={() => {
						// The pen is out only while browsing.
						if (props.mode === "edit") props.onMode("browse");
						props.onDrawing(true);
					}}
				>
					<Icon of={Brush} size={15} />
				</button>
			</div>


		</div>
	);
}

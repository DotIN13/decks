import type { Board, Canvas, Identity } from "@decks/protocol";
import ArrowRightLeft from "lucide-solid/icons/arrow-right-left";
import Check from "lucide-solid/icons/check";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Ellipsis from "lucide-solid/icons/ellipsis";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import Trash2 from "lucide-solid/icons/trash-2";
import { createEffect, createMemo, createSignal, For, type JSX, Match, on, Show, Switch } from "solid-js";
import { Popover } from "../ui/Popover.tsx";
import { Icon } from "../ui/icons.tsx";
import { BoardPicture } from "./BoardPicture.tsx";
import { canvasSections, NO_WORKSPACE, type CanvasSection } from "./canvas-sections.ts";
import { NewWorkspace, WorkspaceField } from "./NewWorkspace.tsx";
import { relativeTime } from "./workspace-panel.ts";

/**
 * The dashboard's landing pane: every canvas as a card, under the workspace it belongs to.
 *
 * A canvas is a small picture of itself — its name, four of its boards, who is working there
 * and whether it changed since you looked — and pressing one grows it into the canvas
 * (`app/canvas-morph.ts` reads the card's rectangle). What this pane adds to the panel's
 * Canvases tab is the pictures; the cut is the same one (`canvas-sections.ts`): workspaces A
 * to Z, `No workspace` last, newest change first inside each. There is no room to be in on
 * the dashboard, so no heading leads.
 *
 * Each heading carries its own **New canvas**, which makes the canvas *in that workspace* and
 * opens it so the name can be typed — a canvas made from under a project heading is in that
 * project, which is the whole reason the button is on the heading rather than in a corner of
 * the pane. Each card carries a menu: rename, move to another workspace (or none), and
 * remove, which drops the arrangement and leaves every board in the deck.
 */

export interface CanvasShelfProps {
	canvases: Canvas[];
	boards: Board[];
	identities: Record<string, Identity>;
	/** Every workspace in use, for the move menu. */
	workspaces: string[];
	/** Open a canvas, with the card's rectangle so the canvas can grow out of it. */
	onOpen: (canvas: Canvas, card: DOMRect) => void;
	/** Make a canvas in this workspace (`undefined` for none), and go to it. */
	onCreate: (workspace: string | undefined) => void;
	onRename: (id: string, name: string) => void;
	/** File a canvas under a workspace, or under none with `null`. */
	onMove: (id: string, workspace: string | null) => void;
	/** Remove the arrangement. The boards stay. */
	onRemove: (id: string) => void;
	/** A new workspace: its first canvas, filed under it and named after it. */
	onNewWorkspace: (name: string) => void;
	/** Boards on no canvas at all: still in the deck, and still changing. */
	onUnfiled: () => void;
}

/** How many pictures a card shows. Four is what fits without the card becoming a gallery. */
const COVER = 4;

export function CanvasShelf(props: CanvasShelfProps) {
	const byPath = createMemo(() => new Map(props.boards.map((board) => [board.path, board])));
	const filed = createMemo(() => new Set(props.canvases.flatMap((canvas) => canvas.boards)));
	const unfiled = createMemo(() => props.boards.filter((board) => !filed().has(board.path)));
	const [query, setQuery] = createSignal("");
	const sections = createMemo(() => canvasSections({ canvases: props.canvases, query: query() }));
	const narrowed = () => query().trim() !== "";
	/** Who is in a workspace, by what the agents themselves say — the heading's count. */
	const agentsIn = (workspace: string | undefined) => Object.values(props.identities).filter((identity) => (identity.workspace ?? "") === (workspace ?? "")).length;

	const cover = (canvas: Canvas) =>
		canvas.boards
			.map((path) => byPath().get(path))
			.filter((board): board is Board => board !== undefined)
			.sort((a, b) => b.rev - a.rev)
			.slice(0, COVER);

	const heading = (section: CanvasSection) => {
		const agents = agentsIn(section.workspace);
		const parts = [`${section.rows.length} canvas${section.rows.length === 1 ? "" : "es"}`];
		if (agents > 0) parts.unshift(`${agents} agent${agents === 1 ? "" : "s"}`);
		return parts.join(" · ");
	};

	return (
		<div class="canvas-shelf">
			{/* The Boards tab's bar, with its search: the same object, so the two tabs read as one dashboard. */}
			<div class="dispatch-gallery-bar canvas-shelf-bar">
				<label class="field dispatch-search">
					<input type="search" spellcheck={false} placeholder="Search canvases or workspaces" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
				</label>
				<NewWorkspace class="canvas-shelf-new-ws" onCreate={props.onNewWorkspace} />
			</div>
			<For each={sections()}>
				{(section) => (
					<section class="canvas-ws" data-workspace={section.workspace ?? ""} aria-label={section.label}>
						<div class="canvas-shelf-head">
							<h2>{section.label}</h2>
							<span class="canvas-ws-sub">{heading(section)}</span>
							<button type="button" class="canvas-new" onClick={() => props.onCreate(section.workspace)} title={section.workspace ? `A new canvas in ${section.workspace}` : "A new canvas in no workspace"}>
								<Icon of={Plus} size={12} />
								New canvas
							</button>
						</div>
						<div class="canvas-cards">
							<For each={section.rows}>
								{(canvas) => {
									const news = () => canvas.changedAt > (canvas.openedAt ?? 0);
									const working = () => canvas.agents.map((id) => props.identities[id]).filter((identity): identity is Identity => identity !== undefined);
									/*
									 * Renamed on the card, not in the menu: the menu's *Rename* opens the name
									 * where it lives, selected, and Enter keeps it while Escape puts it back. The
									 * field sits over the card's name rather than inside it, because the card is
									 * a button and a field inside a button is a press that opens the canvas.
									 */
									const [renaming, setRenaming] = createSignal(false);
									let renameField: HTMLInputElement | undefined;
									let renamed = false;
									const startRename = () => {
										renamed = false;
										setRenaming(true);
										requestAnimationFrame(() => {
											renameField?.focus();
											renameField?.select();
										});
									};
									const endRename = (keep: boolean) => {
										if (renamed) return;
										renamed = true;
										const wanted = renameField?.value.trim() ?? "";
										if (keep && wanted && wanted !== canvas.name) props.onRename(canvas.id, wanted);
										setRenaming(false);
									};
									return (
										<div class="canvas-slot" data-renaming={renaming() ? "true" : undefined}>
											<button
												type="button"
												class="canvas-card"
												data-canvas-id={canvas.id}
												data-news={news() ? "true" : undefined}
												onClick={(event) => props.onOpen(canvas, (event.currentTarget.querySelector(".canvas-strip") ?? event.currentTarget).getBoundingClientRect())}
											>
												<span class="canvas-card-name">
													<Show when={news()}>
														<span class="canvas-dot" aria-label="Something new here" />
													</Show>
													{canvas.name}
												</span>
												<span class="canvas-strip">
													<For each={cover(canvas)}>
														{(board) => (
															<span class="canvas-thumb">
																<BoardPicture board={board} alt="" />
															</span>
														)}
													</For>
													<Show when={cover(canvas).length === 0}>
														<span class="canvas-empty">nothing on it yet</span>
													</Show>
												</span>
												<span class="canvas-who">
													{/* The faces overlap, as the corner's do: a stack reads as "these people", a row of
													    coins as three separate marks to read. */}
													<span class="canvas-faces">
														<For each={working()}>
															{(identity) => (
																<span class="canvas-face" style={{ "--face": identity.color }} title={identity.name}>
																	{identity.name.slice(0, 1)}
																</span>
															)}
														</For>
													</span>
													<span class="canvas-who-text">
														{working().length === 0 ? "nobody here now" : working().map((identity) => identity.name).join(", ")}
													</span>
												</span>
												<span class="canvas-meta">
													{canvas.boards.length} {canvas.boards.length === 1 ? "board" : "boards"}
													<Show when={news()} fallback={<> · nothing new</>}>
														<> · <b>changed since you looked</b></>
													</Show>
													{" · "}
													{relativeTime(canvas.changedAt)}
												</span>
											</button>
											<Show when={renaming()}>
												<input
													ref={renameField}
													type="text"
													class="canvas-rename"
													aria-label={`Rename ${canvas.name}`}
													value={canvas.name}
													spellcheck={false}
													onClick={(event) => event.stopPropagation()}
													onKeyDown={(event) => {
														if (event.key === "Enter") {
															event.preventDefault();
															endRename(true);
														} else if (event.key === "Escape") {
															event.preventDefault();
															event.stopPropagation();
															endRename(false);
														}
													}}
													onBlur={() => endRename(true)}
												/>
											</Show>
											<CanvasMenu
												canvas={canvas}
												workspaces={props.workspaces}
												onRename={startRename}
												onMove={(workspace) => props.onMove(canvas.id, workspace)}
												onRemove={() => props.onRemove(canvas.id)}
											/>
										</div>
									);
								}}
							</For>
						</div>
					</section>
				)}
			</For>
			<Show when={unfiled().length > 0 && !narrowed()}>
				<section class="canvas-ws" aria-label="Boards on no canvas">
					<div class="canvas-cards">
						<button type="button" class="canvas-card canvas-card-unfiled" onClick={() => props.onUnfiled()}>
							<span class="canvas-card-name">Unfiled</span>
							<span class="canvas-strip">
								<For each={unfiled().slice(0, COVER)}>
									{(board) => (
										<span class="canvas-thumb">
											<BoardPicture board={board} alt="" />
										</span>
									)}
								</For>
							</span>
							<span class="canvas-who">
								<span class="canvas-who-text">on no canvas</span>
							</span>
							<span class="canvas-meta">
								{unfiled().length} {unfiled().length === 1 ? "board" : "boards"} · in the deck, on nothing
							</span>
						</button>
					</div>
				</section>
			</Show>
			<Show when={sections().length === 0}>
				<Show
					when={narrowed()}
					fallback={
						<>
							<div class="canvas-shelf-head">
								<h2>Canvases</h2>
								<button type="button" class="canvas-new" onClick={() => props.onCreate(undefined)}>
									<Icon of={Plus} size={12} />
									New canvas
								</button>
							</div>
							<p class="canvas-none">No canvases yet. Make one, or ask an agent for a board and it will make the first.</p>
						</>
					}
				>
					<p class="canvas-none">No canvas matches “{query().trim()}”.</p>
				</Show>
			</Show>
		</div>
	);
}

/**
 * The card's menu: three verbs, and nothing to fill in.
 *
 * *Rename* hands back to the card, which opens its own name. *Move to…* is a disclosure
 * (`aria-expanded`, so the press does not close the menu) onto the list of workspaces, the
 * current one checked, *No workspace* last and *New workspace…* under a rule — the same list
 * the agent window's picker shows. *Remove* asks once, in its own row: the row becomes
 * Cancel and Remove, with the other verbs still where they were, rather than a row that
 * changed its own words and had to be pressed twice. Boards stay in the deck either way.
 */
/**
 * The verbs on a canvas, as a menu's contents: Rename, Move to…, Remove.
 *
 * One component for two menus. The card's `⋯` on the dashboard opens it alone; the pill's
 * canvas name on a stage opens it under the list of canvases (`head`), so the room you are
 * in and the rooms next door are one press, and what you can do to this one is the same
 * three rows in both places. The state — which view, the confirm, the typed workspace —
 * lives here and resets whenever the popover holding it opens.
 */
export function CanvasVerbs(props: {
	canvas: Pick<Canvas, "id" | "name" | "workspace">;
	workspaces: string[];
	/** Whether the popover holding this is open: the views reset on every opening. */
	open: boolean;
	/** Close the popover, after a choice that leaves nothing more to ask. */
	dismiss: () => void;
	onRename: () => void;
	onMove: (workspace: string | null) => void;
	onRemove: () => void;
	/** What sits above the verbs, ruled off: the pill's list of canvases. */
	head?: JSX.Element;
}) {
	const [view, setView] = createSignal<"menu" | "move" | "new">("menu");
	const [wanted, setWanted] = createSignal("");
	const [asking, setAsking] = createSignal(false);
	createEffect(
		on(
			() => props.open,
			(open) => {
				if (!open) return;
				setView("menu");
				setWanted("");
				setAsking(false);
			},
		),
	);
	const pick = (workspace: string | null) => {
		if ((props.canvas.workspace ?? null) !== workspace) props.onMove(workspace);
		props.dismiss();
	};
	const create = () => {
		const name = wanted().trim();
		if (!name) return;
		props.onMove(name);
		props.dismiss();
	};
	return (
		<Switch>
			<Match when={view() === "menu"}>
				<Show when={props.head}>
					{props.head}
					<div class="rule" />
				</Show>
				<button type="button" data-row role="menuitem" class="canvas-menu-rename" onClick={() => props.onRename()}>
					<span class="ic">
						<Icon of={Pencil} size={13} />
					</span>
					<span class="lb">Rename</span>
				</button>
				<button type="button" data-row role="menuitem" aria-expanded={false} class="canvas-menu-move" onClick={() => setView("move")}>
					<span class="ic">
						<Icon of={ArrowRightLeft} size={13} />
					</span>
					<span class="lb">
						Move to…
						<Icon of={ChevronRight} size={12} class="canvas-menu-chev" />
					</span>
				</button>
				<Show
					when={asking()}
					fallback={
						<button type="button" data-row role="menuitem" data-keep-open class="canvas-menu-remove" onClick={() => setAsking(true)}>
							<span class="ic">
								<Icon of={Trash2} size={13} />
							</span>
							<span class="lb">Remove</span>
						</button>
					}
				>
					{/* The row becomes the question, in its own place: the other verbs stay where they were. */}
					<div class="canvas-menu-ask" role="group" aria-label={`Remove ${props.canvas.name}?`}>
						<span class="ic">
							<Icon of={Trash2} size={13} />
						</span>
						<button type="button" class="canvas-btn" onClick={() => setAsking(false)}>
							Cancel
						</button>
						<button
							type="button"
							class="canvas-btn canvas-btn-danger canvas-menu-yes"
							onClick={() => {
								props.onRemove();
								props.dismiss();
							}}
						>
							Remove
						</button>
					</div>
				</Show>
			</Match>
			<Match when={view() === "move"}>
				<div class="canvas-menu-list" role="group" aria-label="Move to workspace">
					<button type="button" class="canvas-menu-back" onClick={() => setView("menu")}>
						<Icon of={ChevronLeft} size={12} />
						Move to
					</button>
					<For each={[...props.workspaces, ""]}>
						{(workspace) => {
							const current = () => (props.canvas.workspace ?? "") === workspace;
							return (
								<button type="button" data-row data-flat="true" data-current={current()} role="menuitemradio" aria-checked={current()} onClick={() => pick(workspace || null)}>
									<span class="lb flex-1">{workspace || NO_WORKSPACE}</span>
									<Show when={current()}>
										<Icon of={Check} size={11} class="text-accent" />
									</Show>
								</button>
							);
						}}
					</For>
					<button type="button" data-row data-flat="true" role="menuitem" aria-expanded={false} class="canvas-menu-new" onClick={() => setView("new")}>
						<span class="lb flex-1">New workspace…</span>
					</button>
				</div>
			</Match>
			<Match when={view() === "new"}>
				<WorkspaceField value={wanted()} onInput={setWanted} onCreate={create} autofocus />
			</Match>
		</Switch>
	);
}

function CanvasMenu(props: { canvas: Canvas; workspaces: string[]; onRename: () => void; onMove: (workspace: string | null) => void; onRemove: () => void }) {
	const [open, setOpen] = createSignal(false);
	let dismiss: (() => void) | undefined;
	return (
		<Popover
			placement="bottom-end"
			class="canvas-menu w-[188px]"
			label={`${props.canvas.name}: rename, move or remove`}
			onOpenChange={setOpen}
			trigger={(api) => {
				dismiss = () => {
					if (api.open) api.toggle();
				};
				return (
					<button
						ref={api.ref}
						type="button"
						class="canvas-more"
						aria-haspopup="menu"
						aria-expanded={api.open}
						aria-label={`${props.canvas.name}: rename, move or remove`}
						title="Rename, move or remove"
						onClick={(event) => {
							event.stopPropagation();
							api.toggle();
						}}
					>
						<Icon of={Ellipsis} size={14} />
					</button>
				);
			}}
		>
			<CanvasVerbs canvas={props.canvas} workspaces={props.workspaces} open={open()} dismiss={() => dismiss?.()} onRename={props.onRename} onMove={props.onMove} onRemove={props.onRemove} />
		</Popover>
	);
}

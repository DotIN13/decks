import type { Board, Canvas, Identity } from "@decks/protocol";
import Check from "lucide-solid/icons/check";
import Ellipsis from "lucide-solid/icons/ellipsis";
import Plus from "lucide-solid/icons/plus";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Popover } from "../ui/Popover.tsx";
import { Icon } from "../ui/icons.tsx";
import { BoardPicture } from "./BoardPicture.tsx";
import { canvasSections, NO_WORKSPACE, type CanvasSection } from "./canvas-sections.ts";
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
	/** Boards on no canvas at all: still in the deck, and still changing. */
	onUnfiled: () => void;
}

/** How many pictures a card shows. Four is what fits without the card becoming a gallery. */
const COVER = 4;

export function CanvasShelf(props: CanvasShelfProps) {
	const byPath = createMemo(() => new Map(props.boards.map((board) => [board.path, board])));
	const filed = createMemo(() => new Set(props.canvases.flatMap((canvas) => canvas.boards)));
	const unfiled = createMemo(() => props.boards.filter((board) => !filed().has(board.path)));
	const sections = createMemo(() => canvasSections({ canvases: props.canvases }));
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
									return (
										<div class="canvas-slot">
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
													<For each={working()}>
														{(identity) => (
															<span class="canvas-face" style={{ "--face": identity.color }} title={identity.name}>
																{identity.name.slice(0, 1)}
															</span>
														)}
													</For>
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
											<CanvasMenu
												canvas={canvas}
												workspaces={props.workspaces}
												onRename={(name) => props.onRename(canvas.id, name)}
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
			<Show when={unfiled().length > 0}>
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
				<div class="canvas-shelf-head">
					<h2>Canvases</h2>
					<button type="button" class="canvas-new" onClick={() => props.onCreate(undefined)}>
						<Icon of={Plus} size={12} />
						New canvas
					</button>
				</div>
				<p class="canvas-none">No canvases yet. Make one, or ask an agent for a board and it will make the first.</p>
			</Show>
		</div>
	);
}

/**
 * The card's menu: rename, move, remove.
 *
 * A `Popover` off a `···` in the card's corner, drawn as a sibling of the card and not inside
 * it, because the card is a button and a button inside a button is not a thing. Rename is a
 * field in the menu rather than a dialog: the name is one word and the card is right there.
 * Remove asks twice, the way a board's delete does — it drops the arrangement only, so it
 * does not deserve a dialog, and it is not undoable, so it does not deserve one press.
 */
function CanvasMenu(props: { canvas: Canvas; workspaces: string[]; onRename: (name: string) => void; onMove: (workspace: string | null) => void; onRemove: () => void }) {
	const [name, setName] = createSignal(props.canvas.name);
	const [moving, setMoving] = createSignal(false);
	const [armed, setArmed] = createSignal(false);
	let dismiss: (() => void) | undefined;
	const commit = () => {
		const wanted = name().trim();
		if (wanted && wanted !== props.canvas.name) props.onRename(wanted);
	};
	return (
		<Popover
			placement="bottom-end"
			class="canvas-menu w-[220px]"
			label={`${props.canvas.name}: rename, move or remove`}
			onOpenChange={(open) => {
				dismiss = undefined;
				setName(props.canvas.name);
				setMoving(false);
				setArmed(false);
				if (!open) commit();
			}}
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
			<label class="canvas-menu-name">
				<span class="nt">Name</span>
				<input
					class="field"
					type="text"
					value={name()}
					spellcheck={false}
					onInput={(event) => setName(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						commit();
						dismiss?.();
					}}
				/>
			</label>
			{/* The move row is a disclosure within the menu (`aria-expanded`), so the press that opens it
			    does not close the menu; the remove row keeps it open for the same reason, to be pressed twice. */}
			<Show
				when={moving()}
				fallback={
					<button type="button" data-row data-flat="true" role="menuitem" aria-expanded={false} onClick={() => setMoving(true)}>
						<span class="lb flex-1">Move to workspace…</span>
						<span class="nt">{props.canvas.workspace ?? "none"}</span>
					</button>
				}
			>
				<div class="canvas-menu-move" role="group" aria-label="Move to workspace">
					<For each={[...props.workspaces, ""]}>
						{(workspace) => {
							const current = () => (props.canvas.workspace ?? "") === workspace;
							return (
								<button
									type="button"
									data-row
									data-flat="true"
									data-current={current()}
									role="menuitemradio"
									aria-checked={current()}
									onClick={() => {
										if (!current()) props.onMove(workspace || null);
										dismiss?.();
									}}
								>
									<span class="lb flex-1">{workspace || NO_WORKSPACE}</span>
									<Show when={current()}>
										<Icon of={Check} size={11} class="text-accent" />
									</Show>
								</button>
							);
						}}
					</For>
				</div>
			</Show>
			<button
				type="button"
				data-row
				data-flat="true"
				role="menuitem"
				class="canvas-menu-remove"
				data-keep-open
				data-armed={armed() ? "true" : undefined}
				onClick={() => {
					if (!armed()) {
						setArmed(true);
						return;
					}
					props.onRemove();
					dismiss?.();
				}}
			>
				<span class="lb flex-1">{armed() ? "Press again to remove" : "Remove"}</span>
				<span class="nt">{armed() ? "boards stay" : ""}</span>
			</button>
		</Popover>
	);
}

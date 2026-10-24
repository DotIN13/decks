import type { Board, DeckPen, StageRow } from "@decks/protocol";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Folder from "lucide-solid/icons/folder";
import Layers from "lucide-solid/icons/layers";
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Icon } from "../ui/icons.tsx";
import { BoardRow } from "./BoardRow.tsx";
import { basename } from "./panel-groups.ts";
import { canvasTree, LIBRARY, type TreeCanvas } from "./canvas-tree.ts";

/** Boards drawn under an opened canvas before a "more" row: a canvas of 200 boards is one press away from all of them. */
const FIRST_BOARDS = 40;

/**
 * The Canvases tab: every canvas in the deck, one level with no folders above it, each opening
 * onto its boards.
 *
 * A press on a canvas's row folds it open or shut; **Open**, which takes the place of its count
 * while the pointer is on the row, moves you to it, as does a double-click. The canvas you are on
 * says "Here" and starts open. A board under the canvas you are on plays as the Boards list always
 * did; one under another canvas opens that canvas, because a board belongs to its canvas's folder
 * and putting it on this one would copy it.
 *
 * The grouping is `canvas-tree.ts`; this is its picture.
 */
export function CanvasTree(props: {
	stages: StageRow[];
	boards: Board[];
	here?: string;
	query: string;
	current?: string;
	inPlay?: string[];
	news?: Record<string, string>;
	folded: Set<string>;
	onToggleFolder: (id: string) => void;
	onPick: (board: Board) => void;
	onOpen?: (canvas: string) => void;
	onDelete?: (board: Board) => void;
	onHide?: (board: Board) => void;
	pens?: DeckPen[];
	onPlacePen?: (pen: DeckPen) => void;
}) {
	const tree = createMemo(() => canvasTree({ stages: props.stages, boards: props.boards, ...(props.here ? { here: props.here } : {}), query: props.query }));
	const searching = () => props.query.trim() !== "";
	const inPlay = createMemo(() => new Set(props.inPlay ?? []));

	/* Which canvases are open: the one you are on unless you shut it, any other once you open it. */
	const [opened, setOpened] = createSignal<Set<string>>(new Set());
	const [shut, setShut] = createSignal<Set<string>>(new Set());
	const [all, setAll] = createSignal<Set<string>>(new Set());
	const isOpen = (one: TreeCanvas) => (searching() ? !one.hit && one.boards.length > 0 : one.here ? !shut().has(one.stage.name) : opened().has(one.stage.name));
	const flip = (set: Set<string>, name: string) => {
		const next = new Set(set);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		return next;
	};
	const toggle = (one: TreeCanvas) => (one.here ? setShut((was) => flip(was, one.stage.name)) : setOpened((was) => flip(was, one.stage.name)));
	const folderOpen = (id: string) => searching() || !props.folded.has(id);

	const pens = () => (props.pens ?? []).filter((pen) => !searching() || pen.title.toLowerCase().includes(props.query.trim().toLowerCase()) || pen.path.includes(props.query.trim()));
	const libraryId = `canvases:${LIBRARY}`;

	const boardRow = (board: Board, one: TreeCanvas | undefined) => (
		<BoardRow
			board={board}
			current={props.current === board.path}
			onCanvas={one?.here === true && inPlay().has(board.path)}
			dim={one?.here === true && !inPlay().has(board.path)}
			{...(props.news?.[board.path] ? { news: props.news[board.path] } : {})}
			{...(props.onDelete ? { onDelete: () => props.onDelete?.(board) } : {})}
			{...(props.onHide ? { onHide: () => props.onHide?.(board) } : {})}
			onPick={() => (one && !one.here ? props.onOpen?.(one.stage.name) : props.onPick(board))}
		/>
	);

	const folder = (id: string, label: string, note: string, body: () => JSX.Element) => (
		<div class="panel-section v3-tree-folder" data-kind="canvases">
			<div class="v3-folder-head" data-folded={folderOpen(id) ? undefined : "true"}>
				<button type="button" class="v3-folder-toggle" aria-expanded={folderOpen(id)} title={folderOpen(id) ? `Fold ${label}` : `Show ${label}`} onClick={() => props.onToggleFolder(id)}>
					<Icon of={folderOpen(id) ? ChevronDown : ChevronRight} size={13} class="v3-folder-chev" />
					<Icon of={Folder} size={15} class="v3-folder-icon" />
					<span class="v3-folder-name truncate">{label}</span>
				</button>
				<span class="note tabular-nums">{note}</span>
			</div>
			<div class="v3-folder-body" data-open={folderOpen(id) ? "true" : "false"} aria-hidden={!folderOpen(id)}>
				<div class="v3-tree">{body()}</div>
			</div>
		</div>
	);

	return (
		<>
			<div class="v3-tree v3-tree-flat">
				<For each={tree().canvases}>
				{(one) => {
					const shown = () => (all().has(one.stage.name) || searching() ? one.boards : one.boards.slice(0, FIRST_BOARDS));
					return (
						<div class="v3-tree-canvas" data-open={isOpen(one) ? "true" : "false"}>
							<div class="v3-canvas-row" data-here={one.here ? "true" : undefined}>
								<button
									type="button"
									class="v3-canvas-toggle"
									data-row
									aria-expanded={isOpen(one)}
									title={one.here ? `${one.stage.title}: the canvas you are on` : `${one.stage.title}: press to see its boards, double-click to open it`}
									onClick={() => toggle(one)}
									onDblClick={() => !one.here && props.onOpen?.(one.stage.name)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !one.here) {
											event.preventDefault();
											props.onOpen?.(one.stage.name);
										}
									}}
								>
									<span class="v3-twist" aria-hidden="true">
										<Icon of={ChevronRight} size={12} />
									</span>
									<Icon of={Layers} size={14} class="v3-canvas-icon" />
									<span class="v3-canvas-name truncate">{one.stage.title}</span>
									<Show when={one.here}>
										<span class="v3-here">Here</span>
									</Show>
									<span class="v3-canvas-rest">
										<Show when={one.stage.agents.length > 0}>
											<span class="v3-faces" aria-label={one.stage.agents.map((agent) => agent.name).join(", ")}>
												<For each={one.stage.agents.slice(0, 3)}>
													{(agent) => (
														<span class="v3-face" style={{ background: agent.color }} title={agent.name}>
															{agent.name.slice(0, 1).toUpperCase()}
														</span>
													)}
												</For>
											</span>
										</Show>
										<Show when={!one.here}>
											<span class="v3-canvas-count tabular-nums">{one.stage.boards}</span>
										</Show>
									</span>
								</button>
								<Show when={!one.here && props.onOpen}>
									<button type="button" class="v3-canvas-open" title={`Open ${one.stage.title}`} aria-label={`Open ${one.stage.title}`} onClick={() => props.onOpen?.(one.stage.name)}>
										Open
										<Icon of={ArrowUpRight} size={12} />
									</button>
								</Show>
							</div>
							<div class="v3-folder-body" data-open={isOpen(one) ? "true" : "false"} aria-hidden={!isOpen(one)}>
								<div class="v3-canvas-boards">
									<Show when={isOpen(one)}>
										<For each={shown()}>{(board) => boardRow(board, one)}</For>
										<Show when={shown().length < one.boards.length}>
											<button type="button" class="v3-tree-more" onClick={() => setAll((was) => new Set(was).add(one.stage.name))}>
												{one.boards.length - shown().length} more boards
											</button>
										</Show>
										<Show when={one.boards.length === 0}>
											<p class="v3-tree-empty">No boards yet.</p>
										</Show>
									</Show>
								</div>
							</div>
						</div>
					);
				}}
			</For>
			</div>

			<Show when={tree().library.length > 0 || pens().length > 0}>
				{folder(libraryId, LIBRARY, String(tree().library.length + pens().length), () => (
					<>
						<For each={tree().library}>{(board) => boardRow(board, undefined)}</For>
						<For each={pens()}>
							{(pen) => (
								<div class="board-act">
									<button class="board-row" type="button" data-row data-pen={pen.path} title={`${pen.title}, ${pen.path}: place it on the canvas`} onClick={() => props.onPlacePen?.(pen)}>
										<span class="board-thumb" aria-hidden="true" />
										<span class="row-name">{basename(pen.path)}</span>
									</button>
								</div>
							)}
						</For>
					</>
				))}
			</Show>

			<Show when={tree().canvases.length === 0 && tree().library.length === 0 && pens().length === 0}>
				<p class="m-0 px-1 py-2 text-ui leading-normal text-faint">{searching() ? `No canvas or board matches “${props.query.trim()}”.` : "This deck has no canvases yet."}</p>
			</Show>
		</>
	);
}

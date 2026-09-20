import type { Board, Canvas, Identity } from "@decks/protocol";
import { createMemo, For, Show } from "solid-js";
import { BoardPicture } from "./BoardPicture.tsx";
import { relativeTime } from "./workspace-panel.ts";

/**
 * The dashboard's landing pane: one card per canvas.
 *
 * A card is the answer to "what moved while I was away", which is a question about a piece
 * of work rather than about a board — one card per canvas where the gallery has one per
 * board, and six hundred cards is not a thing anyone reads. The pictures on it are the
 * boards that changed most recently, which are already taken and cached for every board in
 * the deck, so a card costs four images that exist.
 *
 * Pressing a card opens the canvas. Nothing else on it is a control: the agents are said,
 * not offered, because who is working there is a fact about the canvas and not a menu.
 */

export interface CanvasShelfProps {
	canvases: Canvas[];
	boards: Board[];
	identities: Record<string, Identity>;
	/** Board paths that changed since the canvas was last opened, for the marked pictures. */
	onOpen: (canvas: Canvas) => void;
	onCreate: () => void;
	/** Boards on no canvas at all: still in the deck, and still changing. */
	onUnfiled: () => void;
}

/** How many pictures a card shows. Four is what fits without the card becoming a gallery. */
const COVER = 4;

export function CanvasShelf(props: CanvasShelfProps) {
	const byPath = createMemo(() => new Map(props.boards.map((board) => [board.path, board])));
	const filed = createMemo(() => new Set(props.canvases.flatMap((canvas) => canvas.boards)));
	const unfiled = createMemo(() => props.boards.filter((board) => !filed().has(board.path)));
	/** Newest first, because the question this pane answers is "what moved". */
	const ordered = createMemo(() => [...props.canvases].sort((a, b) => b.changedAt - a.changedAt));

	const cover = (canvas: Canvas) =>
		canvas.boards
			.map((path) => byPath().get(path))
			.filter((board): board is Board => board !== undefined)
			.sort((a, b) => b.rev - a.rev)
			.slice(0, COVER);

	return (
		<div class="canvas-shelf">
			<div class="canvas-shelf-head">
				<h2>Canvases</h2>
				<button type="button" class="canvas-new" onClick={() => props.onCreate()}>
					New canvas
				</button>
			</div>
			<div class="canvas-cards">
				<For each={ordered()}>
					{(canvas) => {
						const news = () => canvas.changedAt > (canvas.openedAt ?? 0);
						const working = () => canvas.agents.map((id) => props.identities[id]).filter((identity): identity is Identity => identity !== undefined);
						return (
							<button type="button" class="canvas-card" data-news={news() ? "true" : undefined} onClick={() => props.onOpen(canvas)}>
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
						);
					}}
				</For>
				<Show when={unfiled().length > 0}>
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
				</Show>
			</div>
			<Show when={ordered().length === 0}>
				<p class="canvas-none">No canvases yet. Make one, or ask an agent for a board and it will make the first.</p>
			</Show>
		</div>
	);
}

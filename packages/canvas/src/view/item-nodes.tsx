import type { Setter, JSX } from "solid-js";
import type { Page } from "@decks/protocol";
import { For, Show, type Accessor } from "solid-js";
import { canvasHost } from "../base/host.ts";
import MediaPlayer from "../items/MediaPlayer.tsx";
import { scheme } from "../base/theme.ts";
import type { CanvasEngine } from "../render/engine.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import { type LiveFile } from "./items-layer.tsx";

/** What `createItemNodes` reads of `createItemsLayer` (`items-layer.tsx`), each read when it is used. */
export interface ItemNodesNeeds {
	holesAsked: { ids: ReadonlySet<string>; mark: number; } | undefined;
	readonly penLayer: CanvasEngine;
	readonly setHolesShown: Setter<ReadonlySet<string>>;
	readonly props: CanvasViewProps;
	readonly isRendered: (key: string) => boolean;
	readonly pageNode: (card: Page) => JSX.Element;
	readonly liveFiles: Accessor<LiveFile[]>;
	readonly liveBox: (id: string) => { x: number; y: number; w: number; h: number; radius: number; } | undefined;
	readonly holesShown: Accessor<ReadonlySet<string>>;
	readonly playingBox: () => { radius: number; x: number; y: number; w: number; h: number; peaks?: number[]; seconds?: number; name: string; id: string; kind: "video" | "audio"; file: string } | undefined;
	readonly playedTo: Map<string, number>;
	playingElement: HTMLMediaElement | undefined;
	readonly setPlaying: Setter<{ id: string; kind: "video" | "audio"; file: string; } | undefined>;
}

export function createItemNodes(d: ItemNodesNeeds) {
	/** A frame on screen shows the holes asked for: their files' elements show from then (`liveFiles`). */
	const presented = () => {
		if (d.holesAsked && d.penLayer.tiles.shows(d.holesAsked.mark)) {
			d.setHolesShown(d.holesAsked.ids);
			d.holesAsked = undefined;
		}
	};

	/** Every card's slot, in the world. */
	const slots = () => (
		<>

				{/*
				 * A place for every board on the canvas, in file order, filled while it is within reach.
				 *
				 * A list of only the boards in reach was reconciled as boards came and went, and the
				 * reconciler kept the order by moving nodes: **moving an iframe reloads its page**, and
				 * zooming out from 60 to 40% reloaded six loaded boards of twenty-three. Even a list that
				 * only gains boards in the middle is diffed with moves. So each board has a slot of its own
				 * that never moves (`display: contents`, so it lays nothing out), filled while the board
				 * is within reach: only a slot's inside changes, and boards still stack in file order.
				 */}
				<For each={d.props.cards} fallback={null}>
					{(card) => (
						<div class="card-slot">
							<Show when={d.isRendered(card.path)}>{d.pageNode(card)}</Show>
						</div>
					)}
				</For>
		</>
	);

	/** The live files' elements, after the slots. */
	const fileNodes = () => (
		<>

				{/* Files shown live, under the sheet's holes for them (`liveFiles`): after the boards, so over them, as the drawing is. */}
				<For each={d.liveFiles()}>
					{(file) => {
						const box = () => d.liveBox(file.id);
						const shown = () => d.holesShown().has(file.id);
						return (
							<Show when={box()}>
								{(at) => (
									<div
										class="file-live"
										data-live-file={file.id}
										style={{ left: `${at().x}px`, top: `${at().y}px`, width: `${at().w}px`, height: `${at().h}px`, "border-radius": `${at().radius}px`, visibility: shown() ? "visible" : "hidden" }}
									>
										<img src={canvasHost().fileUrl(file.file)} alt={file.name} draggable={false} />
									</div>
								)}
							</Show>
						);
					}}
				</For>
		</>
	);

	/** The one player, over the item it belongs to (inside the overlay layer). */
	const player = () => (
		<>

					{/*
					 * The one player, laid over the item it belongs to.
					 *
					 * A real element because nothing else can play: the canvas draws in a worker and there
					 * is no browser in there. It is the same bargain a board makes — a picture until you
					 * are close and have asked — and it is one element, never a wall of them.
					 */}
					<Show when={d.playingBox()?.id} keyed>
						{(id) => {
							const now = () => d.playingBox()!;
							const first = now();
							return (
								<Show when={d.playingBox()}>
									<MediaPlayer
										kind={first.kind}
										src={canvasHost().fileUrl(first.file)}
										name={first.name}
										{...(first.seconds === undefined ? {} : { seconds: first.seconds })}
										{...(first.peaks ? { peaks: first.peaks } : {})}
										box={{ x: now().x, y: now().y, w: now().w, h: now().h }}
										radius={now().radius}
										scheme={scheme()}
										{...(d.playedTo.get(id) ? { from: d.playedTo.get(id)! } : {})}
										ref={(element) => (d.playingElement = element)}
										onEnded={() => {
											d.playedTo.delete(id);
											d.setPlaying(undefined);
										}}
										onLeave={(at) => {
											d.playingElement = undefined;
											if (at > 0.5) d.playedTo.set(id, at);
										}}
									/>
								</Show>
							);
						}}
					</Show>
		</>
	);

	return {
		presented,
		slots,
		fileNodes,
		player,
	};
}

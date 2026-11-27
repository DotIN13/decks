import { type DocEdits } from "../model/drawing.ts";
import type { Accessor, Setter } from "solid-js";
import { type PenDocument } from "@decks/pen";
import type { Page, Camera } from "@decks/protocol";
import { Show } from "solid-js";
import type { CanvasEngine } from "../render/engine.ts";
import { InkBar } from "../ui/InkBar.tsx";
import { PenBar } from "../ui/PenBar.tsx";
import { ItemSlot } from "../items/item-slot.tsx";
import { CanvasView } from "./CanvasView.tsx";
import { setDrawing } from "../ink/ink.ts";
import { setPenTool } from "../edit/pen-tools.ts";
import type { EditorOptions } from "./types.ts";

/** The empty picture: a card with no picture source is drawn as a blank sheet. */
const BLANK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'/%3E";

/** What `createEditorView` reads of `createEditor` (`editor.tsx`). */
export interface EditorViewNeeds {
	readonly mode: Accessor<"edit" | "browse">;
	readonly options: EditorOptions;
	readonly ownGlide: Accessor<{ token: number; ms: number; } | undefined>;
	readonly asked: Camera | undefined;
	readonly opening: Camera;
	readonly pages: Page[];
	readonly pen: Accessor<{ own?: true | undefined; edits?: DocEdits | undefined; doc: PenDocument; base: string; }>;
	readonly editing: {};
	readonly step: (direction: "undo" | "redo") => void;
	readonly inking: Accessor<boolean>;
	readonly setModeSignal: (mode: "edit" | "browse") => void;
	readonly camera: Accessor<Camera>;
	readonly setCamera: (next: Camera) => void;
	readonly selected: Accessor<string | undefined>;
	readonly setSelected: Setter<string | undefined>;
	readonly movePage: (path: string, x: number, y: number) => void;
	readonly reloads: Accessor<Record<string, number>>;
	/** Load a card again, in this window: the pill's ⋯, Reload. */
	readonly reload: (path: string) => void;
	readonly editable: boolean;
	engine: CanvasEngine | undefined;
	readonly doc: Accessor<PenDocument>;
	readonly edit: (ops: unknown[]) => boolean;
}

/** The editor's markup: the canvas view with everything it is handed, and the root around it. */
export function createEditorView(d: EditorViewNeeds) {
	const viewNode = () => (
		<CanvasView
			mode={d.mode()}
			{...(d.options.pages?.onExtent ? { onExtent: d.options.pages.onExtent } : {})}
			{...(d.options.pages?.onOpenLink ? { onOpenPage: d.options.pages.onOpenLink } : {})}
			news={d.options.pages?.news?.() ?? {}}
			{...(d.options.pages?.onRead ? { onRead: d.options.pages.onRead } : {})}
			{...(d.options.onViewport ? { onViewport: d.options.onViewport } : {})}
			{...(d.options.onRefer ? { onRefer: d.options.onRefer } : {})}
			glide={d.ownGlide()}
			opening={{ get camera() {
				return d.asked ?? d.opening;
			} }}
			{...(d.options.canvasName ? { canvasName: d.options.canvasName() } : {})}
			onTool={() => setPenTool("select")}
			cards={d.pages}
			pen={d.pen()}
			{...d.editing}
			{...(d.options.onExport ? { onExport: d.options.onExport } : {})}
			onReloadCard={d.reload}
			onPenStep={d.step}
			drawing={d.inking()}
			onPencil={() => {
				d.setModeSignal("browse");
				setDrawing(true);
			}}
			camera={d.camera()}
			setCamera={d.setCamera}
			selected={d.selected()}
			onSelect={(path) => {
			d.setSelected(path);
			d.options.onSelect?.(path);
			/* A press on bare canvas takes the focus, which is how an edit in a note or a card ends (as in the Decks app). */
			if (!path) document.querySelector<HTMLElement>(".decks-canvas .canvas, .canvas")?.focus();
			}}
			onMove={d.movePage}
			frame={(slot) => <ItemSlot {...slot} reload={d.reloads()[slot.card.path]} page={d.options.pages?.page?.(slot.card.path)} {...(d.options.pages?.cardScripts && !d.options.pages.cardScripts(slot.card.path) ? { cardScripts: false, ...(d.options.pages.onScriptsOn && d.editable && !slot.card.path.startsWith("shared/") ? { onScriptsOn: () => d.options.pages!.onScriptsOn!(slot.card.path) } : {}) } : {})} />}
			shots={() => ({ picture: (card, scheme) => d.options.pages?.picture?.(card.path, scheme) ?? BLANK })}
			{...(d.options.onComment ? { onComment: d.options.onComment } : {})}
			{...(d.options.onInk ? { onInk: d.options.onInk } : {})}
			inkAgent={d.options.inkAgent?.()}
			{...(d.options.world ? { world: d.options.world } : {})}
			{...(d.options.worldUnder ? { worldUnder: d.options.worldUnder } : {})}
			onEngine={(made) => (d.engine = made)}
		/>
	);

	const surface = () => viewNode();

	const root = () => (
		<div class="decks-canvas app" data-mode={d.mode()}>
			<div class="work">
				<div class="surface" data-surface="canvas">
					<div class="surface-layer" data-layer="canvas">
						{viewNode()}
					</div>
				</div>
			</div>
			<Show when={d.editable && !d.inking()}>
				<PenBar tools={d.options.toolbar !== false} doc={d.doc()} onEdit={d.edit} onStep={d.step} onArm={() => {}} onExport={(ids) => d.options.onExport?.(ids)} />
			</Show>
			<Show when={d.editable && d.inking()}>
				<InkBar onDone={() => setDrawing(false)} onStep={d.step} onDelete={(ids) => d.edit(ids.map((id) => ({ op: "delete", id })))} />
			</Show>
		</div>
	);

	return {
		surface,
		root,
	};
}

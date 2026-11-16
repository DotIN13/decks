import type { PenDocument } from "@decks/pen";
import type { LucideIcon } from "lucide-solid";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import Paperclip from "lucide-solid/icons/paperclip";
import FileText from "lucide-solid/icons/file-text";
import FrameIcon from "lucide-solid/icons/frame";
import GripHorizontal from "lucide-solid/icons/grip-horizontal";
import Redo2 from "lucide-solid/icons/redo-2";
import Shapes from "lucide-solid/icons/shapes";
import SmilePlus from "lucide-solid/icons/smile-plus";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import Undo2 from "lucide-solid/icons/undo-2";
import { For, onMount, Show } from "solid-js";
import { insertPanel, penTool, setInsertPanel, setPenTool, type PenTool } from "../editor/pen-tools.ts";
import { Icon } from "@decks/ui";
import { Properties } from "./Properties.tsx";

// The drawing's controls in edit mode: the column of tools on the canvas's left edge, with undo
// and redo, and the properties panel for what is selected.

/**
 * The drawing's controls, in edit mode: a column of tools and a properties panel.
 *
 * **The tools** are a column on the canvas's left edge, halfway down, with undo and redo under
 * them. They add to the canvas, shapes, icons, a frame, a note, a card, words, arrows, and are the
 * only tools there are: the ones that inserted components into a card are gone. They are always
 * there while editing, so they stand where no card's title bar is framed (`camera/insets.ts` on
 * what may float over the canvas and what may not). Shapes and icons are chosen first, in the
 * insert panel beside the column (`Insert.tsx`), which arms the tool for the next press.
 *
 * **What the selection is**, every property it has, its place, its order, a copy and a delete, is
 * the properties panel (`Properties.tsx`), in the card inspector's corner, only while something in
 * the drawing is selected. Every control sends a pen operation, the same one an agent would.
 */
export function PenBar(props: {
	/** Draw the column of tools. Default: true; a host with its own tools turns it off. */
	tools?: boolean;
	doc: PenDocument | undefined;
	onEdit: (ops: unknown[]) => void;
	onStep: (direction: "undo" | "redo") => void;
	onArm: (tool: PenTool) => void;
	/** Make the tools column a float: dragged by `grip`, put away behind either edge (the page's shell). */
	onFloat?: (tools: HTMLElement, grip: HTMLElement) => { unstow: () => void };
	/** Download a picture of these items, taken by the server (the server's shots). */
	onExport: (ids: string[]) => void;
	/** A file chosen in the file picker and put in the middle of the view, placed by what it is. */
	onOpenFile?: () => void;
}) {
	let toolsEl: HTMLDivElement | undefined;
	let gripEl: HTMLDivElement | undefined;
	let unstow = () => {};
	onMount(() => {
		if (toolsEl && gripEl && props.onFloat) unstow = props.onFloat(toolsEl, gripEl).unstow;
	});

	/** The insert panel's tab, when it is open beside the column (not for a point of its own). */
	const besideTab = () => {
		const open = insertPanel();
		return open && !open.at ? open.tab : undefined;
	};

	return (
		<>
			<Show when={props.tools !== false}>
			<div ref={toolsEl} class="pen-tools float" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
				{/* Where a drag starts; a double-click sends the column home. Not a button, so the float's `ignore` passes it. */}
				<div ref={gripEl} class="pen-grip" title="Drag to move; throw at either edge to put away; double-click to put back" aria-hidden="true">
					<Icon of={GripHorizontal} size={14} />
				</div>
				<For each={TOOLS}>
					{(entry) => (
						<>
							{/* A file of any kind, chosen in the file picker and placed by what it is (`app/files.ts`, `fileAt`). */}
							<Show when={entry.tool === "arrow" && props.onOpenFile}>
								<button type="button" class="icon-button" data-writes data-file-button title="A file: a document, a picture, a film, a sound, anything" aria-label="Add a file" onClick={() => props.onOpenFile?.()}>
									<Icon of={Paperclip} size={15} />
								</button>
							</Show>
							<Show when={entry.after}>
								<span class="pen-rule" aria-hidden="true" />
							</Show>
							<ToolButton entry={entry} besideTab={besideTab} onArm={props.onArm} />
						</>
					)}
				</For>
				<span class="pen-rule" aria-hidden="true" />
				<button type="button" class="icon-button" title="Undo your last change to the drawing (⌘Z)" aria-label="Undo" onClick={() => props.onStep("undo")}>
					<Icon of={Undo2} size={15} />
				</button>
				<button type="button" class="icon-button" title="Redo (⇧⌘Z)" aria-label="Redo" onClick={() => props.onStep("redo")}>
					<Icon of={Redo2} size={15} />
				</button>
				{/* Put away behind an edge, this is the part left showing, and the way back. */}
				<button type="button" class="stowtab" data-stowtab aria-label="Bring the drawing tools back" title="Bring the drawing tools back" onClick={() => unstow()}>
					<Icon of={ChevronLeft} size={14} />
				</button>
			</div>
			</Show>

			<Properties doc={props.doc} onEdit={props.onEdit} onExport={props.onExport} />
		</>
	);
}

/** One tool in the column: arms it, puts it down when pressed again, or opens the insert panel at its tab. */
function ToolButton(props: { entry: (typeof TOOLS)[number]; besideTab: () => "shapes" | "icons" | undefined; onArm: (tool: PenTool) => void }) {
	return (
		<button
			type="button"
			class="icon-button"
			classList={{ "pen-more": !!props.entry.panel }}
			data-tool={props.entry.tool}
			data-insert-button={props.entry.panel ? "" : undefined}
			data-on={penTool() === props.entry.tool || (props.entry.panel && props.besideTab() === props.entry.panel) ? "true" : undefined}
			aria-pressed={penTool() === props.entry.tool}
			aria-haspopup={props.entry.panel ? "dialog" : undefined}
			title={props.entry.key ? `${props.entry.label} (${props.entry.key})` : props.entry.label}
			aria-label={props.entry.label}
			onClick={() => {
				// Shapes and icons are picked in the insert panel first, which arms the tool (`Insert.tsx`).
				if (props.entry.panel) {
					setInsertPanel(props.besideTab() === props.entry.panel ? undefined : { tab: props.entry.panel });
					props.onArm(props.entry.tool);
					return;
				}
				// Pressing the armed tool again puts it down: selecting is what the canvas does with no tool in hand.
				const next = penTool() === props.entry.tool ? "select" : props.entry.tool;
				setInsertPanel(undefined);
				setPenTool(next);
				props.onArm(next);
			}}
		>
			<Icon of={props.entry.icon} size={15} />
		</button>
	);
}

export const TOOLS: Array<{ tool: PenTool; icon: LucideIcon; label: string; key?: string; after?: boolean; panel?: "shapes" | "icons" }> = [
	{ tool: "shape", icon: Shapes, label: "Shapes: basic, flowchart, arrows and callouts", panel: "shapes" },
	{ tool: "icon", icon: SmilePlus, label: "Icons: Lucide, Phosphor, Material and Feather", panel: "icons" },
	{ tool: "frame", icon: FrameIcon, label: "Frame: a box that holds what is drawn inside it", key: "F" },
	{ tool: "note", icon: StickyNote, label: "Note", key: "N", after: true },
	{ tool: "card", icon: FileText, label: "Card: write markdown, see headings, lists, bold and links", key: "C" },
	{ tool: "text", icon: Type, label: "Text", key: "T" },
	{ tool: "arrow", icon: ArrowUpRight, label: "Arrow: drag from one thing to another and it stays joined", key: "A" },
];

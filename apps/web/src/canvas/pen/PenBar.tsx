import type { PenDocument } from "@decks/pen";
import { isPhone } from "../../camera/camera.ts";
import type { LucideIcon } from "lucide-solid";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import FilePlus from "lucide-solid/icons/file-plus";
import Paperclip from "lucide-solid/icons/paperclip";
import FileText from "lucide-solid/icons/file-text";
import Presentation from "lucide-solid/icons/presentation";
import FrameIcon from "lucide-solid/icons/frame";
import GripHorizontal from "lucide-solid/icons/grip-horizontal";
import Redo2 from "lucide-solid/icons/redo-2";
import Shapes from "lucide-solid/icons/shapes";
import SmilePlus from "lucide-solid/icons/smile-plus";
import StickyNote from "lucide-solid/icons/sticky-note";
import Type from "lucide-solid/icons/type";
import Undo2 from "lucide-solid/icons/undo-2";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { insertPanel, penTool, setInsertPanel, setPenTool, type PenTool } from "../../state/pen-tools.ts";
import { Icon } from "../../ui/icons.tsx";
import { Properties } from "./Properties.tsx";

/**
 * The drawing's controls, in edit mode: a column of tools and a properties panel.
 *
 * **The tools** are a column on the canvas's left edge, halfway down, with undo and redo under
 * them. They add to the stage — shapes, icons, a frame, a note, a card, words, arrows — and are the
 * only tools there are: the ones that inserted components into a board are gone. They are always
 * there while editing, so they stand where no board's title bar is framed (`camera/insets.ts` on
 * what may float over the canvas and what may not). Shapes and icons are chosen first, in the
 * insert panel beside the column (`Insert.tsx`), which arms the tool for the next press.
 *
 * **What the selection is** — every property it has, its place, its order, a copy and a delete — is
 * the properties panel (`Properties.tsx`), in the board inspector's corner, only while something in
 * the drawing is selected. Every control sends a pen operation, the same one an agent would.
 */
export const TOOLS: Array<{ tool: PenTool; icon: LucideIcon; label: string; key?: string; after?: boolean; panel?: "shapes" | "icons" }> = [
	{ tool: "shape", icon: Shapes, label: "Shapes: basic, flowchart, arrows and callouts", panel: "shapes" },
	{ tool: "icon", icon: SmilePlus, label: "Icons: Lucide, Phosphor, Material and Feather", panel: "icons" },
	{ tool: "frame", icon: FrameIcon, label: "Frame: a box that holds what is drawn inside it", key: "F" },
	{ tool: "note", icon: StickyNote, label: "Note", key: "N", after: true },
	{ tool: "card", icon: FileText, label: "Card: write markdown, see headings, lists, bold and links", key: "C" },
	{ tool: "text", icon: Type, label: "Text", key: "T" },
	{ tool: "arrow", icon: ArrowUpRight, label: "Arrow: drag from one thing to another and it stays joined", key: "A" },
];

export function PenBar(props: {
	doc: PenDocument | undefined;
	onEdit: (ops: unknown[]) => void;
	onStep: (direction: "undo" | "redo") => void;
	onArm: (tool: PenTool) => void;
	/** Make the tools column a float: dragged by `grip`, put away behind either edge (`App.tsx`). */
	onFloat?: (tools: HTMLElement, grip: HTMLElement) => { unstow: () => void };
	/** Download a picture of these items, taken by the server (`server/stage/shots.ts`). */
	onExport: (ids: string[]) => void;
	/** A new board in the middle of the view, of the format chosen (`App.tsx`). */
	onNewBoard?: (format: "board" | "slides") => void;
	/** A file chosen in the file picker and put in the middle of the view, placed by what it is. */
	onOpenFile?: () => void;
}) {
	let toolsEl: HTMLDivElement | undefined;
	let gripEl: HTMLDivElement | undefined;
	let unstow = () => {};
	onMount(() => {
		if (toolsEl && gripEl && props.onFloat) unstow = props.onFloat(toolsEl, gripEl).unstow;
	});

	/*
	 * The board button's menu: beside the button, the same three rows as the canvas menu a
	 * double-click opens. Its own small menu rather than a `Popover`, so a pick closes it.
	 */
	let newButton: HTMLButtonElement | undefined;
	let newMenu: HTMLDivElement | undefined;
	const [making, setMaking] = createSignal<{ left: number; top: number } | undefined>();
	const toggleMaking = () => {
		if (making() || !newButton) return setMaking(undefined);
		const r = newButton.getBoundingClientRect();
		setMaking({ left: r.right + 10, top: r.top - 6 });
	};
	const make = (run: () => void) => {
		setMaking(undefined);
		run();
	};
	onMount(() => {
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (making() && !newMenu?.contains(target) && !newButton?.contains(target)) setMaking(undefined);
		};
		const key = (event: KeyboardEvent) => {
			if (making() && event.key === "Escape") setMaking(undefined);
		};
		document.addEventListener("pointerdown", away, true);
		document.addEventListener("keydown", key);
		onCleanup(() => {
			document.removeEventListener("pointerdown", away, true);
			document.removeEventListener("keydown", key);
		});
	});

	/** The insert panel's tab, when it is open beside the column (not for a pick from the canvas menu). */
	const besideTab = () => {
		const open = insertPanel();
		return open && !open.at ? open.tab : undefined;
	};

	return (
		<>
		{/* Not on a phone: its tools are a double-tap on bare canvas there (`Stage.tsx`, the canvas menu), and undo and redo are in `⋯`. */}
		<Show when={!isPhone()}>
		<div ref={toolsEl} class="pen-tools float" role="toolbar" aria-orientation="vertical" aria-label="Drawing tools">
			{/* Where a drag starts; a double-click sends the column home. Not a button, so the float's `ignore` passes it. */}
			<div ref={gripEl} class="pen-grip" title="Drag to move; throw at either edge to put away; double-click to put back" aria-hidden="true">
				<Icon of={GripHorizontal} size={14} />
			</div>
			<For each={TOOLS}>
				{(entry) => (
					<>
					{/* The board button, between the words and the arrow: one press opens Board and Slides. */}
					<Show when={entry.tool === "arrow" && props.onNewBoard}>
						<button
							ref={newButton}
							type="button"
							class="icon-button pen-more"
							data-writes
							data-new-board-button
							aria-haspopup="menu"
							aria-expanded={!!making()}
							data-on={making() ? "soft" : undefined}
							title="A new board or slide deck"
							aria-label="A new board or slide deck"
							onClick={toggleMaking}
						>
							<Icon of={FilePlus} size={15} />
						</button>
					</Show>
					{/* A file of any kind, chosen in the file picker and placed by what it is (`app/files.ts`, `fileAt`). */}
					<Show when={entry.tool === "arrow" && props.onOpenFile}>
						<button type="button" class="icon-button" data-writes data-file-button title="A file: a document, a picture, a film, a sound, anything" aria-label="Add a file" onClick={() => props.onOpenFile?.()}>
							<Icon of={Paperclip} size={15} />
						</button>
					</Show>
					<Show when={entry.after}>
						<span class="pen-rule" aria-hidden="true" />
					</Show>
					<button
						type="button"
						class="icon-button"
						classList={{ "pen-more": !!entry.panel }}
						data-tool={entry.tool}
						data-insert-button={entry.panel ? "" : undefined}
						data-on={penTool() === entry.tool || (entry.panel && besideTab() === entry.panel) ? "true" : undefined}
						aria-pressed={penTool() === entry.tool}
						aria-haspopup={entry.panel ? "dialog" : undefined}
						title={entry.key ? `${entry.label} (${entry.key})` : entry.label}
						aria-label={entry.label}
						onClick={() => {
							// Shapes and icons are picked in the insert panel first, which arms the tool (`Insert.tsx`).
							if (entry.panel) {
								setInsertPanel(besideTab() === entry.panel ? undefined : { tab: entry.panel });
								props.onArm(entry.tool);
								return;
							}
							// Pressing the armed tool again puts it down: selecting is what the canvas does with no tool in hand.
							const next = penTool() === entry.tool ? "select" : entry.tool;
							setInsertPanel(undefined);
							setPenTool(next);
							props.onArm(next);
						}}
					>
						<Icon of={entry.icon} size={15} />
					</button>
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

		<Show when={making()}>
			{(at) => (
				<Portal>
					<div ref={newMenu} class="popover" role="menu" aria-label="A new board" style={{ left: `${at().left}px`, top: `${at().top}px`, width: "220px" }}>
						<button type="button" role="menuitem" data-row data-flat="true" data-new-board="board" onClick={() => make(() => props.onNewBoard?.("board"))}>
							<span class="row-icon">
								<Icon of={FilePlus} size={15} />
							</span>
							<span class="row-label">Board</span>
							<span class="row-note">.html</span>
						</button>
						<button type="button" role="menuitem" data-row data-flat="true" data-new-board="slides" onClick={() => make(() => props.onNewBoard?.("slides"))}>
							<span class="row-icon">
								<Icon of={Presentation} size={15} />
							</span>
							<span class="row-label">Slides</span>
							<span class="row-note">.slides.html</span>
						</button>
					</div>
				</Portal>
			)}
		</Show>

		<Properties doc={props.doc} onEdit={props.onEdit} onExport={props.onExport} />
		</>
	);
}

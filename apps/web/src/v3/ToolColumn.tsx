import type { LucideIcon } from "lucide-solid";
import AppWindow from "lucide-solid/icons/app-window";
import ArrowUpRight from "lucide-solid/icons/arrow-up-right";
import Circle from "lucide-solid/icons/circle";
import CornerDownRight from "lucide-solid/icons/corner-down-right";
import Diamond from "lucide-solid/icons/diamond";
import FileText from "lucide-solid/icons/file-text";
import FrameIcon from "lucide-solid/icons/frame";
import Hand from "lucide-solid/icons/hand";
import Minus from "lucide-solid/icons/minus";
import MousePointer from "lucide-solid/icons/mouse-pointer-2";
import SquareDashedMousePointer from "lucide-solid/icons/square-dashed-mouse-pointer";
import Paperclip from "lucide-solid/icons/paperclip";
import PencilLine from "lucide-solid/icons/pencil-line";
import Redo2 from "lucide-solid/icons/redo-2";
import Shapes from "lucide-solid/icons/shapes";
import Smile from "lucide-solid/icons/smile";
import Spline from "lucide-solid/icons/spline";
import Square from "lucide-solid/icons/square";
import SquarePlus from "lucide-solid/icons/square-plus";
import Star from "lucide-solid/icons/star";
import StickyNote from "lucide-solid/icons/sticky-note";
import Triangle from "lucide-solid/icons/triangle";
import Type from "lucide-solid/icons/type";
import Undo2 from "lucide-solid/icons/undo-2";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import {
	drawing,
	handTool,
	penArrowStyle,
	penShape,
	penTool,
	setHandTool,
	setInsertPanel,
	setPenArrowStyle,
	setPenShape,
	setPenTool,
	type ArrowStyle,
	type PenTool,
} from "@decks/canvas/tools";
import { Icon } from "../ui/icons.tsx";

/**
 * The tool column of the v3 harness: select and hand, then what you can put on the canvas
 * (a board, a note, words, a shape, ink, an arrow, a file), then undo and redo.
 *
 * Three of the tools are families, and a press opens their menu beside the column: the board
 * (a document card or an app), the shape (five shapes and a line, with the full library and the
 * icons behind "More"), and the arrow (straight, elbow, curved). What was picked last is what the
 * button shows and what its key arms. The pen opens the pen tray (`PenTray.tsx`).
 *
 * The menus are this app's and dark, as the design draws them; the shape library and the icons
 * stay the canvas's own insert panel (`@decks/canvas`, `Insert.tsx`), which sits beside
 * `.pen-tools` wherever it is.
 */

type Family = "view" | "board" | "shape" | "arrow";
type Choice = { id: string; label: string; icon: LucideIcon; key?: string; rule?: boolean; pick: () => void };

const SHAPE_ICONS: Record<string, LucideIcon> = { Rectangle: Square, Ellipse: Circle, Triangle, Diamond, Star };

export function ToolColumn(props: {
	onStep: (direction: "undo" | "redo") => void;
	onOpenFile?: () => void;
	onApps: () => void;
	/** The column as a float: dragged by its grip (`App.tsx`, `mountToolsFloat`). */
	onFloat?: (tools: HTMLElement, grip: HTMLElement) => { unstow: () => void };
	/** On a phone the column is a row above the composer. */
	row?: boolean;
	/** The pen goes out or back: the app keeps the canvas in browse mode while it is out. */
	onPen: (on: boolean) => void;
	/** Select was pressed: the app's browse mode, where a press picks up and the pages are read. */
	onSelect?: () => void;
	/**
	 * The canvas's mode: `edit` outlines what is under the pointer, shows a flow board's block grips
	 * and Alt's distances; `browse` lights nothing up. The pointer's menu offers both, beside the hand.
	 */
	mode: "browse" | "edit";
	onMode: (mode: "browse" | "edit") => void;
}) {
	let column: HTMLDivElement | undefined;
	let grip: HTMLDivElement | undefined;
	let mark: HTMLSpanElement | undefined;
	let unstow = () => {};
	const [menu, setMenu] = createSignal<{ family: Family; top: number; left: number } | undefined>();
	/** The shape the shape button shows: a basic one by name, or the line. */
	const [lastShape, setLastShape] = createSignal<"rectangle" | "ellipse" | "Triangle" | "Diamond" | "Star" | "line" | "frame" | "more" | "icons">("rectangle");

	onMount(() => {
		if (column && grip && props.onFloat) unstow = props.onFloat(column, grip).unstow;
	});

	/** Put everything down, then take one thing up. */
	const arm = (tool: PenTool) => {
		setHandTool(false);
		if (drawing()) props.onPen(false);
		setInsertPanel(undefined);
		setPenTool(tool);
	};
	const select = (highlight = props.mode === "edit") => {
		setHandTool(false);
		if (drawing()) props.onPen(false);
		setInsertPanel(undefined);
		setPenTool("select");
		props.onMode(highlight ? "edit" : "browse");
	};
	/** The second slot's last choice, hand or highlighting select, which its press puts back. */
	const [lastView, setLastView] = createSignal<"highlight" | "hand">(props.mode === "edit" ? "highlight" : "hand");
	const hand = () => {
		if (drawing()) props.onPen(false);
		setInsertPanel(undefined);
		setPenTool("select");
		setHandTool(true);
	};
	/* Select stands alone; the slot under it is the hand or the select that highlights, whichever was last. */
	const view = (choice: "highlight" | "hand") => {
		setLastView(choice);
		if (choice === "hand") return hand();
		select(true);
	};
	const arrow = (style: ArrowStyle) => {
		setPenArrowStyle(style);
		arm("arrow");
	};
	const line = () => {
		setLastShape("line");
		arrow({ route: "straight", heads: "none" });
	};
	const pen = () => {
		setHandTool(false);
		setInsertPanel(undefined);
		setPenTool("select");
		props.onPen(!drawing());
	};

	const isLine = () => penTool() === "arrow" && penArrowStyle().heads === "none";
	const on = {
		select: () => !drawing() && !handTool() && penTool() === "select" && props.mode !== "edit",
		view: () => !drawing() && penTool() === "select" && (handTool() || props.mode === "edit"),
		board: () => penTool() === "card",
		note: () => penTool() === "note",
		text: () => penTool() === "text",
		shape: () => ["rectangle", "ellipse", "shape", "frame", "icon"].includes(penTool()) || isLine(),
		pen: () => drawing(),
		arrow: () => penTool() === "arrow" && !isLine(),
	};

	const shapeIcon = (): LucideIcon => {
		const last = lastShape();
		if (last === "rectangle") return Square;
		if (last === "ellipse") return Circle;
		if (last === "line") return Minus;
		if (last === "frame") return FrameIcon;
		if (last === "more" || last === "icons") return Shapes;
		return SHAPE_ICONS[last] ?? Square;
	};
	const arrowIcon = (): LucideIcon => (penArrowStyle().route === "elbow" && !isLine() ? CornerDownRight : penArrowStyle().route === "curved" && !isLine() ? Spline : ArrowUpRight);

	const viewIcon = (): LucideIcon => ((on.view() ? (handTool() ? "hand" : "highlight") : lastView()) === "hand" ? Hand : SquareDashedMousePointer);
	const choices = (family: Family): Choice[] => {
		if (family === "view")
			return [
				{ id: "hand", label: "Hand", icon: Hand, key: "H", pick: () => view("hand") },
				{ id: "highlight", label: "Select with highlights", icon: SquareDashedMousePointer, key: "E", pick: () => view("highlight") },
			];
		if (family === "board")
			return [
				{ id: "document", label: "Document", icon: FileText, key: "D", pick: () => arm("card") },
				{ id: "app", label: "App", icon: AppWindow, pick: () => props.onApps() },
			];
		if (family === "arrow")
			return [
				{ id: "straight", label: "Arrow", icon: ArrowUpRight, key: "A", pick: () => arrow({ route: "straight" }) },
				{ id: "elbow", label: "Elbow connector", icon: CornerDownRight, pick: () => arrow({ route: "elbow" }) },
				{ id: "curved", label: "Curved connector", icon: Spline, pick: () => arrow({ route: "curved" }) },
			];
		const named = (name: "Triangle" | "Diamond" | "Star"): Choice => ({
			id: name,
			label: name,
			icon: SHAPE_ICONS[name]!,
			pick: () => {
				setLastShape(name);
				setPenShape(name);
				arm("shape");
			},
		});
		return [
			{ id: "rectangle", label: "Rectangle", icon: Square, key: "R", pick: () => (setLastShape("rectangle"), arm("rectangle")) },
			{ id: "ellipse", label: "Ellipse", icon: Circle, key: "O", pick: () => (setLastShape("ellipse"), arm("ellipse")) },
			named("Triangle"),
			named("Diamond"),
			named("Star"),
			{ id: "line", label: "Line", icon: Minus, key: "L", rule: true, pick: line },
			{ id: "frame", label: "Frame", icon: FrameIcon, key: "F", rule: true, pick: () => (setLastShape("frame"), arm("frame")) },
			{
				id: "more",
				label: "More shapes…",
				icon: Shapes,
				pick: () => {
					setLastShape("more");
					arm("shape");
					setInsertPanel({ tab: "shapes" });
				},
			},
			{
				id: "icons",
				label: "Icons…",
				icon: Smile,
				pick: () => {
					setLastShape("icons");
					arm("icon");
					setInsertPanel({ tab: "icons" });
				},
			},
		];
	};
	/** Which row of a family's menu is the one in hand now. */
	const current = (family: Family): string | undefined => {
		const tool = penTool();
		if (family === "view") return !on.view() ? undefined : handTool() ? "hand" : "highlight";
		if (family === "board") return tool === "card" ? "document" : undefined;
		if (family === "arrow") return on.arrow() ? penArrowStyle().route : undefined;
		if (!on.shape()) return undefined;
		if (isLine()) return "line";
		if (tool === "rectangle" || tool === "ellipse" || tool === "frame") return tool;
		if (tool === "icon") return "icons";
		const shape = penShape();
		return shape === "Triangle" || shape === "Diamond" || shape === "Star" ? shape : "more";
	};

	/* A menu leaves as it came, quicker: it stays mounted for its 100 ms out. */
	const [leaving, setLeaving] = createSignal(false);
	let leaveTimer = 0;
	const closeMenu = () => {
		if (!menu() || leaving()) return;
		setLeaving(true);
		leaveTimer = window.setTimeout(() => {
			setMenu(undefined);
			setLeaving(false);
		}, 100);
	};
	onCleanup(() => clearTimeout(leaveTimer));
	/** A family's press puts its last choice in hand, then opens the menu of the others. */
	const armLast = (family: Family) => {
		if (family === "view") return view(lastView());
		if (family === "board") return arm("card");
		if (family === "arrow") return arrow(penArrowStyle().heads === "none" ? { route: "straight" } : penArrowStyle());
		const last = lastShape();
		if (last === "line") return line();
		if (last === "ellipse") return arm("ellipse");
		if (last === "frame") return arm("frame");
		if (last === "Triangle" || last === "Diamond" || last === "Star") {
			setPenShape(last);
			return arm("shape");
		}
		return arm("rectangle");
	};
	const openMenu = (family: Family, button: HTMLElement) => {
		if (menu()?.family === family) return closeMenu();
		clearTimeout(leaveTimer);
		setLeaving(false);
		if (!on[family]()) {
			armLast(family);
			/* The hand is pressed far more than it is changed: the slot's first press only takes it up. */
			if (family === "view") return;
		}
		const at = button.getBoundingClientRect();
		const box = column?.getBoundingClientRect() ?? at;
		if (props.row) setMenu({ family, left: Math.max(8, at.left - 8), top: box.top - 8 });
		else setMenu({ family, left: box.right + 8, top: at.top - 6 });
	};

	/*
	 * The letters, as the menus show them. The canvas already arms note, card, text, rectangle,
	 * ellipse, frame and arrow by their keys (`PEN_TOOL_KEYS`); these are the column's own: the hand,
	 * a document, the line and the pen. Not while typing, and not with a modifier.
	 */
	onMount(() => {
		const keys = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest?.("input, textarea, select, [contenteditable='true'], [contenteditable='']")) return;
			const key = event.key.toLowerCase();
			if (key === "h") view("hand");
			else if (key === "e") view("highlight");
			else if (key === "d") arm("card");
			else if (key === "l") line();
			else if (key === "p") pen();
			else if (key === "v") select(false);
			else if (key === "escape" && menu()) closeMenu();
			else return;
			event.preventDefault();
		};
		window.addEventListener("keydown", keys);
		onCleanup(() => window.removeEventListener("keydown", keys));
	});

	/*
	 * One marker for the tool in hand: it slides from tool to tool on a spring instead of each button
	 * lighting up on its own, and fades when nothing is in hand. Measured from the column's own corner,
	 * so the column's padding is counted once.
	 */
	createEffect(() => {
		penTool();
		drawing();
		handTool();
		penArrowStyle();
		lastShape();
		requestAnimationFrame(() => {
			const onEl = column?.querySelector<HTMLElement>('.v3-tool[data-on="true"]');
			if (!mark) return;
			if (!onEl) {
				mark.dataset.shown = "false";
				return;
			}
			const first = mark.dataset.shown === undefined;
			if (first) mark.style.transition = "none";
			mark.style.width = `${onEl.offsetWidth}px`;
			mark.style.height = `${onEl.offsetHeight}px`;
			mark.style.transform = `translate(${onEl.offsetLeft}px, ${onEl.offsetTop}px)`;
			mark.dataset.shown = "true";
			if (first) requestAnimationFrame(() => (mark!.style.transition = ""));
		});
	});

	const tool = (spec: { id: string; label: string; key?: string; icon: () => LucideIcon; on: () => boolean; onClick: (button: HTMLElement) => void; family?: Family }): JSX.Element => (
		<button
			type="button"
			class="v3-tool"
			data-tool={spec.id}
			data-tip={spec.label}
			data-key={spec.key}
			data-side={props.row ? "top" : "right"}
			data-on={spec.on() ? "true" : undefined}
			data-open={spec.family && menu()?.family === spec.family ? "true" : undefined}
			data-family={spec.family ? "" : undefined}
			aria-pressed={spec.on()}
			aria-haspopup={spec.family ? "menu" : undefined}
			aria-expanded={spec.family ? menu()?.family === spec.family : undefined}
			aria-label={spec.label}
			onClick={(event) => spec.onClick(event.currentTarget)}
		>
			<Icon of={spec.icon()} size={18} />
		</button>
	);

	return (
		<>
			<div ref={column} class="pen-tools float v3-tools" data-row={props.row ? "true" : undefined} role="toolbar" aria-orientation={props.row ? "horizontal" : "vertical"} aria-label="Tools">
				<span ref={mark} class="v3-tool-mark" aria-hidden="true" />
				<div ref={grip} class="v3-grip" title="Drag to move; throw at either edge to put away; double-click to put back" aria-hidden="true">
					<i />
					<i />
					<i />
					<i />
					<i />
					<i />
				</div>
				{tool({ id: "select", label: "Select", key: "V", icon: () => MousePointer, on: on.select, onClick: () => select(false) })}
				{tool({ id: "view", label: "Hand or highlight", icon: viewIcon, on: on.view, family: "view", onClick: (b) => openMenu("view", b) })}
				<span class="v3-rule" aria-hidden="true" />
				{tool({ id: "board", label: "Board", key: "D", icon: () => SquarePlus, on: on.board, family: "board", onClick: (b) => openMenu("board", b) })}
				{tool({ id: "note", label: "Note", key: "N", icon: () => StickyNote, on: on.note, onClick: () => (on.note() ? select() : arm("note")) })}
				{tool({ id: "text", label: "Text", key: "T", icon: () => Type, on: on.text, onClick: () => (on.text() ? select() : arm("text")) })}
				{tool({ id: "shape", label: "Shape", key: "R", icon: shapeIcon, on: on.shape, family: "shape", onClick: (b) => openMenu("shape", b) })}
				{tool({ id: "pen", label: "Pen", key: "P", icon: () => PencilLine, on: on.pen, onClick: pen })}
				{tool({ id: "arrow", label: "Arrow", key: "A", icon: arrowIcon, on: on.arrow, family: "arrow", onClick: (b) => openMenu("arrow", b) })}
				<Show when={props.onOpenFile}>
					{tool({ id: "file", label: "Add a file", icon: () => Paperclip, on: () => false, onClick: () => props.onOpenFile?.() })}
				</Show>
				<Show when={!props.row}>
					<span class="v3-rule" aria-hidden="true" />
					{tool({ id: "undo", label: "Undo", key: "⌘Z", icon: () => Undo2, on: () => false, onClick: () => props.onStep("undo") })}
					{tool({ id: "redo", label: "Redo", key: "⇧⌘Z", icon: () => Redo2, on: () => false, onClick: () => props.onStep("redo") })}
				</Show>
				<button type="button" class="stowtab" data-stowtab aria-label="Bring the tools back" title="Bring the tools back" onClick={() => unstow()}>
					<Icon of={ChevronLeft} size={14} />
				</button>
			</div>
			<Show when={menu()}>
				{(open) => (
					<ToolMenu
						at={open()}
						leaving={leaving()}
						above={!!props.row}
						choices={choices(open().family)}
						current={current(open().family)}
						onClose={closeMenu}
						anchor={column}
					/>
				)}
			</Show>
		</>
	);
}

/** A family's menu: dark, beside the column, closed by a pick, Escape or a press elsewhere. */
function ToolMenu(props: { at: { left: number; top: number }; above: boolean; leaving: boolean; choices: Choice[]; current?: string; onClose: () => void; anchor?: HTMLElement }) {
	let card: HTMLDivElement | undefined;
	const [place, setPlace] = createSignal(props.at);
	/* Mounted closed, opened on the next frame, so it grows out of the column rather than appearing. */
	const [shown, setShown] = createSignal(false);
	onMount(() => {
		// Kept on screen: a menu opened low on a short window rises to fit.
		const fit = () => {
			if (!card) return;
			const r = card.getBoundingClientRect();
			const top = props.above ? props.at.top - r.height : props.at.top;
			setPlace({ left: Math.min(props.at.left, window.innerWidth - r.width - 8), top: Math.max(8, Math.min(top, window.innerHeight - r.height - 8)) });
		};
		requestAnimationFrame(() => {
			fit();
			requestAnimationFrame(() => setShown(true));
		});
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (card?.contains(target) || (target instanceof Element && target.closest("[data-family]"))) return;
			props.onClose();
		};
		document.addEventListener("pointerdown", away, true);
		onCleanup(() => document.removeEventListener("pointerdown", away, true));
		card?.querySelector<HTMLElement>("[data-on='true']")?.focus({ preventScroll: true });
	});
	return (
		<Portal>
			<div ref={card} class="v3-menu" role="menu" data-open={shown() && !props.leaving ? "true" : "false"} data-above={props.above ? "true" : undefined} style={{ left: `${place().left}px`, top: `${place().top}px` }}>
				<For each={props.choices}>
					{(choice) => (
						<>
							<Show when={choice.rule}>
								<span class="v3-menu-rule" aria-hidden="true" />
							</Show>
							<button
								type="button"
								role="menuitemradio"
								aria-checked={props.current === choice.id}
								data-on={props.current === choice.id ? "true" : undefined}
								class="v3-menu-row"
								onClick={() => {
									choice.pick();
									props.onClose();
								}}
								onKeyDown={(event) => {
									const rows = [...(card?.querySelectorAll<HTMLElement>(".v3-menu-row") ?? [])];
									const here = rows.indexOf(event.currentTarget);
									if (event.key === "ArrowDown") rows[(here + 1) % rows.length]?.focus();
									else if (event.key === "ArrowUp") rows[(here - 1 + rows.length) % rows.length]?.focus();
									else if (event.key === "Escape") props.onClose();
									else return;
									event.preventDefault();
								}}
							>
								<Icon of={choice.icon} size={15} />
								<span class="v3-menu-label">{choice.label}</span>
								<Show when={choice.key}>{(key) => <span class="v3-menu-key">{key()}</span>}</Show>
							</button>
						</>
					)}
				</For>
			</div>
		</Portal>
	);
}

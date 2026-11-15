import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { onDismiss } from "./dismiss.ts";
import { portalLayer } from "./portal.ts";

/**
 * One popover, for all five of them.
 *
 * In `ui/` because that is what the directory is: the primitives every layer draws with,
 * this and `Icon`.
 *
 * The mode menu, the model picker, the context dial's numbers, the agent selector and the
 * time machine are the same object: a thing you press, a card that appears near it, and one
 * agreed way to make it go away. Three native `<select>`s were replaced here, and replacing
 * them with three hand-rolled menus would have traded one inconsistency for a worse one —
 * so this is the primitive, and the five callers only supply content.
 *
 * What it owns, because every one of them would otherwise get it slightly wrong:
 *
 * - **Placement**, and clamping. `top-end` means "above the trigger, right edges aligned",
 *   and if that puts the card past the window it slides back in. A menu that opens off
 *   screen is a menu that does not open.
 * - **Dismissal, one rule for all of them.** Escape, or a pointerdown anywhere outside.
 *   Not "press the trigger again", which is a thing you have to remember you did.
 * - **The keyboard.** Down/Up rove over the rows, Home/End jump, Enter or Space picks,
 *   Tab picks the focused row and closes — the completion behaviour, which is what makes
 *   the model list usable without a mouse.
 * - **Focus returns to the trigger** when it closes, so the tab order does not restart at
 *   the top of the document every time you change a model.
 */
export type Placement = "top-start" | "top" | "top-end" | "bottom-start" | "bottom" | "bottom-end" | "right-start";

/** How far off the trigger the card sits. */
const GUTTER = 6;
/** Never closer than this to a window edge. */
const MARGIN = 8;

export type PopoverProps = {
	/** The button. Given `open` so it can draw itself pressed. */
	trigger: (api: { open: boolean; toggle: () => void; ref: (el: HTMLElement) => void }) => JSX.Element;
	children: JSX.Element;
	placement?: Placement;
	/** Rows are found by this selector for the keyboard to rove over. */
	rowSelector?: string;
	/** Notified when it opens or closes, for a caller that draws something else while open. */
	onOpenChange?: (open: boolean) => void;
	/** A class on the card, for width and padding. */
	class?: string;
	/** Named for screen readers, since the trigger is usually an icon. */
	label?: string;
};

export function Popover(props: PopoverProps) {
	// A submenu opens beside its row (`right-start`), and the menu it came from treats it as its own.
	const sub = () => props.placement === "right-start";
	const [open, setOpen] = createSignal(false);
	const [at, setAt] = createSignal<{ left: number; top: number } | undefined>();
	/** Which side of its trigger the card landed on, so a stylesheet can grow it out of that edge. */
	const [side, setSide] = createSignal<"above" | "below" | "beside">("below");
	/** The most the card may be tall where it is placed, when it is taller than the room there. */
	const [ceiling, setCeiling] = createSignal<number>();
	let trigger: HTMLElement | undefined;
	let card: HTMLDivElement | undefined;

	const rows = () => (card ? [...card.querySelectorAll<HTMLElement>(props.rowSelector ?? "[data-row]")] : []);

	/** `refocus`: hand the keyboard back to the trigger; not when put away by a press in another document. */
	const change = (next: boolean, refocus = true) => {
		setOpen(next);
		props.onOpenChange?.(next);
		if (!next && refocus) trigger?.focus();
	};

	/** Measured after mount: only the browser knows the card's size, which decides whether a side fits. */
	const place = () => {
		if (!trigger || !card) return;
		const placed = measure(trigger, card, props.placement ?? "top-start");
		setCeiling(placed.ceiling);
		setSide(placed.side);
		setAt({ left: placed.left, top: placed.top });
	};

	createEffect(() => {
		if (!open()) {
			setAt(undefined);
			return;
		}
		whileOpen({ card: () => card, trigger: () => trigger, rows, sub, place, close: (refocus) => change(false, refocus) });
	});

	return (
		<>
			{props.trigger({
				get open() {
					return open();
				},
				toggle: () => change(!open()),
				ref: (el) => (trigger = el),
			})}
			<Show when={open()}>
				{/*
				 * Into the body: the card is `position: fixed` from viewport boxes, and a transformed
				 * ancestor (the dock's `translateX(-50%)`) would place it in its own space instead.
				 */}
				<Portal mount={portalLayer()}>
				<div
					ref={card}
					class={`popover ${props.class ?? ""}`}
					data-sub={sub() ? "" : undefined}
					data-placed={at() ? "" : undefined}
					data-side={side()}
					role="menu"
					aria-label={props.label}
					/* Hidden until placed, so it never flashes at 0,0 on the way to its corner. */
					style={{
						left: `${at()?.left ?? 0}px`,
						top: `${at()?.top ?? 0}px`,
						visibility: at() ? "visible" : "hidden",
						"max-width": `calc(100vw - ${MARGIN * 2}px)`,
						...(ceiling() !== undefined ? { "max-height": `${ceiling()}px` } : {}),
					}}
				>
					{props.children}
				</div>
				</Portal>
			</Show>
		</>
	);
}

type Rect = Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;

/**
 * Beside the menu it came from, level with the row that opened it; on the left when the right has no
 * room. With room on neither side (a phone), above that menu or below it, so its row stays seen.
 */
export function placeBeside(menu: Rect, t: Rect, c: { width: number; height: number }): { left: number; top: number } {
	const fitsRight = menu.right + GUTTER + c.width <= window.innerWidth - MARGIN;
	const fitsLeft = menu.left - GUTTER - c.width >= MARGIN;
	let left: number;
	let top: number;
	if (fitsRight || fitsLeft) {
		left = fitsRight ? menu.right + GUTTER : menu.left - c.width - GUTTER;
		top = t.top - 5;
	} else {
		left = menu.left;
		top = menu.top - GUTTER - c.height >= MARGIN ? menu.top - GUTTER - c.height : menu.bottom + GUTTER;
	}
	left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - c.width - MARGIN));
	top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - c.height - MARGIN));
	return { left, top };
}

/**
 * Above or below its bar: lined up by `-start`, `-end` or the middle, on the side asked for when the
 * whole card fits there, else the side with more room, the card cut to it (`ceiling`) and scrolling.
 * A menu always ends GUTTER from its bar, so every menu off the same bar starts at the same height.
 */
export function placeAlong(placement: Placement, at: { t: Rect; bar: Rect; along: Rect; gapFrom: Rect }, c: { width: number; height: number }): { left: number; top: number; ceiling: number | undefined; side: "above" | "below" } {
	const { t, along, gapFrom: bar } = at;
	const above = placement.startsWith("top");
	let left: number;
	if (placement.endsWith("-end")) left = at.bar.right - c.width;
	else if (placement.endsWith("-start")) left = along.left;
	else left = t.left + t.width / 2 - c.width / 2;
	const width = Math.min(c.width, window.innerWidth - MARGIN * 2);
	left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - width - MARGIN));
	const roomAbove = bar.top - GUTTER - MARGIN;
	const roomBelow = window.innerHeight - bar.bottom - GUTTER - MARGIN;
	let up = above;
	if (above && c.height > roomAbove && roomBelow > roomAbove) up = false;
	if (!above && c.height > roomBelow && roomAbove > roomBelow) up = true;
	const room = Math.max(0, up ? roomAbove : roomBelow);
	const height = Math.min(c.height, room);
	let top = up ? bar.top - GUTTER - height : bar.bottom + GUTTER;
	top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - height - MARGIN));
	return { left, top, ceiling: c.height > room ? room : undefined, side: top + height <= t.top + 1 ? "above" : "below" };
}

/**
 * Whether a click picked a row, which closes the menu. Not a row that is no choice: `data-keep-open`
 * (the zoom steppers), `aria-haspopup="menu"` (it opens a menu of its own), or `aria-expanded` (a
 * disclosure within this menu). A menu left open under a modal swallowed the Escape that closes it.
 */
function isChoice(event: MouseEvent): boolean {
	const row = (event.target as HTMLElement | null)?.closest?.("[data-row]");
	if (!row || row.hasAttribute("data-keep-open") || row.hasAttribute("aria-expanded")) return false;
	return row.getAttribute("aria-haspopup") !== "menu";
}

/** Whether a press landed outside the card and its trigger; a press in its own submenu is inside. */
function pressedAway(event: PointerEvent, card: HTMLElement | undefined, trigger: HTMLElement | undefined, sub: boolean): boolean {
	const target = event.target as Node | null;
	if (card?.contains(target ?? null) || trigger?.contains(target ?? null)) return false;
	return sub || !(target as Element | null)?.closest?.(".popover[data-sub]");
}

/** Escape closes (an open submenu takes it first); arrows, Home and End rove; Tab picks the focused row. */
function menuKeys(event: KeyboardEvent, list: HTMLElement[], sub: boolean, close: () => void): void {
	if (event.key === "Escape") {
		if (!sub && document.querySelector(".popover[data-sub]")) return;
		event.preventDefault();
		close();
		return;
	}
	if (list.length === 0) return;
	const here = list.indexOf(document.activeElement as HTMLElement);
	const go = (index: number) => {
		event.preventDefault();
		list[Math.min(Math.max(0, index), list.length - 1)]?.focus();
	};
	if (event.key === "ArrowDown") go(here + 1);
	else if (event.key === "ArrowUp") go(here <= 0 ? 0 : here - 1);
	else if (event.key === "Home") go(0);
	else if (event.key === "End") go(list.length - 1);
	else if (event.key === "Tab" && here >= 0) {
		event.preventDefault();
		list[here]?.click();
	}
}

/**
 * Where the card goes, from what it hangs off: in a toolbar pill the gap is measured from the pill
 * and an `-end` card lines up with its edge; a `[data-popover-anchor]` round the trigger is what a
 * `-start` card lines up with. The card's own size, not its box mid-grow, and its full height.
 */
function measure(trigger: HTMLElement, card: HTMLElement, placement: Placement): { left: number; top: number; ceiling: number | undefined; side: "above" | "below" | "beside" } {
	const pill = trigger.closest(".pill");
	const group = trigger.closest("[data-popover-anchor]");
	const t = trigger.getBoundingClientRect();
	const bar = (pill ?? trigger).getBoundingClientRect();
	const along = (group ?? trigger).getBoundingClientRect();
	const c = { width: card.offsetWidth, height: Math.max(card.offsetHeight, card.scrollHeight + 2) };
	if (placement === "right-start") return { ...placeBeside((trigger.closest(".popover") ?? trigger).getBoundingClientRect(), t, c), ceiling: undefined, side: "beside" };
	return placeAlong(placement, { t, bar: pill ? bar : t, along, gapFrom: bar }, c);
}

/** What runs while a popover is open: placing it as it settles and resizes, and the ways it closes. */
function whileOpen(o: { card: () => HTMLElement | undefined; trigger: () => HTMLElement | undefined; rows: () => HTMLElement[]; sub: () => boolean; place: () => void; close: (refocus?: boolean) => void }): void {
	const { card, trigger, rows, sub, place, close } = o;
	// Two frames: one for the card to exist, one for fonts to have settled its height.
	/*
	 * And again whenever the card changes size: a row that fills in after it opens (the board
	 * pictures' progress in the ⋯ menu) widened the card past the edge it was lined up with.
	 */
	let sized: ResizeObserver | undefined;
	let closed = false;
	requestAnimationFrame(() => {
		place();
		requestAnimationFrame(place);
		const el = card();
		if (closed || !el || typeof ResizeObserver !== "function") return;
		sized = new ResizeObserver(() => place());
		sized.observe(el);
	});
	onCleanup(() => {
		closed = true;
		sized?.disconnect();
	});
	// Picking a row closes the menu: `click`, so it lands after the row's own handler and Enter counts too.
	const picked = (event: MouseEvent) => {
		if (isChoice(event)) close();
	};
	const away = (event: PointerEvent) => {
		if (pressedAway(event, card(), trigger(), sub())) close();
	};
	const keys = (event: KeyboardEvent) => menuKeys(event, rows(), sub(), () => close());
	document.addEventListener("pointerdown", away);
	// A press or Escape in the other document of the canvas frame (`dismiss.ts`).
	const stopDismiss = onDismiss(() => close(false));
	document.addEventListener("keydown", keys);
	document.addEventListener("click", picked);
	window.addEventListener("resize", place);
	onCleanup(() => {
		document.removeEventListener("pointerdown", away);
		stopDismiss();
		document.removeEventListener("keydown", keys);
		document.removeEventListener("click", picked);
		window.removeEventListener("resize", place);
	});
}

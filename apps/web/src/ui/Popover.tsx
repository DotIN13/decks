import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

/**
 * One popover, for all five of them.
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
export type Placement = "top-start" | "top" | "top-end" | "bottom-start" | "bottom" | "bottom-end";

/** How far off the trigger the card sits. */
const GUTTER = 6;
/** Never closer than this to a window edge. */
const MARGIN = 8;

export function Popover(props: {
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
}) {
	const [open, setOpen] = createSignal(false);
	const [at, setAt] = createSignal<{ left: number; top: number } | undefined>();
	let trigger: HTMLElement | undefined;
	let card: HTMLDivElement | undefined;

	const rows = () => (card ? [...card.querySelectorAll<HTMLElement>(props.rowSelector ?? "[data-row]")] : []);

	const change = (next: boolean) => {
		setOpen(next);
		props.onOpenChange?.(next);
		if (!next) trigger?.focus();
	};

	/*
	 * Measured after mount rather than positioned in CSS.
	 *
	 * The card's own size is what decides whether `top-end` fits, and only the browser
	 * knows it — a `bottom: 100%` rule would place it correctly and then let it hang off
	 * the left edge of a narrow window with no way to notice.
	 */
	const place = () => {
		if (!trigger || !card) return;
		const t = trigger.getBoundingClientRect();
		const c = card.getBoundingClientRect();
		const placement = props.placement ?? "top-start";
		const above = placement.startsWith("top");

		let left: number;
		if (placement.endsWith("-end")) left = t.right - c.width;
		else if (placement.endsWith("-start")) left = t.left;
		else left = t.left + t.width / 2 - c.width / 2;

		let top = above ? t.top - c.height - GUTTER : t.bottom + GUTTER;

		left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - c.width - MARGIN));
		// If it does not fit on the side asked for, take the other one before giving up.
		if (above && top < MARGIN) top = t.bottom + GUTTER;
		else if (!above && top + c.height > window.innerHeight - MARGIN) top = t.top - c.height - GUTTER;
		top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - c.height - MARGIN));

		setAt({ left, top });
	};

	createEffect(() => {
		if (!open()) {
			setAt(undefined);
			return;
		}
		// Two frames: one for the card to exist, one for fonts to have settled its height.
		requestAnimationFrame(() => {
			place();
			requestAnimationFrame(place);
		});
		/*
		 * Picking a row closes the menu.
		 *
		 * It used to be the caller's job, and only `AgentPill` did it — so the corner's
		 * overflow stayed open behind whatever its rows had opened. That is worse than
		 * untidy: this component owns Escape while it is open and calls `preventDefault`, so
		 * a menu left open under the Settings modal *swallowed the key that closes the
		 * modal*. The keyboard had no way out of a dialog, and the cause was two surfaces
		 * up.
		 *
		 * `click` rather than `pointerdown`, so it lands after the row's own handler and a
		 * keyboard's Enter counts too.
		 *
		 * Three rows do not close it, and each exclusion is a row that is not a choice:
		 *
		 * - `data-keep-open` — the zoom steppers, since pressing "Zoom in" three times is the
		 *   point of having them in a menu;
		 * - `aria-haspopup="menu"` — a row that opens a menu of its own, or picking inside a
		 *   submenu would take its parent with it;
		 * - **`aria-expanded`** — a disclosure *within* this menu, like the runtime chevron
		 *   beside "New agent", which reveals two more rows in place. Missing this one closed
		 *   the agent menu on the press that was meant to open its second half, and took
		 *   `newAgent` in the e2e suite with it: "New pi agent" had become unreachable.
		 */
		const picked = (event: MouseEvent) => {
			const row = (event.target as HTMLElement | null)?.closest?.("[data-row]");
			if (!row || row.hasAttribute("data-keep-open") || row.hasAttribute("aria-expanded")) return;
			if (row.getAttribute("aria-haspopup") === "menu") return;
			change(false);
		};

		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (card?.contains(target ?? null) || trigger?.contains(target ?? null)) return;
			change(false);
		};
		const keys = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				change(false);
				return;
			}
			const list = rows();
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
		};
		document.addEventListener("pointerdown", away);
		document.addEventListener("keydown", keys);
		document.addEventListener("click", picked);
		window.addEventListener("resize", place);
		onCleanup(() => {
			document.removeEventListener("pointerdown", away);
			document.removeEventListener("keydown", keys);
			document.removeEventListener("click", picked);
			window.removeEventListener("resize", place);
		});
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
				 * Into the body, and this is not tidiness — it is the difference between the
				 * card appearing under its trigger and appearing 478px away.
				 *
				 * The card is `position: fixed` and placed from `getBoundingClientRect`, which
				 * is viewport-relative. But a fixed element inside a **transformed** ancestor is
				 * positioned against that ancestor instead of the viewport, and the dock carries
				 * `translateX(-50%)` to centre itself — so the model picker was laid out in the
				 * dock's coordinate space and landed up and to the right of everything.
				 *
				 * A portal is the fix rather than compensating for the transform, because the
				 * next surface to grow one would break this again silently. Dismissal already
				 * listens on the document and asks `card.contains`, so nothing here depends on
				 * where the node sits.
				 */}
				<Portal>
				<div
					ref={card}
					class={`popover ${props.class ?? ""}`}
					role="menu"
					aria-label={props.label}
					/* Hidden until placed, so it never flashes at 0,0 on the way to its corner. */
					style={{
						left: `${at()?.left ?? 0}px`,
						top: `${at()?.top ?? 0}px`,
						visibility: at() ? "visible" : "hidden",
					}}
				>
					{props.children}
				</div>
				</Portal>
			</Show>
		</>
	);
}

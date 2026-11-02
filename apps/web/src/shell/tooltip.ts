/**
 * The v3 chrome's tooltips: a dark tip with the control's name and its key.
 *
 * The first one waits 450 ms, so a pointer passing over the chrome shows nothing. Once one is up the
 * next follows the pointer at once, sliding along the bar, until the pointer has been off every
 * control for 400 ms. A press hides it, and it never shows over an open menu.
 *
 * Any element with `data-tip` takes part; `data-key` adds the key, `data-tip-sub` a quieter second line
 * (a pill's: where it came from), and `data-side` ("right", "top", "bottom", the default) says where the
 * tip stands. The native `title` is left to everything else.
 */
const WAIT = 450;
const WARM = 400;

export function installTooltips(): () => void {
	const tip = document.createElement("div");
	tip.className = "v3-tip";
	tip.setAttribute("role", "tooltip");
	document.body.appendChild(tip);
	let timer = 0;
	let shownAt = 0;
	let current: HTMLElement | null = null;

	const show = (el: HTMLElement) => {
		if (document.querySelector(".popover, .pill-card, .v3-menu[data-open='true']")) return;
		const text = el.dataset.tip;
		if (!text) return;
		tip.replaceChildren(text);
		tip.toggleAttribute("data-wrap", !!el.dataset.tipSub);
		if (el.dataset.tipSub) {
			const sub = document.createElement("span");
			sub.className = "v3-tip-sub";
			sub.textContent = el.dataset.tipSub;
			tip.appendChild(sub);
		}
		if (el.dataset.key) {
			const key = document.createElement("span");
			key.className = "v3-tip-key";
			key.textContent = el.dataset.key;
			tip.appendChild(key);
		}
		const r = el.getBoundingClientRect();
		const side = el.dataset.side ?? "bottom";
		const w = tip.offsetWidth;
		const h = tip.offsetHeight;
		let left = side === "right" ? r.right + 10 : r.left + r.width / 2 - w / 2;
		let top = side === "right" ? r.top + r.height / 2 - h / 2 : side === "top" ? r.top - h - 8 : r.bottom + 8;
		left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
		top = Math.max(6, Math.min(top, window.innerHeight - h - 6));
		tip.dataset.warm = String(Date.now() - shownAt < WARM && tip.dataset.shown === "true");
		tip.dataset.side = side;
		tip.style.left = `${left}px`;
		tip.style.top = `${top}px`;
		tip.dataset.shown = "true";
		shownAt = Date.now();
		current = el;
	};
	const hide = (cold = false) => {
		clearTimeout(timer);
		if (tip.dataset.shown === "true") shownAt = Date.now();
		tip.dataset.shown = "false";
		current = null;
		if (cold) shownAt = 0;
	};
	const over = (event: PointerEvent) => {
		if (event.pointerType === "touch") return;
		const el = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
		if (!el || el === current) return;
		clearTimeout(timer);
		if (Date.now() - shownAt < WARM) show(el);
		else timer = window.setTimeout(() => show(el), WAIT);
	};
	const out = (event: PointerEvent) => {
		const el = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");
		if (el && !el.contains(event.relatedTarget as Node | null)) hide();
	};
	const press = () => hide(true);
	document.addEventListener("pointerover", over);
	document.addEventListener("pointerout", out);
	document.addEventListener("pointerdown", press, true);
	document.addEventListener("keydown", press, true);
	return () => {
		document.removeEventListener("pointerover", over);
		document.removeEventListener("pointerout", out);
		document.removeEventListener("pointerdown", press, true);
		document.removeEventListener("keydown", press, true);
		tip.remove();
	};
}

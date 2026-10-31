/**
 * `decks-canvas.js`: what an app's page needs on the canvas, put in every page the canvas frame
 * serves (`route.ts`), beside the browser storage stand-in (`storage-script.ts`) and apart from it.
 *
 * Today it is one thing: a wheel inside the app, as inside a card on the canvas. What something under
 * the pointer can still scroll is scrolled here, natively; the rest, and every pinch, is handed up to
 * the canvas (`decks-wheel`), which pans or zooms with it (`items/item-surfaces.tsx`). Only inside the
 * canvas frame: a page opened in a tab of its own keeps every wheel. A page that has the tag keeps it.
 */
export const GUEST_SCRIPT = "decks-canvas.js";

/** The page with the guest script's tag put first in its head, unless it has one. */
export function withGuest(html: string, src: string): string {
	if (html.includes(GUEST_SCRIPT)) return html;
	const tag = `<script src="${src}"></script>`;
	const head = /<head\b[^>]*>/i.exec(html);
	if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html;
}

export function guestScript(name: string): string {
	return `/* Decks: the app ${name} on the canvas (decks-canvas.js): a wheel it cannot use goes to the canvas. */
(() => {
	if (window.parent === window) return;
	const canTake = (el, dx, dy) => {
		const style = getComputedStyle(el);
		const y = dy !== 0 && /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 && ((dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (dy < 0 && el.scrollTop > 0));
		const x = dx !== 0 && /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1 && ((dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) || (dx < 0 && el.scrollLeft > 0));
		return x || y;
	};
	const scrollsInside = (target, dx, dy) => {
		for (let el = target instanceof Element ? target : null; el && el !== document.documentElement; el = el.parentElement) if (canTake(el, dx, dy)) return true;
		const page = document.scrollingElement || document.documentElement;
		const y = dy !== 0 && page.scrollHeight > page.clientHeight + 1 && ((dy > 0 && page.scrollTop + page.clientHeight < page.scrollHeight - 1) || (dy < 0 && page.scrollTop > 0));
		const x = dx !== 0 && page.scrollWidth > page.clientWidth + 1 && ((dx > 0 && page.scrollLeft + page.clientWidth < page.scrollWidth - 1) || (dx < 0 && page.scrollLeft > 0));
		return x || y;
	};
	window.addEventListener(
		"wheel",
		(event) => {
			const zooming = event.ctrlKey || event.metaKey;
			if (!zooming && scrollsInside(event.target, event.deltaX, event.deltaY)) return;
			event.preventDefault();
			parent.postMessage({ type: "decks-wheel", dx: event.deltaX, dy: event.deltaY, mode: event.deltaMode, x: event.clientX, y: event.clientY, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }, "*");
		},
		{ passive: false },
	);
})();
`;
}

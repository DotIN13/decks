/**
 * `decks-storage.js`: the browser storage an app asks for with one line at the top of its page,
 * `<script src="decks-storage.js"></script>`, before its own scripts.
 *
 * Inside the canvas frame an app is a sandboxed iframe with no origin of its own, where the browser's
 * `localStorage` throws. This script stands one in: the frame put the app's saved values after `#` in its
 * address (`@decks/canvas`, `apps.inCanvas`), read here before the app's own code runs, so a read answers
 * at once; each write goes up to the frame, which has the page keep it under the app's name. In a tab of
 * its own the app has the browser's storage, and the script keeps it under the same keys the page does
 * (`decks.app:<name>:`), so the tab and the canvas read the same values in the Decks app.
 *
 * For what is only about this browser (the last tab open, a panel's width). What must follow the person to
 * every device is the app's own server's to keep, as JSON or SQLite in its folder.
 */
export const STORAGE_SCRIPT = "decks-storage.js";

/**
 * A page of an app opened in the canvas frame, with the stand-in loaded first: an app that never added
 * the script tag (most, written before it) read `localStorage` at its first line and stopped there, so
 * the frame adds it to every page it serves there. A page that has the tag keeps its own.
 */
export function withStorage(html: string, src: string): string {
	if (html.includes(STORAGE_SCRIPT)) return html;
	const tag = `<script src="${src}"></script>`;
	const head = /<head\b[^>]*>/i.exec(html);
	if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html;
}

export function storageScript(name: string): string {
	return `/* Decks: browser storage for the app ${name} (decks-storage.js). */
(() => {
	const PREFIX = ${JSON.stringify(`decks.app:${name}:`)};
	let real = null;
	try {
		real = window.localStorage;
		real.getItem(PREFIX);
	} catch {
		real = null;
	}
	const values = new Map();
	let write;
	if (real) {
		for (let i = 0; i < real.length; i++) {
			const key = real.key(i);
			if (key && key.startsWith(PREFIX)) values.set(key.slice(PREFIX.length), real.getItem(key) ?? "");
		}
		write = (key, value) => (value === null ? real.removeItem(PREFIX + key) : real.setItem(PREFIX + key, value));
	} else {
		const hash = location.hash.slice(1);
		const params = new URLSearchParams(hash);
		const carried = params.get("decks-storage");
		if (carried) {
			try {
				const text = new TextDecoder().decode(Uint8Array.from(atob(carried.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
				for (const [key, value] of Object.entries(JSON.parse(text))) values.set(key, String(value));
			} catch {}
			params.delete("decks-storage");
			const rest = params.toString();
			try {
				history.replaceState(history.state, "", location.pathname + location.search + (rest ? "#" + rest : ""));
			} catch {}
		}
		write = (key, value) => parent.postMessage({ type: "decks-storage", key, value }, "*");
	}
	const api = {
		get length() { return values.size; },
		key: (i) => [...values.keys()][i] ?? null,
		getItem: (key) => (values.has(String(key)) ? values.get(String(key)) : null),
		setItem: (key, value) => { key = String(key); value = String(value); values.set(key, value); write(key, value); },
		removeItem: (key) => { key = String(key); if (values.delete(key)) write(key, null); },
		clear: () => { for (const key of [...values.keys()]) { values.delete(key); write(key, null); } },
	};
	// Read and written as properties too, as many apps do (\`localStorage.theme = "dark"\`).
	const storage = new Proxy(api, {
		get: (target, prop) => (typeof prop === "symbol" || prop in target ? Reflect.get(target, prop) : target.getItem(prop)),
		set: (target, prop, value) => (typeof prop === "symbol" || prop in target ? false : (target.setItem(prop, value), true)),
		deleteProperty: (target, prop) => (typeof prop === "symbol" ? false : (target.removeItem(prop), true)),
		has: (target, prop) => (typeof prop === "symbol" || prop in target ? prop in target : values.has(prop)),
		ownKeys: () => [...values.keys()],
		getOwnPropertyDescriptor: (target, prop) => (typeof prop === "string" && values.has(prop) ? { value: values.get(prop), writable: true, enumerable: true, configurable: true } : undefined),
	});
	Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
})();
/*
 * Decks: a wheel inside the app, as inside a card on the canvas. What something here can still scroll
 * is scrolled here, natively; the rest, and every pinch, is the canvas's, which pans or zooms with it
 * (item-surfaces.tsx, "decks-wheel"). Only inside the canvas frame: a tab of its own keeps every wheel.
 */
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

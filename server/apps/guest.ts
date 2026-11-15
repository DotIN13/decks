// decks-canvas.js (rule 13): what an app's page needs inside the canvas frame. A sandboxed frame
// has no localStorage, so one stands in: values come in after # as decks-storage and go up as
// decks-storage messages. A wheel the page cannot use goes up as decks-wheel, so the canvas pans.

export const GUEST = "decks-canvas.js";
const OLD_NAME = "decks-storage.js";

/** Whether a path inside an app asks for the guest script, by its name or its old one. */
export const asksGuest = (inner: string): boolean => inner.endsWith(`/${GUEST}`) || inner.endsWith(`/${OLD_NAME}`);

/** The page with the script's tag first in its head, unless it has one already. */
export function withGuest(html: string, src: string): string {
	if (html.includes(GUEST) || html.includes(OLD_NAME)) return html;
	const tag = `<script src="${src}"></script>`;
	const head = /<head\b[^>]*>/i.exec(html);
	if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	return doctype ? doctype[0] + tag + html.slice(doctype[0].length) : tag + html;
}

/** The script's address from a page at this path inside the app: always the app's root. */
export const guestSrc = (inner: string): string => `${"../".repeat(Math.max(0, inner.split("/").length - 2))}${GUEST}`;

const STORAGE = `(() => {
	const PREFIX = "decks.app:" + NAME + ":";
	let real = null;
	try { real = window.localStorage; real.getItem(PREFIX); } catch { real = null; }
	const values = new Map();
	let write;
	if (real) {
		for (let i = 0; i < real.length; i++) { const key = real.key(i); if (key && key.startsWith(PREFIX)) values.set(key.slice(PREFIX.length), real.getItem(key) ?? ""); }
		write = (key, value) => (value === null ? real.removeItem(PREFIX + key) : real.setItem(PREFIX + key, value));
	} else {
		const params = new URLSearchParams(location.hash.slice(1));
		const carried = params.get("decks-storage");
		if (carried) {
			try {
				const text = new TextDecoder().decode(Uint8Array.from(atob(carried.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
				for (const [key, value] of Object.entries(JSON.parse(text))) values.set(key, String(value));
			} catch {}
			params.delete("decks-storage");
			const rest = params.toString();
			try { history.replaceState(history.state, "", location.pathname + location.search + (rest ? "#" + rest : "")); } catch {}
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
	const storage = new Proxy(api, {
		get: (t, p) => (typeof p === "symbol" || p in t ? Reflect.get(t, p) : t.getItem(p)),
		set: (t, p, v) => (typeof p === "symbol" || p in t ? false : (t.setItem(p, v), true)),
		deleteProperty: (t, p) => (typeof p === "symbol" ? false : (t.removeItem(p), true)),
		has: (t, p) => (typeof p === "symbol" || p in t ? p in t : values.has(p)),
		ownKeys: () => [...values.keys()],
		getOwnPropertyDescriptor: (t, p) => (typeof p === "string" && values.has(p) ? { value: values.get(p), writable: true, enumerable: true, configurable: true } : undefined),
	});
	Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
})();`;

const WHEEL = `(() => {
	if (window.parent === window) return;
	const room = (el, dx, dy) => {
		const s = getComputedStyle(el);
		const y = dy !== 0 && /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1 && ((dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (dy < 0 && el.scrollTop > 0));
		const x = dx !== 0 && /(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1 && ((dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) || (dx < 0 && el.scrollLeft > 0));
		return x || y;
	};
	const inside = (target, dx, dy) => {
		for (let el = target instanceof Element ? target : null; el && el !== document.documentElement; el = el.parentElement) if (room(el, dx, dy)) return true;
		const page = document.scrollingElement || document.documentElement;
		const y = dy !== 0 && page.scrollHeight > page.clientHeight + 1 && ((dy > 0 && page.scrollTop + page.clientHeight < page.scrollHeight - 1) || (dy < 0 && page.scrollTop > 0));
		const x = dx !== 0 && page.scrollWidth > page.clientWidth + 1 && ((dx > 0 && page.scrollLeft + page.clientWidth < page.scrollWidth - 1) || (dx < 0 && page.scrollLeft > 0));
		return x || y;
	};
	window.addEventListener("wheel", (e) => {
		if (!(e.ctrlKey || e.metaKey) && inside(e.target, e.deltaX, e.deltaY)) return;
		e.preventDefault();
		parent.postMessage({ type: "decks-wheel", dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, x: e.clientX, y: e.clientY, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey }, "*");
	}, { passive: false });
})();`;

/** The script for one app. */
export const guestScript = (name: string): string => `/* Decks: ${name} on the canvas. */\n(() => {\nconst NAME = ${JSON.stringify(name)};\n${STORAGE}\n${WHEEL}\n})();\n`;

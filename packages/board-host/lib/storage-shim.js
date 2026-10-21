/*
 * localStorage for a board whose page has a blank origin, kept by the page around it.
 *
 * A board on a canvas a friend shared runs sandboxed (`@decks/canvas/board-storage.ts`), without
 * `allow-same-origin`, so the browser gives its page no storage of its own: `localStorage` throws. A
 * board that keeps a score, a checklist or a setting still needs somewhere to keep it, so this file
 * puts a `localStorage` in its place that is the same to the board's own scripts — `getItem`,
 * `setItem`, `removeItem`, `clear`, `key`, `length`, and `localStorage.name` as a property — and keeps
 * what is written in the page around the board, in that page's own browser storage, per canvas and
 * board: the Decks app's or Studio's.
 *
 * How it starts, which is what lets a board read its storage synchronously as it starts:
 * - the harness puts this file first in the head of every board page of a shared canvas
 *   (`server/src/http.ts`), before any script of the board's own;
 * - the page around puts what the board had stored in the frame's address, after the `#`
 *   (`#decks-storage=<base64url of the JSON>`), so it is here before anything asks. The fragment is
 *   taken off the address at once, so the board's own scripts never see it;
 * - a page that reloads itself has no fragment any more: it asks the page around
 *   (`{ decks: "storage.hello" }`) and is answered with what is stored (`storage.snapshot`), which
 *   arrives a moment later; reads before that find nothing, reads after it find all of it;
 * - every change goes up to the page around as it is made (`storage.set`, `storage.remove`,
 *   `storage.clear`), and only to `window.parent`. Only `window.parent` is listened to.
 *
 * A board opened alone in a tab, or in the harness's own browser for its picture, has no page around
 * it: its storage lasts as long as the page. `sessionStorage` is always that: the page's own, kept
 * nowhere. A board keeps at most a megabyte; past that, `setItem` throws `QuotaExceededError` as a
 * browser's own storage does.
 */
(() => {
	"use strict";
	if (window.origin !== "null" || window.__decksStorage) return;

	const MAX_CHARS = 1_000_000;
	const PARAM = "decks-storage=";

	/** What the page around put in the address, taken off it before anything else reads the address. */
	function fromAddress() {
		const hash = location.hash;
		const at = hash.indexOf(PARAM);
		if (at < 0) return undefined;
		const value = hash.slice(at + PARAM.length).split("&")[0];
		const rest = hash.slice(0, at).replace(/[#&]$/, "");
		try {
			history.replaceState(history.state, "", `${location.pathname}${location.search}${rest && rest !== "#" ? rest : ""}`);
		} catch {
			/* an address that cannot be rewritten keeps its fragment; the board reads past it */
		}
		try {
			const bytes = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
			const parsed = JSON.parse(new TextDecoder().decode(bytes));
			return parsed && typeof parsed === "object" ? parsed : undefined;
		} catch {
			return undefined;
		}
	}

	const framed = window.parent !== window;
	const tell = (message) => {
		if (!framed) return;
		try {
			window.parent.postMessage({ decks: message.decks, ...message }, "*");
		} catch {
			/* a page around that has gone away keeps nothing */
		}
	};

	/** A Storage that answers like the browser's: methods, `length`, and its keys as properties. */
	function makeStorage(items, kept) {
		const size = () => {
			let n = 0;
			for (const [k, v] of items) n += k.length + v.length;
			return n;
		};
		const api = {
			getItem: (key) => {
				const value = items.get(String(key));
				return value === undefined ? null : value;
			},
			setItem: (key, value) => {
				const k = String(key);
				const v = String(value);
				const was = items.get(k);
				if (size() - (was === undefined ? 0 : k.length + was.length) + k.length + v.length > MAX_CHARS) {
					throw new DOMException(`A board keeps at most ${MAX_CHARS} characters.`, "QuotaExceededError");
				}
				items.set(k, v);
				if (kept) tell({ decks: "storage.set", key: k, value: v });
			},
			removeItem: (key) => {
				const k = String(key);
				if (!items.delete(k)) return;
				if (kept) tell({ decks: "storage.remove", key: k });
			},
			clear: () => {
				items.clear();
				if (kept) tell({ decks: "storage.clear" });
			},
			key: (index) => {
				const keys = [...items.keys()];
				return keys[Number(index)] ?? null;
			},
		};
		const names = new Set([...Object.keys(api), "length"]);
		return new Proxy(api, {
			get: (target, prop) => {
				if (prop === "length") return items.size;
				if (typeof prop === "symbol" || names.has(prop)) return Reflect.get(target, prop);
				const value = items.get(prop);
				return value === undefined ? undefined : value;
			},
			set: (_target, prop, value) => {
				if (typeof prop === "symbol" || names.has(prop)) return false;
				api.setItem(prop, value);
				return true;
			},
			deleteProperty: (_target, prop) => {
				if (typeof prop !== "symbol") api.removeItem(prop);
				return true;
			},
			has: (target, prop) => (typeof prop === "string" && items.has(prop)) || Reflect.has(target, prop),
			ownKeys: () => [...items.keys()],
			getOwnPropertyDescriptor: (_target, prop) => (typeof prop === "string" && items.has(prop) ? { value: items.get(prop), writable: true, enumerable: true, configurable: true } : undefined),
		});
	}

	const given = fromAddress();
	const items = new Map();
	for (const [k, v] of Object.entries(given ?? {})) if (typeof v === "string") items.set(k, v);
	const local = makeStorage(items, true);
	const session = makeStorage(new Map(), false);

	for (const [name, store] of [
		["localStorage", local],
		["sessionStorage", session],
	]) {
		try {
			Object.defineProperty(window, name, { configurable: true, enumerable: true, get: () => store });
		} catch {
			/* a browser that will not have it replaced: the board's storage throws, as it would anyway */
		}
	}
	window.__decksStorage = true;

	/*
	 * A page that reloaded itself came with no snapshot: the page around is asked for it, and its
	 * answer taken once. One with a snapshot needs none, and takes none.
	 */
	if (framed && given === undefined) {
		let answered = false;
		window.addEventListener("message", (event) => {
			if (answered || event.source !== window.parent) return;
			const message = event.data;
			if (!message || typeof message !== "object" || message.decks !== "storage.snapshot" || !message.items || typeof message.items !== "object") return;
			answered = true;
			for (const [k, v] of Object.entries(message.items)) if (typeof v === "string" && !items.has(k)) items.set(k, v);
		});
		tell({ decks: "storage.hello" });
	}
})();

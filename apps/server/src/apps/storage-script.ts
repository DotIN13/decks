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
`;
}

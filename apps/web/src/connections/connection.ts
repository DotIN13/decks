import { createSignal } from "solid-js";

/**
 * Which backend this tab is talking to, and every one it knows.
 *
 * One front end, several backends: the server the page came from, other Decks servers it has been
 * paired with, and canvases opened from a `.decks` file, which a service worker in this tab serves
 * (`public/sw.js`). They all speak the same frames, so the rest of the app never asks which kind it
 * has; it asks the greeting what the backend can do (`BackendInfo`).
 *
 * **The tab's address names the connection**: `?c=<id>`, or nothing for the server the page came
 * from. So two tabs can be on two backends and a reload stays where it was. Switching changes the
 * address without loading the page and mounts the app again (`switch.ts`): every binding in it
 * starts from nothing, and the stores outside it are emptied first.
 *
 * Every URL the app builds for the backend goes through `api()`. For this server it is the path as
 * it always was; for any other it is under `/c/<id>/`, which is what the service worker answers.
 * A board's own relative references stay under that prefix, so they route too.
 */
/**
 * `label` is what the backend calls itself: a server's deck name, a file's canvas title. `name` is
 * what you call it, set when connecting or later from the switcher, and it wins when there is one.
 */
export type Connection =
	| { id: "here"; kind: "here"; label: string; name?: string }
	| { id: string; kind: "server"; label: string; name?: string; base: string; token: string; added: number }
	| { id: string; kind: "bundle"; label: string; name?: string; from: string; added: number; boards: number };

const LIST = "decks.connections";
const LAST = "decks.connection.last";

/** Built without a server: the public Decks, which has no "here" to fall back on. */
export const PUBLIC = import.meta.env?.VITE_DECKS_PUBLIC === "1";

const HERE_NAME = "decks.connection.here.name";

/** What you call the server this page came from, if anything: kept apart, since it is not in the list. */
const [hereName, setHereName] = createSignal<string | undefined>(typeof localStorage === "undefined" ? undefined : (localStorage.getItem(HERE_NAME) ?? undefined));

function here(): Connection {
	const name = hereName();
	return { id: "here", kind: "here", label: "This server", ...(name ? { name } : {}) };
}

function readList(): Connection[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(LIST) ?? "[]") as Connection[];
		return Array.isArray(parsed) ? parsed.filter((one) => one && typeof one.id === "string" && one.id !== "here") : [];
	} catch {
		return [];
	}
}

const [others, setOthers] = createSignal<Connection[]>(typeof localStorage === "undefined" ? [] : readList());

/** Every connection this browser knows, this server first. */
export function connections(): Connection[] {
	return PUBLIC ? others() : [here(), ...others()];
}

/** Write the list, and tell the service worker, which routes by it. */
export function saveConnections(list: Connection[]): void {
	const kept = list.filter((one) => one.id !== "here");
	localStorage.setItem(LIST, JSON.stringify(kept));
	setOthers(kept);
	void import("./worker.ts").then(({ tellWorker }) => tellWorker());
}

/**
 * Name a connection, or with nothing clear the name and go back to what the backend calls itself.
 * Names are this browser's own: another browser, or the server, never sees them.
 */
export function rename(id: string, name: string): void {
	const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
	if (id === "here") {
		if (clean) localStorage.setItem(HERE_NAME, clean);
		else localStorage.removeItem(HERE_NAME);
		setHereName(clean || undefined);
		return;
	}
	saveConnections(
		connections().map((one) => {
			if (one.id !== id) return one;
			const { name: _old, ...rest } = one;
			return (clean ? { ...rest, name: clean } : rest) as Connection;
		}),
	);
}

/** What to call a connection: your name for it, or what it calls itself (`fallback` for this server, whose own name arrives with its greeting). */
export function nameOf(one: Connection, fallback?: string): string {
	return one.name ?? (one.kind === "here" ? (fallback ?? one.label) : one.label);
}

/** The id in this tab's address, or none. */
function idInAddress(): string | undefined {
	if (typeof location === "undefined") return undefined;
	return new URLSearchParams(location.search).get("c") ?? undefined;
}

/**
 * The address's id, held as a signal: a switch changes it without loading the page again
 * (`switch.ts`), and everything built from `api()` follows.
 */
const [addressed, setAddressed] = createSignal(idInAddress());

/** Read the address again: the back button moved it. */
export function readAddress(): void {
	setAddressed(idInAddress());
}

/**
 * The connection this tab is on.
 *
 * The address decides. With none, it is this server, or on the public Decks the last one used;
 * undefined there means nothing is open yet, and the app shows its way in instead of a canvas.
 */
export function active(): Connection | undefined {
	const id = addressed();
	const list = connections();
	if (id) return list.find((one) => one.id === id);
	if (!PUBLIC) return here();
	const last = typeof localStorage === "undefined" ? undefined : localStorage.getItem(LAST);
	return list.find((one) => one.id === last);
}

/** Whether the tab is on anything other than the server it came from. */
export function elsewhere(): boolean {
	const one = active();
	return !!one && one.kind !== "here";
}

/** Where the backend's `/api/...` is, from this page: the path itself, or under the connection's prefix. */
export function apiBase(): string {
	const one = active();
	return !one || one.kind === "here" ? "/api" : `/c/${one.id}/api`;
}

/** A backend URL: `api("/board/x.html")`. A path the server handed over (`/api/f/...`) is accepted too. */
export function api(path: string): string {
	const rest = path.startsWith("/api/") ? path.slice(4) : path.startsWith("/") ? path : `/${path}`;
	return `${apiBase()}${rest}`;
}

/** An absolute `/api/...` URL from the server, moved under this tab's prefix; anything else as it is. */
export function rebase(url: string): string {
	return url.startsWith("/api/") && elsewhere() ? api(url) : url;
}

/**
 * A key in this browser's storage, for this connection.
 *
 * Cameras, drafts and the last canvas are kept per backend, so coming back to one finds it where it
 * was left. This server keeps the keys it always had, so nothing already stored is lost.
 */
export function storageKey(key: string): string {
	const one = active();
	return !one || one.kind === "here" ? key : `${key}@${one.id}`;
}

/**
 * Put the tab on another connection: the address says so, without loading the page, and the app
 * is mounted again on it (`switch.ts`). The page, its code and its fonts stay; the canvas, the
 * conversations and everything the last backend said are fetched from the new one.
 */
export function switchTo(id: string): void {
	if (PUBLIC) localStorage.setItem(LAST, id);
	const url = new URL(location.href);
	if (id === "here") url.searchParams.delete("c");
	else url.searchParams.set("c", id);
	url.hash = "";
	void import("./switch.ts").then(({ noteShown, remount }) =>
		remount(() => {
			history.pushState(null, "", url.toString());
			setAddressed(id === "here" ? undefined : id);
			noteShown();
		}),
	);
}

/** A short random id for a new connection: also the cache's and the prefix's name, so URL-safe. */
export function newId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

/** The socket for a server connection: its own host, with the token in the query, since a socket cannot carry headers. */
export function socketUrl(): string {
	const one = active();
	if (one?.kind === "server") {
		const base = new URL(one.base);
		base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
		base.pathname = `${base.pathname.replace(/\/+$/, "")}/ws`;
		base.searchParams.set("decks_token", one.token);
		return base.toString();
	}
	return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

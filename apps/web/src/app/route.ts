/**
 * Where the person is, written in the hash.
 *
 * The hash is the source of truth. The app does not keep a separate "current surface"
 * signal and then try to mirror it into the URL; it reads the hash, and every move is a
 * write to the hash followed by a read. That is why Back works: the browser owns the
 * history, and we only ever describe places to it.
 *
 * Two surfaces. `#/canvases`, `#/tasks` and `#/cron` are the dispatch surface on one of its
 * tabs, optionally with a board picked out (`#/canvases?board=<path>`). `#/boards` was the
 * gallery tab, which is gone; it still parses, and lands on the canvases with its board. `#/canvas/<id>` is a
 * canvas, optionally with the agent you are talking to on it (`?agent=<id>`). Anything else
 * parses to nothing and the app lands on the last dispatch tab it remembers, so a stale
 * bookmark is never a blank screen.
 *
 * **There is no agent address.** An agent is on every canvas it has worked on, so no single
 * room could answer to its name; who you are typing to is a setting on the canvas you are
 * looking at, which is why it is a query value and not a path. `#/agent/<id>`, which used to
 * be one, now parses to nothing and lands on the shelf.
 */

export type DispatchTab = "canvases" | "tasks" | "cron";

export type Place =
	| { surface: "dispatch"; tab: DispatchTab; board?: string }
	/**
	 * A canvas, and who you are talking to on it.
	 *
	 * The canvas is the place: it is what holds the boards and what two agents can share.
	 * `agent` is who the composer addresses there, absent while the room has nobody in it.
	 */
	| { surface: "stage"; canvas: string; agent?: string };

/** Where the last dispatch tab is remembered, so an empty hash lands somewhere familiar. */
export const TAB_KEY = "decks.dispatch.tab";

const TABS: readonly DispatchTab[] = ["canvases", "tasks", "cron"];
const AGENT_ID = /^[A-Za-z0-9_-]+$/;

function isTab(value: string | null | undefined): value is DispatchTab {
	return (TABS as readonly string[]).includes(value ?? "");
}

/**
 * A query value, decoded by hand. `URLSearchParams` would turn a `+` in a board path into a
 * space, and `encodeURIComponent` never writes a `+`, so the two would not round-trip.
 */
function fromQuery(query: string, key: string): string | undefined {
	const head = `${key}=`;
	for (const pair of query.split("&")) {
		if (!pair.startsWith(head)) continue;
		try {
			const value = decodeURIComponent(pair.slice(head.length));
			return value === "" ? undefined : value;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/** `""`, `"#"`, `"#/"` and anything unknown are `undefined`; the caller decides where to land. */
export function parsePlace(hash: string): Place | undefined {
	let rest = hash.startsWith("#") ? hash.slice(1) : hash;
	if (!rest.startsWith("/")) return undefined;
	const q = rest.indexOf("?");
	const query = q >= 0 ? rest.slice(q + 1) : "";
	rest = q >= 0 ? rest.slice(0, q) : rest;
	// One trailing slash is tolerated; a hand-typed `#/boards/` should not miss.
	if (rest.length > 1 && rest.endsWith("/")) rest = rest.slice(0, -1);
	const parts = rest.slice(1).split("/");
	// The old gallery's address, kept so a bookmark or a remembered tab is never a blank screen.
	const tab = parts[0] === "boards" ? "canvases" : parts[0];
	if (parts.length === 1 && isTab(tab)) {
		const board = fromQuery(query, "board");
		return board === undefined ? { surface: "dispatch", tab } : { surface: "dispatch", tab, board };
	}
	if (parts.length === 2 && parts[0] === "canvas" && parts[1] !== undefined && AGENT_ID.test(parts[1])) {
		const agent = fromQuery(query, "agent");
		return agent !== undefined && AGENT_ID.test(agent) ? { surface: "stage", canvas: parts[1], agent } : { surface: "stage", canvas: parts[1] };
	}
	return undefined;
}

/** The inverse of `parsePlace`, always with the leading `#`. */
export function formatPlace(place: Place): string {
	if (place.surface === "stage") {
		return place.agent ? `#/canvas/${place.canvas}?agent=${place.agent}` : `#/canvas/${place.canvas}`;
	}
	const board = place.board === undefined || place.board === "" ? "" : `?board=${encodeURIComponent(place.board)}`;
	return `#/${place.tab}${board}`;
}

export function samePlace(a: Place | undefined, b: Place | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (a.surface === "stage" || b.surface === "stage") {
		return a.surface === "stage" && b.surface === "stage" && (a.agent ?? "") === (b.agent ?? "") && a.canvas === b.canvas;
	}
	return a.tab === b.tab && (a.board ?? undefined) === (b.board ?? undefined);
}

function storedTab(storage: Pick<Storage, "getItem"> | undefined): DispatchTab | undefined {
	try {
		const value = (storage ?? globalThis.localStorage)?.getItem(TAB_KEY);
		return isTab(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/** The place the hash names, else dispatch on the remembered tab, else the shelf of canvases. */
export function landing(hash: string, storage?: Pick<Storage, "getItem">): Place {
	return parsePlace(hash) ?? { surface: "dispatch", tab: storedTab(storage) ?? "canvases" };
}

/**
 * The part of `Window` the route needs. Narrower than `Window` so a test can hand in a
 * plain object; a real `window` fits it as-is.
 */
export interface RouteWindow {
	location: { hash: string };
	history: {
		pushState: (data: unknown, unused: string, url?: string | null) => void;
		replaceState: (data: unknown, unused: string, url?: string | null) => void;
	};
	addEventListener: (type: "popstate", listener: () => void) => void;
	removeEventListener: (type: "popstate", listener: () => void) => void;
}

export interface RouteOptions {
	onPlace: (place: Place) => void;
	storage?: Storage;
	win?: RouteWindow;
}

/**
 * Wire the hash to `onPlace`. Reads the landing place once on install, follows Back and
 * Forward through `popstate`, and gives back `go` for the app's own moves.
 *
 * If the hash was empty on install, the landing hash is written with `replaceState` so the
 * first history entry is already inside the app; otherwise the first Back would leave it.
 */
export function installRoute(options: RouteOptions): {
	go: (place: Place, options?: { replace?: boolean }) => void;
	dispose: () => void;
} {
	const { onPlace, storage } = options;
	const win = options.win ?? windowOrUndefined();

	const readHash = (): string => {
		try {
			return win?.location.hash ?? "";
		} catch {
			return "";
		}
	};
	const writeHash = (hash: string, replace: boolean): void => {
		try {
			if (replace) win?.history.replaceState(null, "", hash);
			else win?.history.pushState(null, "", hash);
		} catch {
			// Without a history there is nothing to write; the app still moves.
		}
	};
	const remember = (place: Place): void => {
		if (place.surface !== "dispatch") return;
		try {
			(storage ?? globalThis.localStorage)?.setItem(TAB_KEY, place.tab);
		} catch {
			// Storage may be full or refused; forgetting the tab is not worth an error.
		}
	};

	const first = readHash();
	const start = landing(first, storage);
	if (parsePlace(first) === undefined) writeHash(formatPlace(start), true);
	remember(start);
	onPlace(start);

	const onPop = (): void => {
		const place = landing(readHash(), storage);
		remember(place);
		onPlace(place);
	};
	try {
		win?.addEventListener("popstate", onPop);
	} catch {
		// No window to listen to; `go` still works.
	}

	return {
		go(place, goOptions) {
			const next = formatPlace(place);
			if (next !== readHash()) writeHash(next, goOptions?.replace === true);
			remember(place);
			onPlace(place);
		},
		dispose() {
			try {
				win?.removeEventListener("popstate", onPop);
			} catch {
				// Already gone.
			}
		},
	};
}

function windowOrUndefined(): RouteWindow | undefined {
	try {
		return typeof window === "undefined" ? undefined : window;
	} catch {
		return undefined;
	}
}

/*
 * The Decks service worker: one front end, several backends (`src/connections/connection.ts`).
 *
 * A board's page has to come from the app's own address, because the canvas reaches into it, and a
 * backend other than the server this page came from is not at that address. So everything for
 * connection `<id>` is asked for under `/c/<id>/...`, and this worker answers it:
 *
 * - a **server** connection is fetched from that server, with its token, and handed back as if it
 *   were this origin's;
 * - a **bundle** connection is read from the files unpacked into Cache Storage when it was opened,
 *   laid out the way a server would lay them out (`server/src/share/bundle.ts`).
 *
 * An absolute `/api/...` that a page under `/c/<id>/` asks for (board.js does) is routed the same way,
 * by the address of the page that asked. Everything else, which is everything when only this
 * server is in use, is not touched.
 *
 * Kept as plain JavaScript in `public/` so it is served at the root, which is the scope it needs, and
 * changes without a build step.
 */
const TABLE_CACHE = "decks-connections";
const TABLE_KEY = "/__decks/connections";

/** @type {Map<string, {id: string, kind: string, base?: string, token?: string}> | undefined} */
let table;
const manifests = new Map();

async function loadTable() {
	const cache = await caches.open(TABLE_CACHE);
	const response = await cache.match(TABLE_KEY);
	const list = response ? await response.json() : [];
	table = new Map(list.map((one) => [one.id, one]));
	return table;
}
const ready = loadTable().catch(() => (table = new Map()));

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
	if (event.data?.type !== "connections") return;
	table = new Map(event.data.list.map((one) => [one.id, one]));
	manifests.clear();
	event.ports?.[0]?.postMessage("ok");
});

/** The connection a page belongs to, from its address: `/c/<id>/...`, or `?c=<id>` on the app itself. */
function connectionOfUrl(href) {
	const url = new URL(href);
	const prefixed = url.pathname.match(/^\/c\/([a-z0-9]+)\//);
	if (prefixed) return prefixed[1];
	return url.searchParams.get("c") || undefined;
}

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	const prefixed = url.pathname.match(/^\/c\/([a-z0-9]+)(\/.*)$/);
	if (prefixed) {
		event.respondWith(ready.then(() => route(prefixed[1], prefixed[2] + url.search, event.request)));
		return;
	}
	if (!url.pathname.startsWith("/api/") || !event.clientId || !table || table.size === 0) return;
	event.respondWith(
		(async () => {
			const client = await self.clients.get(event.clientId);
			const id = client ? connectionOfUrl(client.url) : undefined;
			if (!id || !table.has(id)) return fetch(event.request);
			return route(id, url.pathname + url.search, event.request);
		})(),
	);
});

function plain(status, text) {
	return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** A response with this origin's own URL: a navigation answered with another URL's response would take that URL. */
function own(response) {
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function route(id, rest, request) {
	const entry = table?.get(id);
	if (!entry) return plain(404, "This connection is not in this browser any more.");
	if (entry.kind === "server") return fromServer(entry, rest, request);
	if (entry.kind === "bundle") return fromBundle(id, rest);
	return plain(404, "Unknown connection.");
}

async function fromServer(entry, rest, request) {
	const headers = new Headers();
	for (const name of ["Accept", "Content-Type", "Range"]) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set("Authorization", `Bearer ${entry.token}`);
	const init = { method: request.method, headers, mode: "cors", credentials: "omit", redirect: "follow" };
	if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();
	try {
		const response = await fetch(`${entry.base.replace(/\/+$/, "")}${rest}`, init);
		return own(response);
	} catch (error) {
		return plain(502, `Could not reach ${entry.base}: ${error?.message ?? error}`);
	}
}

async function manifestOf(id) {
	if (manifests.has(id)) return manifests.get(id);
	const cache = await caches.open(`decks-bundle-${id}`);
	const response = await cache.match(`/c/${id}/manifest.json`);
	const manifest = response ? await response.json() : undefined;
	if (manifest) manifests.set(id, manifest);
	return manifest;
}

/** `a/b/../c` → `a/c`; undefined for a path that climbs out of the deck. */
function normalize(path) {
	const out = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (out.length === 0) return undefined;
			out.pop();
		} else out.push(part);
	}
	return out.join("/");
}

function decoded(path) {
	return path
		.split("/")
		.map((part) => {
			try {
				return decodeURIComponent(part);
			} catch {
				return part;
			}
		})
		.join("/");
}

async function entryOf(id, name) {
	const cache = await caches.open(`decks-bundle-${id}`);
	const hit = await cache.match(`/c/${id}/${name}`);
	return hit ? own(hit) : plain(404, `${name} is not in this canvas's file.`);
}

async function fromBundle(id, rest) {
	const url = new URL(rest, "http://bundle");
	const manifest = await manifestOf(id);
	if (!manifest) return plain(404, "This canvas's files are gone from this browser. Open the .decks file again.");
	const path = url.pathname;
	const after = (prefix) => normalize(decoded(path.slice(prefix.length)));
	if (path === "/api/hello") return Response.json({ decks: true, name: manifest.stage.title, bundle: true });
	if (path.startsWith("/api/board/")) {
		const file = after("/api/board/");
		if (!file) return plain(404, "Outside the canvas.");
		if (!url.searchParams.has("raw") && manifest.served.includes(file)) return entryOf(id, `served/${file}`);
		return entryOf(id, `deck/${file}`);
	}
	if (path.startsWith("/api/lib/")) {
		const file = after("/api/lib/");
		return file ? entryOf(id, `deck/lib/${file}`) : plain(404, "Outside the canvas.");
	}
	if (path.startsWith("/api/f/")) {
		const file = after("/api/f/");
		return file ? entryOf(id, `deck/${file}`) : plain(404, "Outside the canvas.");
	}
	if (path === "/api/file") {
		const asked = url.searchParams.get("path") ?? "";
		const from = url.searchParams.get("from") ?? "";
		const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
		const file = asked.startsWith("/") ? undefined : normalize(`${dir}/${asked}`);
		return file ? entryOf(id, `deck/${file}`) : plain(404, "Only files inside the canvas came with it.");
	}
	if (path.startsWith("/api/thumb/")) {
		const file = after("/api/thumb/");
		const pictures = (file && manifest.pictures[file]) || {};
		const scheme = url.searchParams.get("scheme") === "dark" ? "dark" : "light";
		const picture = pictures[scheme] ?? pictures.light ?? pictures.dark;
		return picture ? entryOf(id, picture) : plain(404, "No picture of this board came with the canvas.");
	}
	if (path.startsWith("/api/stage-pen/")) {
		return Response.json({ doc: manifest.pen.doc, base: `/c/${id}/api/f/${manifest.pen.base}`, boards: manifest.boards.map(({ path, x, y, w, h }) => ({ path, x, y, w, h })) });
	}
	return plain(404, "A canvas opened from a file can only be read.");
}

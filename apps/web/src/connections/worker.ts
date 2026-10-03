import { active, connections, elsewhere, PUBLIC, type Connection } from "./connection.ts";

/**
 * The service worker that serves every backend but this one (`public/sw.js`), and what it knows.
 *
 * It is registered only once there is something for it to do, so a Decks that only ever talks to
 * its own server never has one. It needs a secure page, which is HTTPS or localhost: on a plain
 * `http://` address on the network the browser has no service workers at all, and `available`
 * says so, which is what the switcher tells the person instead of failing later.
 */
const TABLE_CACHE = "decks-connections";
const TABLE_KEY = "/__decks/connections";

export function available(): boolean {
	return typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
}

/** What the worker routes by: id, kind, and for a server where it is and the token. */
function table(): unknown[] {
	return connections()
		.filter((one) => one.kind !== "here")
		.map((one) => (one.kind === "server" ? { id: one.id, kind: one.kind, base: one.base, token: one.token } : { id: one.id, kind: one.kind }));
}

/** Write the table where a restarted worker reads it, and tell the running one. */
export async function tellWorker(): Promise<void> {
	if (!available()) return;
	const list = table();
	const cache = await caches.open(TABLE_CACHE);
	await cache.put(TABLE_KEY, new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } }));
	const registration = await navigator.serviceWorker.getRegistration("/");
	const worker = registration?.active;
	if (!worker) return;
	await new Promise<void>((done) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => done();
		worker.postMessage({ type: "connections", list }, [channel.port2]);
		setTimeout(done, 1000);
	});
}

/**
 * Registered, told, and controlling this page: what has to be true before a page on another
 * connection loads anything under `/c/`. On a page that was not controlled when it loaded, the
 * worker claims it on activation; this waits for that rather than reloading.
 */
export async function ensureWorker(): Promise<void> {
	if (!available()) throw new Error("Opening another server or a canvas file needs this page on HTTPS or localhost; on a plain http:// address the browser has no service workers.");
	await navigator.serviceWorker.register("/sw.js", { scope: "/" });
	await navigator.serviceWorker.ready;
	if (!navigator.serviceWorker.controller) {
		await new Promise<void>((done) => {
			navigator.serviceWorker.addEventListener("controllerchange", () => done(), { once: true });
			setTimeout(done, 3000);
		});
	}
	await tellWorker();
}

/**
 * Ready to load another backend under `/c/<id>/`: the service worker where the page can have one,
 * and otherwise, for another server, this page's own server passing it through
 * (`server/src/share/relay.ts`). A canvas file has no server to pass it through, so it needs the
 * worker, and the public Decks has no server of its own to relay with.
 */
export async function reach(one: Connection): Promise<void> {
	if (one.kind === "here" || ready.has(one.id)) return;
	if (available()) await ensureWorker();
	// No worker and nothing to relay through: `ensureWorker` says why, in a sentence.
	else if (one.kind === "bundle" || PUBLIC) await ensureWorker();
	else {
		const response = await fetch("/api/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: one.id, base: one.base, token: one.token }) });
		if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `This server would not relay that one (${response.status}).`);
	}
	ready.add(one.id);
}

/**
 * Connections whose way in is ready, for this page: a switch to one of them waits on nothing, so
 * the app is off the screen for no longer than it takes to mount again. Kept for the page's life;
 * the relay is kept by the server for its own, and a server restart is the one thing that empties
 * it, which the next load sees.
 */
const ready = new Set<string>();

/**
 * Get every known server ready in the background, once the page is up, so the first switch to
 * one is as quick as the tenth. Failures are left for a switch to report.
 */
export function warm(): void {
	for (const one of connections()) if (one.kind === "server") void reach(one).catch(() => {});
}

/** Before the app starts: the way to the backend this tab is on, when it is not its own server. */
export async function prepare(): Promise<string | undefined> {
	const one = active();
	if (!one || !elsewhere()) {
		// Keep a worker that already exists current, without waiting on it.
		if (available() && connections().length > 1) void navigator.serviceWorker.getRegistration("/").then((found) => (found ? tellWorker() : undefined));
		return undefined;
	}
	try {
		await reach(one);
		return undefined;
	} catch (error) {
		return (error as Error).message;
	}
}

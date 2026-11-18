/**
 * What never changes, fetched through the page: the frame's way to a cache.
 *
 * A sandboxed frame has no site of its own, and a browser keeps no cache for such a frame: a file
 * the server marks "keep for a year" is fetched whole every time a frame starts. The page has a site
 * and a cache. So a frame asks its page for the unchanging things it needs, the drawing engine's
 * module, the fonts a canvas draws its words with, an icon, and the page fetches each once, keeps
 * the bytes, and hands a copy to every frame that asks.
 *
 * The line for it is a port of its own, offered by the frame as it boots, before it has said hello or
 * been started: what is asked on it is the same whatever the frame goes on to show, and a frame kept
 * spare can fill itself before it has anything to show.
 *
 * What the page will fetch is the page's to say (`serveKept`, `allowed`): only addresses anyone may
 * read, asked for with no login, since anything in the frame can ask, a card's script too. An
 * address it will not fetch, a page that serves none, or one that does not answer in time: the frame
 * fetches it itself, as it always did.
 */

/** A file as the page keeps it: its bytes and what kind it says it is. */
export interface Kept {
	bytes: ArrayBuffer;
	type: string;
}

type Ask = { id: number; url: string };
type Answer = { ready: true } | { id: number; kept?: Kept };

/** How long the frame waits for the page to say it serves the line, before fetching for itself. */
const READY_MS = 200;

// --- the frame's side ----------------------------------------------------------------------------

let line: MessagePort | undefined;
let ready: Promise<boolean> | undefined;
let asked = 0;
const waiting = new Map<number, (kept: Kept | undefined) => void>();

/** Offer the page the line, once, as the frame boots (`guest.ts`). */
export function offerKept(parent: Window): void {
	if (line) return;
	const channel = new MessageChannel();
	line = channel.port1;
	ready = new Promise<boolean>((resolve) => {
		const giveUp = setTimeout(() => resolve(false), READY_MS);
		channel.port1.onmessage = (event: MessageEvent<Answer>) => {
			const data = event.data;
			if ("ready" in data) {
				clearTimeout(giveUp);
				return resolve(true);
			}
			const done = waiting.get(data.id);
			waiting.delete(data.id);
			done?.(data.kept);
		};
	});
	parent.postMessage({ t: "kept" }, "*", [channel.port2]);
}

/**
 * The bytes at an address, from the page's keeping when it has a line and will fetch it; nothing
 * otherwise, and the caller fetches it itself. Never throws.
 */
export async function keptBytes(url: string): Promise<Kept | undefined> {
	if (!line || !ready || !(await ready)) return undefined;
	const id = ++asked;
	return new Promise<Kept | undefined>((resolve) => {
		waiting.set(id, resolve);
		line!.postMessage({ id, url } satisfies Ask);
	});
}

/** `fetch` for something that never changes: through the page when it keeps it, else from the network, as a response either way. */
export async function fetchKept(url: string): Promise<Response> {
	const kept = await keptBytes(url);
	return kept ? new Response(kept.bytes, { status: 200, headers: kept.type ? { "Content-Type": kept.type } : {} }) : fetch(url);
}

// --- the page's side -----------------------------------------------------------------------------

/** The most the page keeps, in bytes: past it, what was asked for longest ago goes first. */
const KEEP_MOST = 160 * 1024 * 1024;

/**
 * Serve the line to this page's frames, once: `allowed` says which addresses the page will fetch
 * (given whole, as the frame asked). Each is fetched with no login, kept, and copied to whoever asks;
 * one being fetched is not fetched twice. A frame is any frame of this page: what is served is public.
 */
export function serveKept(allowed: (url: URL) => boolean): void {
	if (serving) return;
	serving = true;
	const kept = new Map<string, Promise<Kept | undefined>>();
	const sizes = new Map<string, number>();
	let total = 0;
	const get = (address: string): Promise<Kept | undefined> => {
		let url: URL;
		try {
			url = new URL(address);
		} catch {
			return Promise.resolve(undefined);
		}
		if (!allowed(url)) return Promise.resolve(undefined);
		const had = kept.get(url.href);
		if (had) {
			// Asked for again: the latest, so the last to go.
			kept.delete(url.href);
			kept.set(url.href, had);
			return had;
		}
		const fetched = fetch(url.href, { credentials: "omit" })
			.then(async (response) => (response.ok ? { bytes: await response.arrayBuffer(), type: response.headers.get("content-type") ?? "" } : undefined))
			.catch(() => undefined);
		kept.set(url.href, fetched);
		void fetched.then((one) => {
			// Not to be had: asked for again next time rather than remembered as missing.
			if (!one) return void (kept.get(url.href) === fetched && kept.delete(url.href));
			sizes.set(url.href, one.bytes.byteLength);
			total += one.bytes.byteLength;
			for (const old of kept.keys()) {
				if (total <= KEEP_MOST || old === url.href) break;
				kept.delete(old);
				total -= sizes.get(old) ?? 0;
				sizes.delete(old);
			}
		});
		return fetched;
	};
	addEventListener("message", (event: MessageEvent<{ t?: string } | null>) => {
		const port = event.ports[0];
		if (event.data?.t !== "kept" || !port) return;
		// One of this page's own frames, whichever: nothing else is given the line.
		if (![...document.querySelectorAll("iframe")].some((frame) => frame.contentWindow === event.source)) return;
		port.onmessage = (asked: MessageEvent<Ask>) => {
			const { id, url } = asked.data;
			void get(url).then((one) => {
				if (!one) return port.postMessage({ id } satisfies Answer);
				// A copy, handed over whole: the page's own stays with it.
				const bytes = one.bytes.slice(0);
				port.postMessage({ id, kept: { bytes, type: one.type } } satisfies Answer, [bytes]);
			});
		};
		port.postMessage({ ready: true } satisfies Answer);
	});
}
let serving = false;

import { mountCard } from "@decks/canvas/card";
import { measureFrame } from "./measure/page.ts";

/**
 * One card (or a page), measured for `decks.canvas.fit` when no canvas has measured it
 * (`server/stage/shots.ts`).
 *
 * A card is measured where it is drawn, and a card nobody is looking at is drawn nowhere: an agent
 * writing on its own canvas while the person looks at another was told "nothing has measured" on most
 * fits. This page draws it instead, in the server's own Chromium, and draws it the way the canvas
 * frame does (`card-surface.tsx`): `mountCard` in a closed shadow root at the card's width, board.css
 * adopted, its modules handed the card (`CardContext`), and its height heard as it changes. A card in a
 * plain frame got none of that: a script that asked its card for `on` or `file` threw, a height set a
 * moment after waking was never seen, and fit read the card without its script.
 *
 * Anything else the deck lists (a document page, a board on a friend's canvas) is laid out in a frame
 * at its own size and measured as a page (`measure/page.ts`).
 */

type Measured = { w: number; h: number; at: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number };
type MeasureWindow = Window & { __measured?: Measured | null; __measureFailed?: string };
const measureWindow = window as MeasureWindow;

const query = new URLSearchParams(location.search);
const path = query.get("path") ?? "";
const w = Number(query.get("w")) || 1000;
const h = Number(query.get("h")) || 240;
const address = new URL(`/api/card/${path.split("/").map(encodeURIComponent).join("/")}`, location.href).href;
/** How long a page or a card may take to show anything at all. */
const READY_MS = 10_000;
/**
 * A card has no "ready": its scripts start as they arrive and may change its height whenever they
 * like, and the frame reports every change. Here the height is taken once it has held this long…
 */
const STILL_MS = 800;
/** …and no sooner than this after the card is put in, so a script that waits a beat is seen. */
const FIRST_MS = 1000;

const isCard = /(?:^|\/)cards\/[^/]+\/index\.html$/i.test(path);

if (isCard) void measureCard();
else measurePage();

async function measureCard(): Promise<void> {
	const raw = new URL(address);
	raw.searchParams.set("raw", "1");
	let html: string;
	try {
		const response = await fetch(raw.href, { cache: "no-cache" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		html = await response.text();
	} catch (error) {
		measureWindow.__measureFailed = `the card could not be read: ${error instanceof Error ? error.message : String(error)}`;
		return;
	}
	const host = document.createElement("div");
	host.className = "card-host";
	// As the frame sizes it (`card-surface.tsx`): the card's box; its content is as tall as it comes to.
	Object.assign(host.style, { width: `${w}px`, height: `${h}px` });
	document.body.append(host);
	// A friend's card runs nothing on the canvas, so nothing here either.
	const card = mountCard(host, { html, url: address, path, trusted: !path.startsWith("shared/"), theme: "light", size: { w, h } });
	const started = performance.now();
	let height = 0;
	let changed = started;
	card.onHeight((next) => {
		height = next;
		changed = performance.now();
	});
	const done = () => (measureWindow.__measured = { w, h: height, at: w, page: height, ...card.reading() });
	const attempt = () => {
		const now = performance.now();
		if (height > 0 && now - started >= FIRST_MS && now - changed >= STILL_MS) return void done();
		if (now - started > READY_MS) {
			// Still changing after all that (an animation, a clock): the height it has now.
			if (height > 0) done();
			else measureWindow.__measureFailed = "the card never laid out";
			return;
		}
		setTimeout(attempt, 100);
	};
	attempt();
}

function measurePage(): void {
	const frame = document.createElement("iframe");
	frame.src = address;
	frame.setAttribute("scrolling", "no");
	Object.assign(frame.style, { width: `${w}px`, height: `${h}px` });
	document.body.append(frame);
	const started = performance.now();
	const attempt = () => {
		const measured = measureFrame(frame);
		if (measured) {
			measureWindow.__measured = measured;
			return;
		}
		if (performance.now() - started > READY_MS) {
			measureWindow.__measureFailed = "the page never said it was ready";
			return;
		}
		setTimeout(attempt, 100);
	};
	frame.addEventListener("load", attempt, { once: true });
}

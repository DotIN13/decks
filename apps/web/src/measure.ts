import { mountCard } from "@decks/canvas/card";
import { measureFrame } from "./measure/page.ts";

/**
 * One card (or a page), measured for `decks.canvas.fit` when no canvas has measured it
 * (`server/stage/shots.ts`).
 *
 * A card is measured where it is drawn, and a card nobody is looking at is drawn nowhere: an agent
 * writing on its own canvas while the person looks at another was told "nothing has measured" on most
 * fits. This page draws it instead, in the server's own Chromium, and draws it the way the canvas
 * frame does (`card-surface.tsx`): `mountCard` in a closed shadow root at the card's width, card.css
 * adopted, its modules handed the card (`CardContext`), and its height heard as it changes. A card in a
 * plain frame got none of that: a script that asked its card for `on` or `file` threw, a height set a
 * moment after waking was never seen, and fit read the card without its script.
 *
 * Anything else the deck lists (a document page, a board on a friend's canvas) is laid out in a frame
 * at its own size and measured as a page (`measure/page.ts`).
 *
 * **The card's picture is taken here too** (`picture=1`, `server/pictures/service.ts`): the same card,
 * mounted the same way, in the scheme asked for (`scheme=`), so what the canvas shows for a card that is
 * not live is what it shows live. Once its height has held, the host is made as tall as the card came
 * to (never below its box), the fonts it uses are awaited, and `__cardHeight` and `__cardReady` say so.
 * A picture taken from the card as a page of its own was a different card: card.css after the card's
 * own styles instead of before, no `card` for its script, and another root's inherited type.
 */

type Measured = { w: number; h: number; at: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number };
type MeasureWindow = Window & { __measured?: Measured | null; __measureFailed?: string; __cardReady?: boolean; __cardHeight?: number };
const measureWindow = window as MeasureWindow;

const query = new URLSearchParams(location.search);
const path = query.get("path") ?? "";
const w = Number(query.get("w")) || 1000;
const h = Number(query.get("h")) || 240;
/** For a picture (`picture=1`): the scheme it is drawn in, as the canvas frame hands a card its theme. */
const picture = query.get("picture") === "1";
const theme = query.get("scheme") === "dark" ? "dark" : "light";
document.documentElement.dataset.colorScheme = theme;
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
/**
 * A picture of a card that runs no script has nothing to wait for but its sheet, its parts and its
 * fonts: its height is taken once it has held this long, so re-picturing a deck is not a second a card.
 */
const STILL_NO_SCRIPT_MS = 300;

const isCard = /(?:^|\/)cards\/[^/]+\/index\.html$/i.test(path);
/** A document's file (`document=1`): markdown, rendered as a card is for its picture. */
const isDocument = query.get("document") === "1";

if (isDocument) void measureDocument();
else if (isCard) void measureCard();
else measurePage();

/**
 * A document's picture: its markdown fetched as the file it is, set with `marked` inside a card's
 * root with card.css, so a document asleep on the canvas shows its words as its editor sets them.
 */
async function measureDocument(): Promise<void> {
	let source: string;
	try {
		const response = await fetch(address, { cache: "no-cache" });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		source = await response.text();
	} catch (error) {
		measureWindow.__measureFailed = `the document could not be read: ${error instanceof Error ? error.message : String(error)}`;
		return;
	}
	const { marked } = await import("marked");
	const body = marked.parse(source, { gfm: true, breaks: false, async: false }) as string;
	const html = `<style>.doc { padding: 40px 48px; font-size: 17px; line-height: 1.5 } .doc > :first-child { margin-top: 0 }</style><div class="doc">${body}</div>`;
	const host = document.createElement("div");
	host.className = "card-host";
	Object.assign(host.style, { width: `${w}px`, height: `${h}px` });
	document.body.append(host);
	const card = mountCard(host, { html, url: address, path, trusted: false, theme, size: { w, h } });
	let height = 0;
	card.onHeight((next) => (height = next));
	await card.drawn;
	await new Promise((done) => setTimeout(done, STILL_NO_SCRIPT_MS));
	measureWindow.__measured = { w, h: height, at: w, page: height };
	if (picture) void ready(host, height);
}

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
	const card = mountCard(host, { html, url: address, path, trusted: !path.startsWith("shared/"), theme, size: { w, h } });
	const started = performance.now();
	// What the frame would run: the deck's own card's scripts (a friend's run nothing).
	const scripted = !path.startsWith("shared/") && /<script\b/i.test(html);
	const first = picture && !scripted ? 0 : FIRST_MS;
	const still = picture && !scripted ? STILL_NO_SCRIPT_MS : STILL_MS;
	let height = 0;
	let changed = started;
	let drawn = false;
	void card.drawn.then(() => {
		drawn = true;
		changed = Math.max(changed, performance.now());
	});
	card.onHeight((next) => {
		height = next;
		changed = performance.now();
	});
	const done = () => {
		measureWindow.__measured = { w, h: height, at: w, page: height, ...card.reading() };
		if (picture) void ready(host, height);
	};
	const attempt = () => {
		const now = performance.now();
		if (height > 0 && drawn && now - started >= first && now - changed >= still) return void done();
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

/** A picture's card made as tall as it came to, never below its box, with its fonts in: then it is ready to be taken. */
async function ready(host: HTMLElement, height: number): Promise<void> {
	const tall = Math.max(h, Math.ceil(height));
	host.style.height = `${tall}px`;
	await Promise.race([document.fonts.ready, new Promise((done) => setTimeout(done, 3000))]);
	await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
	measureWindow.__cardHeight = tall;
	measureWindow.__cardReady = true;
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

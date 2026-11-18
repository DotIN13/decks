/**
 * What never changes is fetched once, by the page, for all its frames (`@decks/frame`, `kept.ts`;
 * `@decks/canvas`, `frame/outside/kept.ts`).
 *
 * A sandboxed frame has no cache in the browser: a font it fetched itself was fetched again by every
 * frame that started, megabytes each time from a far device. Now a frame asks its page, on a line it
 * offers as it boots, and the page fetches each file once, keeps it, and hands every frame a copy.
 * The faces nearly every canvas uses come from the app itself (`public/fonts`), not the font CDN.
 *
 * What is checked: the canvas draws its words with Inter fetched from the app's own address, by the
 * page and not by the frame; a second canvas, in a frame of its own, asks for the same face and no
 * request for it leaves the browser again; the page refuses what is not public (a card's file, with
 * a pass in its address, is not fetched for a frame), and the frame then fetches it itself.
 */
import { API, asPerson, canvasFrame, open, resetStage, rest, say, settle } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const made = await call("canvas.create", ["Kept two"]);
await call("canvas.insert", [{ type: "text", id: "words", content: "Words set in Inter", fontSize: 28 }, { canvas: made.value?.name, at: { x1: 0, y1: 0 } }]);

/** Every request for a font file: its address, and whether the page itself made it. */
const fonts = [];
const { browser, page, errors } = await open({
	width: 1600,
	height: 900,
	before: (context) =>
		context.on("request", (request) => {
			if (!/\.ttf(\?|$)/.test(request.url())) return;
			let byPage = false;
			try {
				byPage = request.frame() === request.frame().page().mainFrame();
			} catch {
				// A worker's request has no frame.
			}
			fonts.push({ url: request.url(), byPage });
		}),
});
await rest(page, { start: 0 });
await settle(page, 1500);
const inter = () => fonts.filter((one) => /\/fonts\/inter\/latin-400-normal\.ttf/.test(one.url));
const first = await until(async () => (inter().length ? inter() : undefined));
say("the canvas's Inter comes from the app's own address", !!first && new URL(first[0].url).origin === new URL(page.url()).origin, JSON.stringify(fonts.slice(0, 6)));
say("…fetched by the page, for its frame, and not by the frame", !!first && first.every((one) => one.byPage), JSON.stringify(first));
say("…and not from the font CDN", !fonts.some((one) => /cdn\.jsdelivr\.net\/fontsource\/fonts\/inter@latest\/latin-400-normal/.test(one.url)), JSON.stringify(fonts.filter((one) => /jsdelivr/.test(one.url)).slice(0, 4)));

// --- a second canvas, in a frame of its own: the same face, and nothing fetched again ---------------------
const before = inter().length;
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Kept two")').click();
const drawn = await until(async () => ((await (await canvasFrame(page)).evaluate(() => (globalThis.__decksProbes?.frameDrawn?.().children ?? []).map((one) => one.id))).includes("words") ? true : undefined));
await settle(page, 1500);
const frames = await page.locator("iframe.canvas-frame, iframe.canvas-frame-kept").count();
say("a second canvas starts in a frame of its own, and no request for the face leaves the browser again", !!drawn && frames === 2 && inter().length === before, JSON.stringify({ frames, before, after: inter().length }));

// --- only what is public: the page fetches nothing that needs a pass --------------------------------------
const refused = await (await canvasFrame(page)).evaluate(async () => {
	// As a card's script could: a line of its own offered to the page, and a file of the harness's asked for on it.
	const channel = new MessageChannel();
	const answers = [];
	channel.port1.onmessage = (event) => answers.push(event.data);
	parent.postMessage({ t: "kept" }, "*", [channel.port2]);
	await new Promise((done) => setTimeout(done, 200));
	const ask = (id, url) => channel.port1.postMessage({ id, url });
	ask(1, new URL("/api/hello", location.href).href);
	ask(2, new URL("/api/v1/canvas.list", location.href).href);
	ask(3, "https://example.com/anything.ttf");
	ask(4, "not an address");
	await new Promise((done) => setTimeout(done, 800));
	return answers;
});
say("asked for the harness's own answers or another site's files, the page fetches none of them", refused.some((one) => one.ready) && [1, 2, 3, 4].every((id) => refused.some((one) => one.id === id && one.kept === undefined)), JSON.stringify(refused).slice(0, 200));

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();

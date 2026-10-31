/**
 * Every card's picture is fetched at the rung of the device's ladder its drawn width needs
 * (`device.ts`, `PICTURES`: 192 / 480 / 800 on a big GPU, 192 / 480 on a small one;
 * `picture-ladder.ts`), and the GPU makes its smaller sizes. Zooming in at rest fetches a higher rung,
 * only for cards that need one; zooming back out fetches nothing. Over the budget, pictures shrink on
 * the GPU (`fitPictures`), with no request either. Chromium (a big GPU) and WebKit as an iPhone (a
 * small one).
 */
import { canvasFrame, open, resetStage, say, settle } from "../harness.mjs";
import { TARGETS, noGpu, outOfLive, zoomStep } from "../backends-kit.mjs";

/** The card pictures asked for: `{ card, w }`, `w` 0 for the whole picture. */
function watchCopies(page) {
	const asked = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		// The server's picture of a card (`/thumb/…`): `whole=1`, and `w=` for a rung.
		if (!url.searchParams.has("whole")) return;
		asked.push({ card: decodeURIComponent(url.pathname).replace(/^.*\/thumb\//, ""), w: Number(url.searchParams.get("w") ?? 0), astc: url.searchParams.get("astc") === "1" });
	});
	return asked;
}
/** WebKit as an iPhone, as a real one reports itself: Playwright's says it is a Mac with no touch. */
function asIPhone() {
	Object.defineProperty(Navigator.prototype, "platform", { get: () => "iPhone" });
}
/** Each card's rung, as asked or held, whichever is more. */
const held = (frame) =>
	frame.evaluate(() => {
		const engine = window.__decksRust;
		const out = {};
		for (const [key, one] of engine.picturesAsked) if (key.startsWith("card:")) out[key] = Math.max(one.size ?? 0, engine.heldWidth.get(key) ?? 0);
		return out;
	});
/** The rung each card wants at this zoom, the way `rungFor` chooses it. */
const wanted = (frame) =>
	frame.evaluate(() => {
		const engine = window.__decksRust;
		const ladder = engine.pictures.ladder;
		const out = {};
		for (const card of engine.placedCards) {
			const drawn = card.w * engine.camera.zoom * (devicePixelRatio || 1);
			out[`card:${card.path}`] = ladder.find((width) => width * 1.25 >= drawn) ?? ladder[ladder.length - 1];
		}
		return out;
	});

for (const target of TARGETS) {
	const name = target.label;
	const ladder = target.slug === "chromium" ? [192, 480, 800] : [192, 480];
	await resetStage();
	const { browser, page, errors } = await open({ ...target.open, cards: false, init: target.slug === "chromium" ? undefined : `(${noGpu})(); (${asIPhone})();` });
	// The stage and its engine are in the canvas frame.
	const canvas = await canvasFrame(page);
	await canvas.waitForFunction(() => window.__decksEngine?.stats?.().workerBackend, null, { timeout: 30000 }).catch(() => {});
	say(`${name}: the device's ladder is ${ladder.join(" / ")}`, JSON.stringify(await canvas.evaluate(() => window.__decksRust.pictures.ladder)) === JSON.stringify(ladder));
	const asked = watchCopies(page);
	await outOfLive(page);
	for (let i = 0; i < 6; i++) {
		await zoomStep(page, 80);
		await settle(page, 120);
	}
	await settle(page, 2500);
	const first = await held(canvas);
	const want = await wanted(canvas);
	say(`${name}: zoomed out, every card holds at least the rung its drawn width needs, never a width off the ladder`, Object.keys(first).length > 0 && Object.entries(first).every(([key, w]) => ladder.includes(w) && w >= want[key]), JSON.stringify({ first, want }).slice(0, 300));
	say(`${name}: …and only the ladder's widths are asked for`, asked.every((one) => ladder.includes(one.w)), JSON.stringify(asked.slice(0, 4)));
	// Compressed wherever the GPU takes ASTC: WebGPU with the feature, or WebGL 2 with `WEBGL_compressed_texture_astc` (any Mac's).
	if (await canvas.evaluate(() => window.__decksRust.page.compressedPictures())) {
		// A first look gets the server's stand-in for a rung it has not made yet, asked again until it has.
		const cards = Object.keys(first).length;
		const put = () => canvas.evaluate(() => window.__decksRust.compressedPut);
		for (let i = 0; i < 40 && (await put()) < cards; i++) await settle(page, 500);
		const perPixel = await canvas.evaluate(() => {
			const engine = window.__decksRust;
			const each = [...engine.compressedSize].map(([key, [w, h]]) => engine.pictureBytes.get(key) / (w * h));
			return each.length ? Math.max(...each) : 0;
		});
		say(`${name}: pictures are asked for compressed, for the GPU`, asked.every((one) => one.astc), JSON.stringify(asked.slice(0, 3)));
		say(`${name}: …and come compressed, every card`, (await put()) >= cards, `${await put()} put compressed for ${cards} cards`);
		say(`${name}: …about a byte a pixel on the GPU, its smaller sizes included`, perPixel > 1 && perPixel < 1.6, perPixel.toFixed(2));
	} else say(`${name}: where the GPU takes no ASTC, pictures are not asked for compressed`, asked.every((one) => !one.astc), JSON.stringify(asked.slice(0, 3)));

	// In, below the live zoom, resting between: only higher rungs are fetched.
	const before = asked.length;
	for (let i = 0; i < 4; i++) {
		if (await canvas.evaluate(() => document.querySelector(".stage")?.dataset.live === "true")) break;
		await zoomStep(page, -30);
		await settle(page, 400);
	}
	await settle(page, 1500);
	const inward = asked.slice(before);
	const rungOf = (card) => first[`card:${card}`] ?? 0;
	say(`${name}: zooming in fetches only a higher rung than a card held`, inward.every((one) => one.w > rungOf(one.card)), JSON.stringify(inward.slice(0, 6)));
	const near = await held(canvas);
	// And back out: nothing is fetched, and nothing goes down a rung.
	const back = asked.length;
	for (let i = 0; i < 4; i++) {
		await zoomStep(page, 80);
		await settle(page, 400);
	}
	await settle(page, 1500);
	say(`${name}: zooming back out fetches nothing`, asked.length === back, JSON.stringify(asked.slice(back, back + 6)));
	say(`${name}: …and each card keeps the rung it had`, JSON.stringify(await held(canvas)) === JSON.stringify(near), JSON.stringify(await held(canvas)).slice(0, 300));

	// A budget far too small: the pictures shrink on the GPU, with no request.
	const sent = asked.length;
	const shrunk = await canvas.evaluate(async () => {
		const engine = window.__decksRust;
		const was = engine.heldBytes();
		window.__decksPictureMB = 0.05;
		engine.fitPictures();
		await new Promise((done) => setTimeout(done, 300));
		return { was, bytes: engine.heldBytes() };
	});
	const backend = await canvas.evaluate(() => window.__decksEngine?.stats?.().backend);
	// WebGL 2 cannot copy a compressed picture's smaller sizes (`Gpu::shrink`), so a compressed one does not shrink there.
	if (backend === "webgl2") say(`${name}: on WebGL 2 compressed pictures do not shrink`, shrunk.bytes <= shrunk.was, JSON.stringify({ backend, ...shrunk }));
	else say(`${name}: over the budget, pictures shrink on the GPU`, shrunk.bytes < shrunk.was, JSON.stringify({ backend, ...shrunk }));
	say(`${name}: …with no picture fetched for it`, asked.length === sent, JSON.stringify(asked.slice(sent, sent + 4)));
	await canvas.evaluate(() => delete window.__decksPictureMB);
	say(`${name}: no errors on the page`, errors.length === 0, errors.join(" | "));
	await browser.close();
}

/**
 * A card's picture from its canvas's `files/` (`<img src="../../files/pic.png">`) shows in a screenshot the
 * server's Chrome draws from the canvas's snapshot of the card (on the canvas itself it always loaded). The snapshot kept the canvas
 * pass in every address, which the server's Chrome, reading on a pass of its own, was refused: the card's
 * words showed and its pictures were drawn broken (`card-snapshot.ts`, `passFree`).
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { API, asPerson, cardFile, open, resetStage, say } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const files = `${dirname(dirname(dirname(await cardFile("plan"))))}/files`;
mkdirSync(files, { recursive: true });
copyFileSync(new URL("../../apps/web/public/icon-192.png", import.meta.url).pathname, `${files}/pic.png`);
const made = await call("canvas.insert", [{ type: "card", title: "Pic", html: `<div class="doc"><img id="pic" src="../../files/pic.png" style="width:120px"></div>`, width: 400, height: 200 }]);
const CARD = made.value?.card;
// A page of the harness's own, to read the screenshot's pixels in.
const { browser, page } = await open({ width: 800, height: 600 });
const shot = await call("canvas.screenshot", [{ of: CARD, live: true }]);
say("a live screenshot of it", shot.ok === true, JSON.stringify(shot.value ?? shot).slice(0, 200));
if (shot.ok) {
	const { deckState } = await import("../harness.mjs");
	const bytes = readFileSync(`${(await deckState()).path}/${shot.value.file}`).toString("base64");
	const type = shot.value.file.endsWith(".png") ? "png" : "webp";
	const k = shot.value.width / 400;
	const spread = await page.evaluate(async ({ data, type, k }) => {
		const image = await createImageBitmap(await (await fetch(`data:image/${type};base64,${data}`)).blob());
		const g = new OffscreenCanvas(image.width, image.height).getContext("2d");
		g.drawImage(image, 0, 0);
		// Inside the icon's light top-left square, 60 to 90 across and 62 to 78 down: the card's dark ground when the picture is broken.
		const px = g.getImageData(Math.round(60 * k), Math.round(62 * k), Math.round(30 * k), Math.round(16 * k)).data;
		let light = 0;
		for (let i = 0; i < px.length; i += 4) if (px[i] > 150 && px[i + 1] > 150 && px[i + 2] > 150) light++;
		return Math.round((100 * light) / (px.length / 4));
	}, { data: bytes, type, k });
	say("…has the picture in it, not a broken one", spread > 80, `${spread}% light inside the picture's top-left square`);
}
await browser.close();

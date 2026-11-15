/**
 * A card's `:host { background }` is its whole ground.
 *
 * The card sheet painted the card's page (`.card-body`, a board's `body.board`) with the theme's
 * ground, over the host, so a card that set `:host { background: #000 }` showed it only below its
 * content (`items/card.ts`). Here: a card whose only style is that rule, awake on the canvas, in
 * both schemes; a point in its words' row and one below them are black.
 */
import { API, asPerson, canvasFrame, flyToCard, open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const html = `<style>:host { background: #000 } p { margin: 0; padding: 20px 40px; color: #000; font-size: 18px }</style><div class="doc"><p>words</p></div>`;
const made = await call("canvas.insert", [{ type: "card", title: "Black", html, width: 600, height: 300 }]);
const CARD = made.value?.card;
say("a card whose only style is :host { background: #000 }", made.ok === true && !!CARD, JSON.stringify(made).slice(0, 160));

for (const scheme of ["light", "dark"]) {
	const { browser, page, errors } = await open({ width: 1400, height: 900, scheme });
	const canvas = await canvasFrame(page);
	await flyToCard(page, CARD);
	await settle(page, 400);
	await canvas.waitForFunction((wanted) => [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted)?.dataset.state === "live", CARD, { timeout: 8000 }).catch(() => {});
	await settle(page, 400);
	const r = await canvas.evaluate((wanted) => (window.__decksProbes?.cards?.() ?? []).find((one) => one.path === wanted)?.rect.toJSON() ?? null, CARD);
	const shot = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.width, height: r.height } });
	const pixels = await page.evaluate(async ({ data, w, h }) => {
		const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
		const c = new OffscreenCanvas(image.width, image.height);
		const g = c.getContext("2d");
		g.drawImage(image, 0, 0);
		const at = (fx, fy) => [...g.getImageData(Math.round(image.width * fx), Math.round(image.height * fy), 1, 1).data.slice(0, 3)];
		return { words: at(0.8, (h ? 30 / h : 0.1)), below: at(0.5, 0.7) };
	}, { data: shot.toString("base64"), w: r.width, h: r.height });
	const black = (rgb) => rgb.every((v) => v < 12);
	say(`${scheme}: black beside its words, where its page lies`, black(pixels.words), JSON.stringify(pixels.words));
	say(`${scheme}: …and below them`, black(pixels.below), JSON.stringify(pixels.below));
	say(`${scheme}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
	await browser.close();
}

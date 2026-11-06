/**
 * A card's frame is its browser item's own pen fields: corner, outline and shadow.
 *
 * Every card had the canvas's 12 px corner and 1 px outline and no shadow, whatever its item said.
 * Now its `cornerRadius` rounds its page, its picture and the drawing's hole for it; its `stroke` and
 * `strokeWidth` are an outline painted with the drawing (`paint`'s `browser_frame`), which takes the
 * canvas's outline away; its `effect` shadows fall outside it. Here: two black cards side by side, one
 * plain and one with `cornerRadius: 0`, an outer red outline 6 wide and a blue shadow spread 14; awake
 * on the canvas, and in a native screenshot (each card its picture): the framed card's corner is its own
 * (black), the plain one's is the canvas's (round); red just outside the framed card, blue past that,
 * neither by the plain one. (A sleeping card's picture takes its corners in the engine: `engine.rs`, `a_cards_picture_has_its_items_corners`.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, canvasFrame, deckState, flyToCard, open, resetStage, say, selectCard, settle } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const html = `<style>:host { background: #000 }</style><div class="doc"><p style="margin:0;padding:20px;color:#000">x</p></div>`;
const plain = await call("canvas.insert", [{ type: "card", title: "Plain", html, width: 400, height: 240 }, { at: { x1: -3000, y1: -3000 } }]);
const framed = await call("canvas.insert", [{ type: "card", title: "Framed", html, width: 400, height: 240 }, { at: { x1: -2500, y1: -3000 } }]);
const set = await call("canvas.update", [framed.value?.id, { set: { cornerRadius: 0, stroke: "#ff0000", strokeWidth: 6, strokeAlignment: "outer", effect: { type: "shadow", offset: { x: 0, y: 0 }, blur: 0, spread: 14, color: "#0000ff" } } }]);
say("two black cards, one framed by its item's corner, outline and shadow", plain.ok && framed.ok && set.ok, JSON.stringify(set).slice(0, 200));
const A = plain.value.card;
const B = framed.value.card;

const { browser, page, errors } = await open({ width: 1400, height: 900, scheme: "dark" });
const canvas = await canvasFrame(page);
const frameBox = await (await canvas.frameElement()).boundingBox();
// In the page's pixels: the probe's rect is the canvas frame's.
const rect = async (path) => {
	const r = await canvas.evaluate((wanted) => (window.__decksProbes?.cards?.() ?? []).find((one) => one.path === wanted)?.rect.toJSON() ?? null, path);
	return r && { x: r.x + frameBox.x, y: r.y + frameBox.y, width: r.width, height: r.height };
};
const sample = async (points) => {
	const out = [];
	for (const [x, y] of points) {
		const shot = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
		out.push(await page.evaluate(async (data) => {
			const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
			const g = new OffscreenCanvas(image.width, image.height).getContext("2d");
			g.drawImage(image, 0, 0);
			return [...g.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data.slice(0, 3)];
		}, shot.toString("base64")));
	}
	return out;
};
const black = (c) => c.every((v) => v < 20);
// Red, though blended at its edge with the blue beside it.
const red = (c) => c[0] > 140 && c[1] < 80 && c[0] > c[2];
const blue = (c) => c[2] > 180 && c[0] < 80 && c[1] < 80;

await flyToCard(page, B);
await page.mouse.move(700, 450);
const onScreen = (r) => r && r.x > 380 && r.y > 30 && r.x + r.width < 1370 && r.y + r.height < 870;
{
	const label = "awake";
	// Out until both are whole on the screen, clear of the side panel.
	for (let i = 0; i < 12 && !(onScreen(await rect(A)) && onScreen(await rect(B))); i++) {
		await page.keyboard.press("ControlOrMeta+Minus");
		await settle(page, 300);
	}
	await settle(page, 3000);
	const a = await rect(A);
	const b = await rect(B);
	say(`${label}: both cards are on screen`, onScreen(a) && onScreen(b), JSON.stringify({ a, b }));
	const z = b.width / 400;
	// Each card sampled while the other is selected, so no selection handle lies on what is sampled.
	const pick = async (path) => { await selectCard(page, path); await page.mouse.move(1380, 450); await settle(page, 800); };
	await pick(A);
	const quarter = b.y + b.height / 4;
	const [bCorner, bRed, bBlue] = await sample([[b.x + 1.5, b.y + 1.5], [b.x - 3 * z, quarter], [b.x - 11 * z, quarter]]);
	await pick(B);
	const [aCorner, aOut] = await sample([[a.x + 1.5, a.y + 1.5], [a.x - 3 * z, a.y + a.height / 4]]);
	say(`${label}: the framed card's corner is square, its own black`, black(bCorner), JSON.stringify(bCorner));
	say(`${label}: …the plain card's is the canvas's round one`, !black(aCorner), JSON.stringify(aCorner));
	say(`${label}: its red outline just outside it`, red(bRed), JSON.stringify(bRed));
	say(`${label}: …its blue shadow past that`, blue(bBlue), JSON.stringify(bBlue));
	say(`${label}: …and neither by the plain card`, !red(aOut) && !blue(aOut), JSON.stringify(aOut));
}
// --- a screenshot: the native renderer (`stage-shot`), each card its picture, as `decks canvas screenshot` draws it ---
{
	const shot = await call("canvas.screenshot", [{ of: [plain.value.id, framed.value.id], scale: 1, scheme: "dark" }]);
	const v = shot.value ?? {};
	say("a screenshot of both, drawn natively", shot.ok === true && /native/.test(String(v.how)), JSON.stringify(v).slice(0, 200));
	if (shot.ok) {
		const bytes = readFileSync(join((await deckState()).path, v.file)).toString("base64");
		const k = v.width / (v.box.x2 - v.box.x1);
		const at = (x, y) => [(x - v.box.x1) * k, (y - v.box.y1) * k];
		const px = await page.evaluate(async ({ data, points }) => {
			const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
			const g = new OffscreenCanvas(image.width, image.height).getContext("2d");
			g.drawImage(image, 0, 0);
			return points.map(([x, y]) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]);
		}, { data: bytes, points: [at(-2500 + 1.5, -3000 + 1.5), at(-3000 + 1.5, -3000 + 1.5), at(-2500 - 3, -2940), at(-2500 - 11, -2940)] });
		say("screenshot: the framed card's corner is square", black(px[0]), JSON.stringify(px[0]));
		say("screenshot: …the plain card's is round", !black(px[1]), JSON.stringify(px[1]));
		say("screenshot: the red outline and the blue shadow outside the framed card", red(px[2]) && blue(px[3]), JSON.stringify(px.slice(2)));
	}
}
say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

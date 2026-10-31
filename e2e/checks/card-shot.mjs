/**
 * An agent's screenshot of a card is the card as the person has it (`decks canvas screenshot` with `of`
 * a card): the canvas frame writes the card's live shadow root out (`items/card-snapshot.ts`), the
 * harness's Chrome draws it (`/api/snapshot`), and the picture has what was typed into the card's field
 * and what its script drew into a canvas, as the browser shows them.
 *
 * The card's script paints its canvas green in the canvas frame and red in a page of its own (the
 * server's picture, `card.page`), so a green canvas in the picture is the browser's.
 *
 * Needs no model: the card goes in over the API, as the person.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, canvasFrame, deckState, open, say, settle, failed } from "../harness.mjs";

const call = async (verb, args = [], headers = {}) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) })).json();
const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
};

const person = await asPerson();
const { browser, page, errors } = await open({ width: 1400, height: 900, scheme: "light", cards: false });
const frame = await canvasFrame(page);

const ID = "shot-card";
const html = `<div class="doc"><h1>Shot card</h1><input id="field" value="" style="font-size:20px;width:320px"><canvas id="pic" width="200" height="80" style="display:block;margin-top:12px;width:200px;height:80px"></canvas></div>
<script type="module">
export default function (card) { const c = card.root.getElementById("pic").getContext("2d"); c.fillStyle = card.page ? "#ff0000" : "#00ff00"; c.fillRect(0, 0, 200, 80); }
</script>`;
// On the canvas on screen: the person's call with no canvas named lands on it.
const inserted = await call("canvas.insert", [{ type: "card", id: ID, html, title: "Shot card", width: 480, height: 260 }, { at: { x1: 0, y1: -3000 } }], person);
say("the card goes in", inserted.ok, JSON.stringify(inserted).slice(0, 300));
const path = inserted.value?.card;
const canvasName = path?.split("/")[1];
// Once the frame has the card in its drawing.
await until(() => frame.evaluate((id) => !!globalThis.__decksFrameDrawn?.().children?.some((child) => child.id === id), ID));
// The card framed, and its surface up: asked again until it is, since the canvas's opening fit can land after the first.
const surfaceBox = () => frame.evaluate(() => {
	const surface = [...document.querySelectorAll(".card-surface")].find((one) => one.getBoundingClientRect().width > 100);
	const box = surface?.getBoundingClientRect();
	return box ? { x: box.x, y: box.y, w: box.width } : undefined;
});
const focused = [];
const host = await until(async () => {
	focused.push((await call("view.focus", [ID, { canvas: canvasName }], person)).value);
	await settle(page, 1500);
	return surfaceBox();
}, 20000);
say("the card is framed on screen", !!host, JSON.stringify(focused.slice(-2)));
if (!host) {
	await browser.close();
	process.exit(1);
}
const offset = await page.evaluate(() => {
	const box = document.querySelector("iframe.canvas-frame")?.getBoundingClientRect();
	return { x: box?.x ?? 0, y: box?.y ?? 0 };
});
const zoom = host ? host.w / 480 : 1;
// The field's middle: the doc's padding and the title above it (read off the card at zoom 1: x 32..352, y 81..109).
await page.mouse.click(offset.x + host.x + 192 * zoom, offset.y + host.y + 95 * zoom);
await settle(page, 300);
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type("WWWWWWWWWWWW");
await settle(page, 300);

const shot = await call("canvas.screenshot", [{ of: path, canvas: canvasName }], person);
say("the screenshot of the card is the browser's snapshot", shot.value?.how === "snapshot", JSON.stringify(shot).slice(0, 400));

// The picture, read back in the page: the canvas's middle, and whether the field's words changed from the file's.
const deck = await deckState();
const file = shot.value?.file ? join(deck.path, shot.value.file) : undefined;
const pixels = file
	? await page.evaluate(async ({ data, mime }) => {
			const bitmap = await createImageBitmap(await (await fetch(`data:${mime};base64,${data}`)).blob());
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const ctx = canvas.getContext("2d");
			ctx.drawImage(bitmap, 0, 0);
			const scale = bitmap.width / 480;
			const at = (x, y) => Array.from(ctx.getImageData(Math.round(x * scale), Math.round(y * scale), 1, 1).data);
			// Dark pixels inside the field, which is empty in the card's file.
			const field = ctx.getImageData(Math.round(40 * scale), Math.round(86 * scale), Math.round(300 * scale), Math.round(18 * scale)).data;
			let ink = 0;
			for (let i = 0; i < field.length; i += 4) if (field[i] + field[i + 1] + field[i + 2] < 300) ink++;
			return { canvas: at(132, 162), ink, width: bitmap.width };
		}, { data: readFileSync(file).toString("base64"), mime: file.endsWith(".png") ? "image/png" : "image/webp" })
	: undefined;
say("the script-drawn canvas is in the picture as the browser drew it (green)", !!pixels && pixels.canvas[1] > 200 && pixels.canvas[0] < 60, JSON.stringify(pixels));

say("what was typed into the card's field is in the picture (the file's field is empty)", !!pixels && pixels.ink > 200, JSON.stringify(pixels));

await call("canvas.delete", [ID, { canvas: canvasName }], person);
say("no page errors", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
process.exit(failed() ? 1 : 0);

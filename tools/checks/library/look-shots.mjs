/**
 * Pictures of the canvas and the kit around it, for comparing a change to the look before and after,
 * not for asserting on: the canvas at rest, a card selected with its pill and title, a note selected
 * with its pill and properties, the pen with its ink tray, the comment box, and an iPad's hold menu,
 * in light and dark. `LOOK_SHOTS=<dir>` names where they go. Run only when named.
 */
import { mkdirSync } from "node:fs";
import { API, asPerson, canvasFrame, card, focusCanvas, open, pressCardAction, resetStage, say, selectCard, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

await resetStage();
await call("canvas.insert", [{ type: "note", id: "look-note", content: "A note to select" }, { beside: card("plan") }]);

const shots = [];
for (const scheme of ["light", "dark"]) {
	const { browser, page, errors } = await open({ width: 1400, height: 900, scheme });
	const shot = async (name) => {
		await settle(page, 500);
		if (OUT) await page.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
		shots.push(`${scheme}-${name}`);
	};
	let canvas = await canvasFrame(page);
	await settle(page, 1500);
	await shot("01-rest");

	await selectCard(page, card("plan"));
	await shot("02-card-selected");

	await focusCanvas(page);
	await page.keyboard.press("Escape");
	const note = await canvas.evaluate(() => { const r = globalThis.__decksProbes?.penBox?.("look-note"); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
	if (note) {
		const frameBox = await (await canvas.frameElement()).boundingBox();
		await page.mouse.click(frameBox.x + note.x, frameBox.y + note.y);
		await shot("03-note-selected");
	}

	await page.keyboard.press("Escape");
	canvas = await canvasFrame(page);
	await canvas.locator('.v3-tool[data-tool="pen"]').first().click().catch(() => {});
	await shot("04-pen-tray");
	await page.keyboard.press("Escape");
	await canvas.locator('.v3-tool[data-tool="select"]').first().click().catch(() => {});

	await selectCard(page, card("plan"));
	await pressCardAction(page, "Comment").catch(() => {});
	await shot("05-comment-box");
	await page.keyboard.press("Escape");

	say(`${scheme}: no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
	await browser.close();
}

// An iPad: a finger held on the note opens its menu.
{
	const { browser, page } = await open({ device: "iPad Mini", scheme: "light" });
	const canvas = await canvasFrame(page);
	await settle(page, 1500);
	const note = await canvas.evaluate(() => { const r = globalThis.__decksProbes?.penBox?.("look-note"); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
	if (note) {
		const frameBox = await (await canvas.frameElement()).boundingBox();
		const cdp = await page.context().newCDPSession(page);
		const at = [{ x: frameBox.x + note.x, y: frameBox.y + note.y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at });
		await page.waitForTimeout(700);
		if (OUT) await page.screenshot({ path: `${OUT}/ipad-06-hold-menu.png` });
		shots.push("ipad-06-hold-menu");
		await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	}
	await browser.close();
}

say("the pictures are taken", shots.length >= 11, shots.join(" "));

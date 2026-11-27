/**
 * Presence: two windows on one canvas see each other's pointer and selection, and a window that closes
 * leaves at once.
 *
 * Each window's canvas frame says where it is down its line (`presence.set`: the pointer in canvas units
 * at most twenty times a second, the selection when it changes), and the harness says it to every other
 * line watching the canvas (`presence.changed`), never to the one who said it. The other frame draws the
 * pointer as a cursor with a name tag and the selection as a ring in the same colour, clear of the
 * item and under the window's own outline of it, which is always the one on top
 * (`frame/inside/presence.ts`, `frame.tsx`). Nothing of it is written anywhere.
 */
import { card, canvasFrame, open, resetStage, rest, say, selectCard } from "../harness.mjs";

await resetStage();
const a = await open({ width: 1200, height: 800 });
const b = await open({ width: 1200, height: 800 });
try {
	const frameA = await canvasFrame(a.page);
	const frameB = await canvasFrame(b.page);
	await rest(a.page);
	await rest(b.page);

	// A moves over its canvas; B sees a cursor for it, named as another window of the same person.
	const box = await frameA.locator(".canvas").boundingBox();
	for (let i = 0; i < 8; i += 1) {
		await a.page.mouse.move(box.x + box.width * (0.3 + i * 0.03), box.y + box.height * 0.5);
		await a.page.waitForTimeout(60);
	}
	const cursor = frameB.locator(".frame-cursors .agent-cursor");
	await cursor.first().waitFor({ timeout: 5000 }).catch(() => {});
	say("B sees A's pointer as a cursor", (await cursor.count()) === 1, `${await cursor.count()} cursors`);
	say("the cursor is named for another window", (await cursor.first().locator(".label").textContent().catch(() => "")) === "Another window");
	say("A sees no cursor of its own", (await frameA.locator(".frame-cursors .agent-cursor").count()) === 0);

	// A selects a card; B outlines it in A's colour.
	await selectCard(a.page, card("plan"));
	const outline = frameB.locator(".frame-presence-outline");
	await outline.first().waitFor({ timeout: 5000 }).catch(() => {});
	say("B outlines what A selected", (await outline.count()) === 1, `${await outline.count()} outlines`);
	const colours = await frameB.evaluate(() => {
		const c = document.querySelector(".frame-cursors .agent-cursor");
		const o = document.querySelector(".frame-presence-outline");
		return { cursor: c ? getComputedStyle(c).getPropertyValue("--cursor-color") || c.getAttribute("style") : "", outline: o ? getComputedStyle(o).borderTopColor : "" };
	});
	say("the outline has a colour", colours.outline !== "" && colours.outline !== "rgba(0, 0, 0, 0)", colours.outline);

	/*
	 * B selects the same card: its own outline is the one on top. A's is a ring that stands clear of the
	 * card, outside B's own (which hugs it), and it is drawn under what the stage paints over the drawing
	 * (B's outline, handles and guides), where it was drawn over them all, in A's colour.
	 */
	await selectCard(b.page, card("plan"));
	await b.page.mouse.move(8, 8);
	await b.page.waitForTimeout(500);
	const where = await frameB.evaluate((path) => {
		const ring = document.querySelector(".frame-presence-outline");
		const node = document.querySelector(`.card-node[data-path="${path}"]`);
		const canvas = document.querySelector("canvas.canvas-engine-over");
		const r = ring.getBoundingClientRect();
		const c = node.getBoundingClientRect();
		return {
			under: !!ring.closest(".world-host-under"),
			before: !!(ring.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING),
			clear: { left: c.left - r.left, top: c.top - r.top, right: r.right - c.right, bottom: r.bottom - c.bottom },
			width: parseFloat(getComputedStyle(ring).borderTopWidth),
			card: { x: c.x, y: c.y, w: c.width, h: c.height },
			own: document.querySelector(".world > .pen-selection") ? 1 : 0,
		};
	}, card("plan"));
	say("B's own selection is on the card too", where.own === 1);
	say("A's ring is in the layer under the stage's own outlines, before the engine's canvas", where.under && where.before, JSON.stringify({ under: where.under, before: where.before }));
	say("…and stands clear of the card on every side, outside B's own outline", Object.values(where.clear).every((gap) => gap >= 3 && gap <= 4.5), JSON.stringify(where.clear));
	// And on the screen: A's colour shows beside the card's edge, and not where B's own corner handle stands over the ring.
	const frameAt = await b.page.locator("iframe.canvas-frame").boundingBox();
	const shot = (await b.page.screenshot()).toString("base64");
	const ringColour = colours.outline.match(/\d+/g).slice(0, 3).map(Number);
	const left = Math.round(frameAt.x + where.card.x);
	const top = Math.round(frameAt.y + where.card.y);
	const seen = await b.page.evaluate(async ({ shot, spots, colour }) => {
		const image = new Image();
		image.src = `data:image/png;base64,${shot}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const ctx = canvas.getContext("2d");
		ctx.drawImage(image, 0, 0);
		const scale = image.width / innerWidth;
		// Whether A's colour is anywhere in a few pixels round a spot.
		const has = ([x, y]) => {
			const data = ctx.getImageData(Math.round((x - 1) * scale), Math.round((y - 1) * scale), Math.ceil(3 * scale), Math.ceil(3 * scale)).data;
			for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - colour[0]) + Math.abs(data[i + 1] - colour[1]) + Math.abs(data[i + 2] - colour[2]) < 90) return true;
			return false;
		};
		return Object.fromEntries(Object.entries(spots).map(([name, spot]) => [name, has(spot)]));
	}, { shot, colour: ringColour, spots: { edge: [left - 3, top + Math.round(where.card.h / 4)], handle: [left - 3, top] } });
	say("A's ring shows beside the card's edge", seen.edge === true, JSON.stringify(seen));
	say("…and B's own corner handle is over it where they meet", seen.handle === false, JSON.stringify(seen));
	if (process.env.PRESENCE_SHOT) await b.page.screenshot({ path: process.env.PRESENCE_SHOT });

	// A closes; B's cursor and outline go.
	await a.browser.close();
	await frameB.locator(".frame-cursors .agent-cursor").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
	say("A gone, B shows no cursor for it", (await frameB.locator(".frame-cursors .agent-cursor").count()) === 0);
	say("A gone, B shows no outline for it", (await frameB.locator(".frame-presence-outline").count()) === 0);
	say("no errors on either page", a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(" | "));
} finally {
	await a.browser.close().catch(() => {});
	await b.browser.close();
}

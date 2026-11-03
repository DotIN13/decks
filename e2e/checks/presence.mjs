/**
 * Presence: two windows on one canvas see each other's pointer and selection, and a window that closes
 * leaves at once.
 *
 * Each window's canvas frame says where it is down its line (`presence.set`: the pointer in canvas units
 * at most twenty times a second, the selection when it changes), and the harness says it to every other
 * line watching the canvas (`presence.changed`), never to the one who said it. The other frame draws the
 * pointer as a cursor with a name tag and the selection as an outline in the same colour
 * (`frame/inside/presence.ts`, `frame.tsx`); where another person is looking is a dashed box, but not
 * for the same person's other window. Nothing of it is written anywhere.
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
	const box = await frameA.locator(".stage").boundingBox();
	for (let i = 0; i < 8; i += 1) {
		await a.page.mouse.move(box.x + box.width * (0.3 + i * 0.03), box.y + box.height * 0.5);
		await a.page.waitForTimeout(60);
	}
	const cursor = frameB.locator(".frame-cursors .agent-cursor");
	await cursor.first().waitFor({ timeout: 5000 }).catch(() => {});
	say("B sees A's pointer as a cursor", (await cursor.count()) === 1, `${await cursor.count()} cursors`);
	say("the cursor is named for another window", (await cursor.first().locator(".label").textContent().catch(() => "")) === "Another window");
	say("A sees no cursor of its own", (await frameA.locator(".frame-cursors .agent-cursor").count()) === 0);
	// Where A is looking is said too (its camera, with its size), but A is the same person in another window: no viewport box over B's canvas, which would sit on the agents' cursors' layer.
	await b.page.waitForTimeout(800);
	say("B draws no viewport box for the same person's other window", (await frameB.locator(".frame-presence-viewport").count()) === 0, `${await frameB.locator(".frame-presence-viewport").count()} boxes`);

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

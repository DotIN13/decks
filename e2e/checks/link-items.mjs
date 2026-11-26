/**
 * A link can point at any item on a canvas, drawn or a card, and says how it opens (`@decks/pen`,
 * `#item/<canvas>/<id>`, `?open=`). Followed on the canvas, the view flies to the item, on its own
 * canvas when that is another (`apps/web/src/tabs/open.ts`, `flyToItem`), and no tab is made for an
 * item on the canvas already in front. The person asked for links that tie to-dos and work in progress
 * to the topics they are about.
 */
import { API, CANVAS, asPerson, canvasFrame, open, resetStage, rest, say, settle } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 120));
	}
};

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const second = (await call("canvas.create", ["Far canvas"])).value?.name;

// A note far from everything on this canvas, one on another canvas, and chips to both near the opening view.
await call("canvas.insert", [{ type: "note", id: "far-note", content: "Far away" }, { canvas: CANVAS, at: { x1: 30000, y1: 20000 } }]);
await call("canvas.insert", [{ type: "note", id: "there-note", content: "On the other canvas" }, { canvas: second, at: { x1: -9000, y1: 7000 } }]);
const here = (await call("canvas.insert", [{ type: "link", id: "to-far", to: "far-note" }, { canvas: CANVAS, at: { x1: 0, y1: -300 } }])).value;
const there = (await call("canvas.insert", [{ type: "link", id: "to-there", to: `#item/${encodeURIComponent(second)}/there-note` }, { canvas: CANVAS, at: { x1: 400, y1: -300 } }])).value;
say("links to items read back as items' addresses, opening on the canvas", here?.to === `#item/${encodeURIComponent(CANVAS)}/far-note` && here.open === "canvas" && there?.title === "On the other canvas", JSON.stringify([here, there]).slice(0, 300));

const { browser, page, errors } = await open({ width: 1800, height: 900, scheme: "light" });
await rest(page, { start: 0 });
await page.locator('.panel-shell [aria-label="Hide the side panel"]').first().click();
await settle(page, 500);
const row = () => page.locator(".v3-topbar .tab-chip[data-tab]").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
const camera = async () => (await canvasFrame(page)).evaluate(() => ({ ...globalThis.__decksProbes.rust.camera }));
const cameraName = async () => (await page.locator('.v3-topbar .tab-chip[data-camera="true"]').innerText()).trim();
/** Bring the chips into view, as the agent on screen shows them. */
const show = async (ids) => {
	for (let tries = 0; tries < 4; tries++) {
		await call("view.focus", [ids, { canvas: CANVAS }]);
		const go = (await canvasFrame(page)).locator("button", { hasText: /^Go$/ }).first();
		if (await until(() => go.isVisible(), 1200)) await go.click();
		const box = await until(async () => (await canvasFrame(page)).evaluate((one) => globalThis.__decksProbes?.penBox?.(one)?.toJSON(), ids[0]), 2500);
		if (box && box.y > 70 && box.x > 80) break;
	}
	await settle(page, 600);
};
const press = async (id) => {
	const box = await until(async () => (await canvasFrame(page)).evaluate((one) => globalThis.__decksProbes?.penBox?.(one)?.toJSON(), id));
	if (!box) return false;
	await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
	return true;
};
const inside = (cam, box) => cam.x > box.x1 && cam.x < box.x2 && cam.y > box.y1 && cam.y < box.y2;

await show(["to-far", "to-there"]);
const farBox = (await call("canvas.read", [{ canvas: CANVAS, of: "far-note", depth: 0 }])).value?.items?.[0]?.box;
const rowBefore = JSON.stringify(await row());
await press("to-far");
const flown = await until(async () => (inside(await camera(), farBox) ? true : undefined), 5000);
say("a press on a link to a drawn item flies the view to it, and makes no tab", !!flown && JSON.stringify(await row()) === rowBefore, `${JSON.stringify({ cam: await camera(), farBox })} ${JSON.stringify(await row())}`);

await show(["to-far", "to-there"]);
const thereBox = (await call("canvas.read", [{ canvas: second, of: "there-note", depth: 0 }])).value?.items?.[0]?.box;
await press("to-there");
const moved = await until(async () => ((await cameraName()) === "Far canvas" ? true : undefined), 6000);
const landed = await until(async () => (inside(await camera(), thereBox) ? true : undefined), 6000);
say("a link to an item on another canvas opens that canvas and flies to the item", !!moved && !!landed, `${await cameraName()} ${JSON.stringify({ cam: await camera().catch(() => null), thereBox })}`);
say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();

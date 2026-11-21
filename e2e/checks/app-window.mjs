/**
 * An app's window on a canvas can be closed, deleted, collapsed and opened: by its pill, and by the
 * three lights on its bar.
 *
 * - the pill's ✕ takes the window off the canvas, and the app stays in the deck;
 * - the pill has Reload and no Delete: an app is deleted in the Apps tab, and nowhere on the canvas;
 * - the red light closes it, as ✕ does;
 * - the yellow light collapses it: the window goes and a link to the app stands where its corner was;
 * - the green light opens the app in a tab;
 * - a press on a light never selects or drags the window, and the bar between and beside them still does.
 */
import { API, asPerson, canvasFrame, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await Promise.resolve(test()).catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const view = { width: 1500, height: 1000 };
const { browser, page, errors } = await open(view);
await resetStage(page);
await settle(page, 900);
const link = await socket();
const agentId = await until(async () => link.last("agent.list")?.focused);
const stageName = await until(async () => link.last("canvas.list")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);

const made = await call("apps.create", ["e2e-window", { title: "E2E window", starter: "static" }]);
say("an app is made", made.ok, JSON.stringify(made.error ?? ""));
const items = async () => (await call("canvas.read", [{ canvas: stageName, depth: 0 }])).value?.items ?? [];
const windows = async () => (await items()).filter((one) => one.metadata?.type === "decks.app" && one.metadata.name === "e2e-window");
const inDeck = async () => ((await call("apps.list", [])).value ?? []).some((one) => one.name === "e2e-window");

/** The stage's own answer to where the window is on screen: it is a placed item, as a card is. */
const boxOf = async (id) => (await canvasFrame(page)).evaluate((path) => globalThis.__decksProbes?.cards?.().find((one) => one.path === path)?.rect.toJSON(), `item:${id}`);
/**
 * Place the app's window where nothing else is and look at it at 60%, right of the side panel and
 * under the top bar with room for its pill: an agent's focus would fit it to the whole window, under both.
 */
const place = async () => {
	const placed = (await call("canvas.insert", [made.value?.item, { canvas: stageName, at: { x1: 4000, y1: 4000 } }])).value;
	const id = placed?.id;
	const person = await asPerson();
	const seen = async () => {
		const box = await boxOf(id);
		return box && Math.abs(box.width - 660) < 2 && box.x > 380 && box.y > 150 && box.x + box.width < view.width - 20 ? box : undefined;
	};
	// Its slot first: the view may be where it should be already, and asking again while hands are on the canvas only offers a Go.
	await until(() => boxOf(id), 5000);
	for (let tries = 0; tries < 4 && !(await seen()); tries++) {
		await fetch(`${API}/api/v1/view.move`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args: [{ x: 4550 - 300, y: 4380 - 60, zoom: 0.6 }] }) });
		await until(seen, 3000);
	}
	await settle(page, 700);
	const box = await seen();
	if (!box) say("placed, and seen", false, JSON.stringify(await boxOf(id)) + JSON.stringify(placed));
	return { id, box };
};
/** Select the window by a press on its body, and wait for its pill. */
const select = async (box) => {
	await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
	const canvas = await canvasFrame(page);
	await until(() => canvas.locator(".stage-fixed > .card-callout:not([data-hidden])").count());
	await settle(page, 300);
	return canvas;
};
const gone = (id) => until(async () => !(await items()).some((one) => one.id === id), 5000);
const shot = async (name) => process.env.LOOK_SHOTS && (await page.screenshot({ path: `${process.env.LOOK_SHOTS}/${name}.png` }));

// --- the pill's ✕ ------------------------------------------------------------------------------------------------------
{
	const { id, box } = await place();
	say("the app's window is on the canvas and on screen", !!id && !!box, JSON.stringify(box));
	const canvas = await select(box);
	await shot("app-pill");
	const labels = await canvas.locator(".stage-fixed > .card-callout:not([data-hidden]) [aria-label]").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
	say("its pill is Fit, New tab, Reload, Comment, ✕ and ⋯", JSON.stringify(labels) === '["Fit","New tab","Reload","Comment","Hide","More"]', JSON.stringify(labels));
	await canvas.locator('.stage-fixed > .card-callout:not([data-hidden]) [aria-label="Hide"]').click();
	say("the pill's ✕ takes the window off the canvas", (await gone(id)) === true, JSON.stringify((await windows()).map((one) => one.id)));
	say("…and the app stays in the deck", await inDeck());
}

// --- no Delete on an app's pill -----------------------------------------------------------------------------------------
{
	const { id, box } = await place();
	const canvas = await select(box);
	await canvas.locator('.stage-fixed > .card-callout:not([data-hidden]) [aria-label="More"]').click();
	await settle(page, 400);
	await shot("app-pill-more");
	const menu = await canvas.locator(".callout-more [role=menuitem]").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));
	say("⋯ has Copy path alone: no Delete, and no export of a running app", JSON.stringify(menu) === '["Copy path"]', JSON.stringify(menu));
	await page.keyboard.press("Escape");
	await canvas.locator('.stage-fixed > .card-callout:not([data-hidden]) [aria-label="Hide"]').click();
	await gone(id);
}

// --- a document's ✕: the same rule, an item with no file path of its own ---------------------------------------------------
{
	const placed = (await call("canvas.insert", [{ type: "document", path: `canvases/${stageName}/files/window-notes.md` }, { canvas: stageName, at: { x1: 4000, y1: 4000 } }])).value;
	const box = await until(async () => {
		const at = await boxOf(placed?.id);
		return at && at.x > 380 && at.y > 150 ? at : undefined;
	});
	say("a document is placed and on screen", !!placed?.id && !!box, JSON.stringify(box ?? placed));
	if (box) {
		// Its title above it selects it; a press inside is the editor's.
		await page.mouse.click(box.x + 30, box.y - 9);
		const canvas = await canvasFrame(page);
		await until(() => canvas.locator(".stage-fixed > .card-callout:not([data-hidden])").count());
		await settle(page, 300);
		await canvas.locator('.stage-fixed > .card-callout:not([data-hidden]) [aria-label="Hide"]').click();
		say("a document's ✕ takes it off the canvas too", (await gone(placed.id)) === true);
	}
}

// --- the three lights ----------------------------------------------------------------------------------------------------
const row = () => page.locator(".v3-topbar .tab-chip[data-tab]").evaluateAll((all) => all.map((one) => `${one.dataset.kind}${one.dataset.front ? "*" : ""}`));
const toCanvas = async () => {
	await page.locator('.v3-topbar .tab-chip[data-camera="true"] .tab-chip-name').click();
	await until(async () => ((await page.locator('.surface[data-surface="stage"]').isVisible()) ? true : undefined));
	await settle(page, 400);
};
/** A light's button, once the pointer is on the window's bar: a window nobody points at has no slot on the page. */
const light = async (box, kind) => {
	await page.mouse.move(box.x + box.width / 2, box.y + 13);
	const canvas = await canvasFrame(page);
	const button = canvas.locator(`.card-node[data-path^="item:"] .app-light[data-light="${kind}"]`);
	await until(() => button.count());
	return button;
};
const pills = async () => (await canvasFrame(page)).locator(".stage-fixed > .card-callout:not([data-hidden])").count();
{
	const { id, box } = await place();
	const zoom = box.width / 1100;
	const at = [];
	for (const kind of ["close", "collapse", "open"]) at.push(await (await light(box, kind)).boundingBox());
	// As the engine paints them: 12 across, 20 apart, the first 14 from the left, in the middle of a bar 44 tall.
	const off = at.map((one, i) => (one ? Math.hypot(one.x + one.width / 2 - (box.x + (20 + 20 * i) * zoom), one.y + one.height / 2 - (box.y + 22 * zoom)) : 99));
	say("each light's button is centred on its painted light, to a pixel", off.every((one) => one < 1), JSON.stringify(off.map((one) => +one.toFixed(2))));
	await page.mouse.move(at[1].x + at[1].width / 2, at[1].y + at[1].height / 2);
	await settle(page, 200);
	const marks = await (await canvasFrame(page)).locator(".app-light > svg").evaluateAll((all) => all.map((one) => getComputedStyle(one).opacity));
	say("with the pointer on the lights each shows its mark", marks.length === 3 && marks.every((one) => one === "1"), JSON.stringify(marks));
	await shot("app-lights-hover");

	// Green, with ⌘: the browser's tab, and the window neither selected nor moved.
	const popup = page.context().waitForEvent("page", { timeout: 6000 }).catch(() => undefined);
	await (await light(box, "open")).click({ modifiers: ["Meta"] });
	const opened = await popup;
	say("the green light with ⌘ held opens the app in the browser's tab", !!opened && opened.url().endsWith("#app/e2e-window"), String(opened?.url()));
	await opened?.close().catch(() => {});
	await settle(page, 300);
	const still = await boxOf(id);
	say("a press on a light neither selects the window nor moves it", (await pills()) === 0 && Math.abs(still.x - box.x) < 1 && Math.abs(still.y - box.y) < 1, JSON.stringify({ pills: await pills(), still }));

	// Green: the app in a tab of the window's own, in front.
	await (await light(box, "open")).click();
	const front = await until(async () => ((await row()).includes("app*") ? row() : undefined));
	say("the green light opens the app in a tab, in front", JSON.stringify(front) === '["canvas","app*"]' && (await page.evaluate(() => location.hash)) === "#app/e2e-window", JSON.stringify(front ?? (await row())));
	await shot("app-light-green-tab");
	await toCanvas();

	// The bar beside the lights still drags the window.
	const grip = { x: box.x + box.width * 0.75, y: box.y + 13 };
	await page.mouse.move(grip.x, grip.y);
	await page.mouse.down();
	await page.mouse.move(grip.x + 30, grip.y + 20, { steps: 5 });
	await page.mouse.move(grip.x + 60, grip.y + 40, { steps: 5 });
	await page.mouse.up();
	const dragged = await until(async () => {
		const now = await boxOf(id);
		return now && Math.abs(now.x - box.x - 60) < 3 && Math.abs(now.y - box.y - 40) < 3 ? now : undefined;
	}, 4000);
	say("the bar beside the lights still drags the window", !!dragged, JSON.stringify(await boxOf(id)));
	await page.keyboard.press("Escape");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height + 60);
	await settle(page, 400);

	// Yellow: the window gone, a link to the app where its corner is.
	const now = (await boxOf(id)) ?? box;
	const before = (await items()).find((one) => one.id === id)?.box;
	await (await light(now, "collapse")).click();
	say("the yellow light takes the window off the canvas", (await gone(id)) === true);
	const chip = await until(async () => (await items()).find((one) => one.type === "link" && one.to === "#app/e2e-window"));
	say("…and leaves a link to the app where the window's corner was, named as the window", !!chip && chip.title === "E2E window" && chip.box.x1 === before?.x1 && chip.box.y1 === before?.y1, JSON.stringify({ chip, before }));
	await settle(page, 500);
	await shot("app-light-yellow-chip");
	const chipAt = await (await canvasFrame(page)).evaluate((one) => globalThis.__decksProbes?.penBox?.(one)?.toJSON(), chip?.id);
	await page.mouse.click(chipAt.x + chipAt.width * 0.4, chipAt.y + chipAt.height / 2);
	say("a press on that link opens the app's tab again", !!(await until(async () => ((await row()).includes("app*") ? true : undefined))), JSON.stringify(await row()));
	await toCanvas();
	say("…and the app stays in the deck", await inDeck());
}
{
	// Red: closed, as the pill's ✕ closes it.
	const { id, box } = await place();
	await (await light(box, "close")).click();
	say("the red light takes the window off the canvas", (await gone(id)) === true);
	say("…leaves no link behind, and the app stays in the deck", (await inDeck()) && (await items()).filter((one) => one.type === "link").length === 1, JSON.stringify((await items()).map((one) => one.type)));
}

// For a person's eyes (LOOK_SHOTS): the lights close up, at rest and with the pointer on them.
if (process.env.LOOK_SHOTS) {
	const { id } = await place();
	const person = await asPerson();
	const near = async () => {
		const box = await boxOf(id);
		return box && Math.abs(box.width - 3300) < 4 ? box : undefined;
	};
	for (let tries = 0; tries < 4 && !(await near()); tries++) {
		await fetch(`${API}/api/v1/view.move`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args: [{ x: 4000 + 60, y: 4000 + 60, zoom: 3 }] }) });
		const go = (await canvasFrame(page)).locator("button", { hasText: /^Go$/ }).first();
		if (await until(() => go.isVisible(), 1200)) await go.click();
		await until(near, 3000);
	}
	await settle(page, 800);
	const box = await near();
	if (box) {
		const clip = { x: box.x - 30, y: box.y - 30, width: 520, height: 220 };
		await page.mouse.move(box.x + 400, box.y + 400);
		await settle(page, 300);
		await page.screenshot({ path: `${process.env.LOOK_SHOTS}/app-lights-close-rest.png`, clip });
		await page.mouse.move(box.x + 60, box.y + 66);
		await settle(page, 300);
		await page.screenshot({ path: `${process.env.LOOK_SHOTS}/app-lights-close-hover.png`, clip });
		// …and what the yellow light leaves, as close.
		await (await canvasFrame(page)).locator('.app-light[data-light="collapse"]').click();
		await gone(id);
		await page.mouse.move(box.x + 400, box.y + 400);
		await settle(page, 700);
		await page.screenshot({ path: `${process.env.LOOK_SHOTS}/app-collapsed-close.png`, clip: { ...clip, width: 620 } });
	}
}

say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();

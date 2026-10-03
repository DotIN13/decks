/**
 * Shapes from the library, the properties panel, and arrows that keep to a side.
 *
 * A shape is picked in the insert panel and put on the canvas with a click; it is a frame marked
 * `decks.shape` whose outline follows its size (`@decks/pen`, `shapes.ts`). The properties panel
 * swaps its kind, gives it words and sizes it, and stays one column wide however much it shows. An
 * arrow drawn from a selected shape's side keeps to that side in the file.
 *
 * Icons are left out: their names come from a CDN, and a check should not depend on the network.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deckState, editMode, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const deck = await deckState();
const { browser, page, errors } = await open({ width: 1600, height: 1000 });
await settle(page, 1500);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);

// The stage's file, found from the frame the server sends after the first edit.
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: "shapes-anchor", content: "x" }, box: { x1: -4000, y1: -4000 } }] });
const frame = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId && m.doc.children.some((n) => n.id === "shapes-anchor")).at(-1));
const file = frame ? join(deck.path, "stages", frame.stage, "stage.pen") : "";
const onDisk = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { children: [] });
const shapesNow = () => onDisk().children.filter((n) => n.metadata?.type === "decks.shape");
say("the stage has a file to draw in", existsSync(file), file);

await editMode(page, true);
const spots = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	const found = [];
	for (let y = 160; y < 820 && found.length < 2; y += 40) {
		for (let x = 360; x < 1200 && found.length < 2; x += 40) {
			if (![0, 200].every((dx) => [0, 140].every((dy) => empty(x + dx, y + dy)))) continue;
			if (found.some((one) => Math.abs(one.x - x) < 260 && Math.abs(one.y - y) < 260)) continue;
			found.push({ x, y });
		}
	}
	return found;
});
say("the canvas has room for two shapes", spots.length === 2, JSON.stringify(spots));

// --- a shape from the library -----------------------------------------------------------------------
await page.locator('.pen-tools [data-tool="shape"]').click();
say("the shapes button opens the insert panel on its shapes", await page.locator(".insert-panel .insert-cell[data-shape]").count() >= 30);
await page.locator('.insert-panel .insert-cell[data-shape="Decision"]').click();
const armed = await page.evaluate(() => document.querySelector(".stage")?.dataset.penTool);
say("a pick arms the shape tool and closes the panel", armed === "shape" && (await page.locator(".insert-panel").count()) === 0, armed);
const had = new Set(shapesNow().map((n) => n.id));
await page.mouse.click(spots[0].x, spots[0].y);
const made = await until(() => shapesNow().find((n) => !had.has(n.id)));
say("a click puts a Decision in the file, as a shape frame", made?.metadata?.kind === "Decision" && made.type === "frame", JSON.stringify(made?.metadata));
const outline = made?.children?.find((n) => n.type === "path");
say("…whose outline is its size, in a 100 by 100 box", outline?.width === made?.width && outline?.height === made?.height && JSON.stringify(outline?.viewBox) === "[0,0,100,100]", JSON.stringify({ frame: [made?.width, made?.height], outline: [outline?.width, outline?.height] }));

// --- the properties panel ----------------------------------------------------------------------------
await until(() => page.locator(".props-panel").count());
say("the properties panel shows the selection", (await page.locator(".props-panel .props-title").inputValue().catch(() => "")) === "Decision");
const across = await page.evaluate(() => {
	const body = document.querySelector(".props-panel .props-body");
	for (const details of body.querySelectorAll("details")) details.open = true;
	return { scroll: body.scrollWidth, client: body.clientWidth, panel: document.querySelector(".props-panel").getBoundingClientRect().width };
});
say("…276 px wide, and it never scrolls sideways", across.panel === 276 && across.scroll <= across.client, JSON.stringify(across));
await page.locator('.props-panel select[aria-label="Kind of shape"]').selectOption("Terminator");
const swapped = await until(() => {
	const now = onDisk().children.find((n) => n.id === made?.id);
	return now?.metadata?.kind === "Terminator" && now.children.find((n) => n.type === "path")?.geometry.includes("A22") ? now : undefined;
});
say("its kind swaps the outline and keeps the shape", !!swapped, JSON.stringify(onDisk().children.find((n) => n.id === made?.id)?.metadata));
const words = page.locator('.props-panel input[placeholder="Double-click the shape, or type here"]');
await words.fill("Start");
await words.press("Tab");
const labelled = await until(() => onDisk().children.find((n) => n.id === made?.id)?.children?.find((n) => n.type === "text" && n.content === "Start"));
say("words typed in the panel go inside the shape", !!labelled);
const width = page.locator('.props-panel [data-field="w"] input');
await width.fill("220");
await width.press("Enter");
const sized = await until(() => {
	const now = onDisk().children.find((n) => n.id === made?.id);
	return now?.width === 220 && now.children.find((n) => n.type === "path")?.width === 220 ? now : undefined;
});
say("a width typed in the panel sizes the shape, and its outline follows", !!sized, JSON.stringify((({ children, ...rest }) => ({ ...rest, kids: children?.map((c) => [c.type, c.width, c.height]) }))(onDisk().children.find((n) => n.id === made?.id) ?? {})));
const wField = page.locator('.props-panel [data-field="w"] input');
await wField.hover();
for (let i = 0; i < 3; i++) {
	await page.mouse.wheel(0, -100);
	await page.waitForTimeout(40);
}
const wheeled = await until(() => onDisk().children.find((n) => n.id === made?.id)?.width === 223);
say("the wheel over a number steps it, one a turn, and sends it once", !!wheeled, String(onDisk().children.find((n) => n.id === made?.id)?.width));
await page.locator('.props-panel [aria-label="Pick any fill colour"]').click();
const sv = await until(() => page.locator(".color-picker .color-sv").boundingBox());
say("a colour field's swatch opens a colour picker", !!sv);
if (sv) {
	await page.mouse.move(sv.x + sv.width * 0.2, sv.y + sv.height * 0.2);
	await page.mouse.down();
	await page.mouse.move(sv.x + sv.width * 0.8, sv.y + sv.height * 0.1, { steps: 8 });
	await page.mouse.up();
	const picked = await until(() => {
		const fill = onDisk().children.find((n) => n.id === made?.id)?.children?.find((n) => n.type === "path")?.fill;
		return typeof fill === "string" && fill !== "#ffffff" ? fill : undefined;
	});
	say("…and a drag in it sets the fill once, when it is let go", !!picked, String(picked));
	await page.keyboard.press("Escape");
	say("Escape closes the picker and keeps the selection", (await page.locator(".color-picker").count()) === 0 && (await page.locator(".props-panel").count()) === 1);
}

// --- an arrow from a side ----------------------------------------------------------------------------
await page.keyboard.press("Escape");
await page.locator('.pen-tools [data-tool="shape"]').click();
await page.locator('.insert-panel .insert-cell[data-shape="Process"]').click();
const had2 = new Set(shapesNow().map((n) => n.id));
await page.mouse.click(spots[1].x, spots[1].y);
const second = await until(() => shapesNow().find((n) => !had2.has(n.id)));
say("a second shape, a Process", second?.metadata?.kind === "Process");
// Select the first again, and draw from its bottom side to the second, once the page has drawn it.
await until(() => page.locator(`.pen-hit[data-id="${second?.children?.[0]?.id}"]`).count());
// A shape is clicked on its outline, which has the click shape (`pen/layer.ts`).
const first = await page.evaluate((id) => {
	const el = document.querySelector(`.pen-hit[data-id="${id}"]`);
	const r = el?.getBoundingClientRect();
	return r ? { x: r.x + r.width / 2, y: r.y + r.height / 3 } : undefined;
}, made?.children?.find((n) => n.type === "path")?.id);
const target = await page.evaluate((id) => {
	const el = document.querySelector(`.pen-hit[data-id="${id}"]`);
	const r = el?.getBoundingClientRect();
	return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : undefined;
}, second?.children?.find((n) => n.type === "path")?.id);
if (first && target) {
	await page.mouse.click(first.x, first.y);
	const dot = await until(() => page.locator('.pen-anchor[data-side="bottom"]').boundingBox());
	say("a selected shape shows the four places an arrow can leave from", (await page.locator(".pen-anchor").count()) === 4);
	if (dot) {
		await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
		await page.mouse.down();
		await page.mouse.move((dot.x + target.x) / 2, (dot.y + target.y) / 2, { steps: 6 });
		await page.mouse.move(target.x, target.y, { steps: 6 });
		await page.mouse.up();
		const arrow = await until(() => onDisk().children.find((n) => n.metadata?.type === "decks.arrow" && n.metadata.from?.item === made?.id));
		say("an arrow drawn from a side keeps to it in the file", arrow?.metadata.from?.side === "bottom" && (arrow?.metadata.to === second?.id || arrow?.metadata.to?.item === second?.id), JSON.stringify(arrow?.metadata));
		if (arrow) {
			await page.locator('.props-panel input[placeholder="On the middle of the line"]').fill("yes");
			await page.keyboard.press("Tab");
			const worded = await until(() => onDisk().children.find((n) => n.id === arrow.id)?.metadata.label === "yes");
			say("words on an arrow are its label", !!worded);
		}
	}
} else say("both shapes are on screen", false, JSON.stringify({ first, target, ids: [made?.id, second?.id], hits: await page.evaluate(() => [...document.querySelectorAll(".pen-hit")].map((el) => el.dataset.id)) }));

say("no errors in the page", errors.length === 0, errors.join(" | "));
link.send({ type: "stage.pen.edit", agentId, ops: onDisk().children.filter((n) => n.metadata?.type === "decks.shape" || n.metadata?.type === "decks.arrow" || n.id === "shapes-anchor").map((n) => ({ op: "delete", id: n.id })) });
await settle(page, 400);
link.close?.();
await browser.close();

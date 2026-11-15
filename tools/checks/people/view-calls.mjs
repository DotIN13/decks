/**
 * The redesign's view calls, in a real browser: they move or reload what the person sees, and
 * write no file.
 *
 * - `view.reload({ card })` is counted over every open page: this page shows the card, so one
 *   page reloads; named with a canvas this page is not showing, none does.
 * - `view.goto(canvas)` moves the conversation on screen to the canvas, as the canvas switcher
 *   does, and the screen with it: the same conversation stays on screen, whoever else is on it.
 * - `view.focus(card)` with no canvas goes to the canvas the card's path names, and frames it;
 *   `view.focus(item, { canvas })` goes to that canvas first.
 * - None of them changed a canvas file. (Whether an agent's own call asks a person using the
 *   canvas, or moves quietly in the background, is `camera/stage-ops.test.ts`.)
 */
import { API, asPerson, open, resetStage, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 950 });
await resetStage(page);
await settle(page, 600);

const call = async (verb, args = [], headers = {}) => {
	const response = await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
	return response.json();
};
// The person's token; the agent on screen is a parameter of the person's calls, not who is calling.
const person = await asPerson();
const me = (await call("agent.me", [], person)).value;
const agent = { ...person, "x-decks-agent": me.id };
const home = (await call("here", [], agent)).value;
const read = await call("canvas.read", [], agent);
const card = read.value.items.find((item) => item.type === "card")?.card;
say("the agent on screen has a home canvas with cards on it", Boolean(home?.name && card), `${home?.name} ${card}`);
const before = JSON.stringify((await call("canvas.read", [], agent)).value.items);

const reloaded = await call("view.reload", [{ card }], agent);
say("view.reload reloads the card on the page showing it, and counts it", reloaded.ok && reloaded.value.reloaded === 1, JSON.stringify(reloaded));

const other = (await call("canvas.create", ["Elsewhere for views"], agent)).value;
const none = await call("view.reload", [{ card, canvas: other.name }], agent);
say("named with a canvas no page shows, no page reloads", none.ok && none.value.reloaded === 0, JSON.stringify(none));

const already = await call("view.goto", [home.name], agent);
say("view.goto the canvas on screen says it is there", already.ok && already.value.moved === true, JSON.stringify(already));
const focusedBefore = await page.evaluate(() => document.querySelector(".v3-agent-name")?.textContent ?? "");
const went = await call("view.goto", [other.name], agent);
const there = (await call("here", [], agent)).value;
say("view.goto another canvas moves the conversation there, and the screen with it", went.ok && went.value.moved === true && there?.name === other.name, JSON.stringify({ went, there: there?.name }));
await settle(page, 1200);
const screenAfter = await page.evaluate(() => document.querySelector(".v3-agent-name")?.textContent ?? "");
say("the same conversation is still the one on screen", screenAfter === focusedBefore, `${focusedBefore} → ${screenAfter}`);

// The screen is the person's for a few seconds after they last touched it (the harness's own setup counts).
await settle(page, 6500);
const focused = await call("view.focus", [card], agent);
const back = (await call("here", [], agent)).value;
say("view.focus a card with no canvas goes to the canvas its path names and frames it", focused.ok && !focused.value.deferred && back?.name === home.name, JSON.stringify({ focused, here: back?.name }));
await call("canvas.insert", [{ type: "note", id: "far-note", content: "over here" }, { canvas: other.name, at: { x1: 0, y1: 0 } }], agent);
await settle(page, 6500);
const elsewhere = await call("view.focus", ["far-note", { canvas: other.name }], agent);
const after = (await call("here", [], agent)).value;
say("view.focus on another canvas goes there first, then frames the item", elsewhere.ok && !elsewhere.value.deferred && after?.name === other.name, JSON.stringify({ elsewhere, here: after?.name }));
await call("view.goto", [home.name], agent);

const camera = await call("view.camera", [], agent);
say("view.camera reads x, y and zoom", camera.ok && ["x", "y", "zoom"].every((key) => typeof camera.value[key] === "number"), JSON.stringify(camera.value));

await settle(page, 400);
say("no view call changed the home canvas", JSON.stringify((await call("canvas.read", [{ canvas: home.name }], agent)).value.items) === before);
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

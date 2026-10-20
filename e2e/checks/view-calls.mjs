/**
 * The redesign's view calls, in a real browser: they move or reload what the person sees, and
 * write no file.
 *
 * - `view.reload({ board })` is counted over every open page: this page shows the board, so one
 *   page reloads; named with a canvas this page is not showing, none does.
 * - `view.goto(canvas)` shows a canvas by opening a conversation on it; with nobody on that
 *   canvas it says it could not, and on the canvas already it says so.
 * - `view.focus(board, { canvas })` on the canvas on screen moves the view, and on another
 *   canvas says the screen shows another one.
 * - None of them changed the canvas file.
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
const board = read.value.items.find((item) => item.type === "board")?.board;
say("the agent on screen has a home canvas with boards on it", Boolean(home?.name && board), `${home?.name} ${board}`);
const before = JSON.stringify((await call("canvas.read", [], agent)).value.items);

const reloaded = await call("view.reload", [{ board }], agent);
say("view.reload reloads the board on the page showing it, and counts it", reloaded.ok && reloaded.value.reloaded === 1, JSON.stringify(reloaded));

const other = (await call("canvas.create", ["Elsewhere for views"], agent)).value;
const none = await call("view.reload", [{ board, canvas: other.name }], agent);
say("named with a canvas no page shows, no page reloads", none.ok && none.value.reloaded === 0, JSON.stringify(none));

const already = await call("view.goto", [home.name], agent);
say("view.goto the canvas on screen says it is there already", already.ok && already.value.moved === true, JSON.stringify(already));
const nobody = await call("view.goto", [other.name], agent);
say("view.goto a canvas nobody is on says it could not show it", nobody.ok && nobody.value.moved === false && /no conversation is on that canvas/.test(nobody.value.note ?? ""), JSON.stringify(nobody));

// The screen is the person's for a few seconds after they last touched it (the harness's own setup counts).
await settle(page, 6500);
const focused = await call("view.focus", [board], agent);
say("view.focus on the canvas on screen moves the view", focused.ok && !focused.value.deferred, JSON.stringify(focused));
await call("canvas.insert", [{ type: "note", id: "far-note", content: "over here" }, { canvas: other.name, at: { x1: 0, y1: 0 } }], agent);
const elsewhere = await call("view.focus", ["far-note", { canvas: other.name }], agent);
say("view.focus on another canvas says the screen shows a different one", elsewhere.ok && /another canvas/.test(elsewhere.value.deferred ?? ""), JSON.stringify(elsewhere));

const camera = await call("view.camera", [], agent);
say("view.camera reads x, y and zoom", camera.ok && ["x", "y", "zoom"].every((key) => typeof camera.value[key] === "number"), JSON.stringify(camera.value));

await settle(page, 400);
say("no view call changed the home canvas", JSON.stringify((await call("canvas.read", [], agent)).value.items) === before);
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

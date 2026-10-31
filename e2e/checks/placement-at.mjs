/**
 * An agent says where a card goes: `canvas.insert` and `canvas.move` take `at`, the top-left corner,
 * and a place given is kept exactly; `beside` puts it 160 px right of another card, tops level.
 *
 * Driven through the deck's API as the person on the conversation on screen (`/api/v1/<verb>`),
 * which runs the real stage tool, because an agent calling it needs a model. The three calls are the
 * three cases: a place named, a place beside another card, and a named place for a card already on
 * the canvas, which moves it. Read back from the canvas file, which is where a place lives.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, deckState, open, resetStage, say, socket } from "../harness.mjs";

const until = async (fn, ms = 10000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const value = await fn();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args }) })).json();

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
const LINK = await socket();

const agentId = await until(() => LINK.last("agents")?.focused);
const stageName = await until(() => LINK.last("stages")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);
const file = join((await deckState()).path, "canvases", stageName ?? "?", "canvas.pen");
/** Where a card sits in the canvas file, found by its folder. */
const placed = (path) => {
	if (!existsSync(file) || !path) return undefined;
	const folder = path.replace(/\/index\.html$/, "").split("/").pop();
	const node = JSON.parse(readFileSync(file, "utf8")).children.find((n) => n.metadata?.type === "decks.card" && String(n.metadata.path ?? "").replace(/\/index\.html$/, "").split("/").pop() === folder);
	return node && { x: node.x, y: node.y, w: node.width };
};
const make = async (title) => (await call("card.create", [{ title, canvas: stageName }])).value?.path;

const first = await make("Placed where asked");
const put = await call("canvas.insert", [{ type: "card", card: first }, { at: { x1: 30000, y1: 20000 }, canvas: stageName }]);
const named = await until(() => placed(first));
say("a card placed with at lands exactly there", named?.x === 30000 && named?.y === 20000, JSON.stringify(named ?? put));

const second = await make("Placed beside it");
const besideIt = await call("canvas.insert", [{ type: "card", card: second }, { beside: first, canvas: stageName }]);
const beside = await until(() => placed(second));
say(
	"a card placed beside another goes just right of it, top edges level",
	beside?.y === 20000 && beside?.x === 30000 + (named?.w ?? 0) + 160,
	JSON.stringify(beside ?? besideIt),
);

const shown = await call("canvas.move", [first, { at: { x1: 31000, y1: 25000 }, canvas: stageName }]);
const moved = await until(() => {
	const now = placed(first);
	return now && now.x === 31000 ? now : undefined;
});
say("canvas.move with at moves a card already on the canvas", moved?.x === 31000 && moved?.y === 25000, JSON.stringify(moved ?? shown));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
LINK.close();
await browser.close();

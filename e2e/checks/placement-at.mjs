/**
 * An agent says where a board goes: `newBoard` and `show` take `at`, the top-left corner, and a
 * place given is kept exactly. Left out, the board goes beside the stage's newest board.
 *
 * Driven through the deck's API as the person on the conversation on screen (`/api/v1/<verb>`),
 * which runs the real stage tool, because an agent calling it needs a model (a board's own buttons
 * did this once; a board is only its picture now). The three calls are the three cases: a place
 * named, none named, and a named place for a board already on the stage, which moves it. Read back
 * from the stage file, which is where a place lives.
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
const placed = (title) => {
	if (!existsSync(file)) return undefined;
	const node = JSON.parse(readFileSync(file, "utf8")).children.find((n) => n.type === "browser" && n.name === title);
	return node && { x: node.x, y: node.y, w: node.width };
};

const first = await call("newBoard", [{ title: "Placed where asked", at: { x1: 30000, y1: 20000 } }]);
const named = await until(() => placed("Placed where asked"));
say("a board made with at lands exactly there", named?.x === 30000 && named?.y === 20000, JSON.stringify(named ?? first));

const second = await call("newBoard", [{ title: "Placed for me" }]);
const unnamed = await until(() => placed("Placed for me"));
say(
	"a board made without at goes just right of the newest board, top edges level",
	unnamed?.y === 20000 && unnamed?.x === 30000 + (named?.w ?? 0) + 160,
	JSON.stringify(unnamed ?? second),
);

const shown = await call("show", [first.value, { at: { x1: 31000, y1: 25000 } }]);
const moved = await until(() => {
	const now = placed("Placed where asked");
	return now && now.x === 31000 ? now : undefined;
});
say("show with at moves a board already on the stage", moved?.x === 31000 && moved?.y === 25000, JSON.stringify(moved ?? shown));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
LINK.close();
await browser.close();

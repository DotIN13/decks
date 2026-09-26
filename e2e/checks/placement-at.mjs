/**
 * An agent says where a board goes: `newBoard` and `show` take `at`, the top-left corner, and a
 * place given is kept exactly. Left out, the board goes beside the stage's newest board.
 *
 * Driven through a board's own code (`text/decks-eval`, see `board-eval.mjs`), which runs the real
 * stage tool against the conversation on screen, because an agent calling it needs a model. The
 * three buttons are the three cases: a place named, none named, and a named place for a board
 * already on the stage, which moves it. Read back from the stage file, which is where a place lives.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { boardPath, deckState, open, resetStage, say, settle, socket, write } from "../harness.mjs";

const until = async (fn, ms = 10000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const value = await fn();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
const LINK = await socket();
const FIXTURE = "place-at-fixture.html";
const PATH = `boards/${FIXTURE}`;

const button = (id, top, title, code) => `
		<section class="card" data-id="${id}" data-eval="${id}" style="left: 40px; top: ${top}px; width: 560px"><h3>${title}</h3></section>
		<script type="text/decks-eval" data-for="${id}">${code}</script>`;
write(
	await boardPath(FIXTURE),
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Place-at fixture</title>
		<meta name="board" content='{"w":640,"h":420,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">${button("named", 30, "Named", `return await stage.newBoard({ title: "Placed where asked", at: { x1: 30000, y1: 20000 } });`)}${button(
		"unnamed",
		150,
		"Unnamed",
		`return await stage.newBoard({ title: "Placed for me" });`,
	)}${button("moved", 270, "Moved", `const [one] = (await stage.boards()).filter((b) => b.title === "Placed where asked"); return await stage.show(one.path, { at: { x1: 31000, y1: 25000 } });`)}
		<script src="../lib/board.js"></script>
	</body>
</html>
`,
);
await settle(page, 1200);
await resetStage(page);

// The fixture alone, in front of the camera and big enough to click in (see `board-eval.mjs`).
for (const other of await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path))) {
	if (other !== PATH) LINK.send({ type: "board.hide", path: other });
}
await settle(page, 500);
await page.evaluate((name) => [...document.querySelectorAll(".board-row")].find((row) => row.textContent?.includes(name))?.click(), FIXTURE);
await settle(page, 900);
for (let i = 0; i < 10; i++) {
	const level = await page.evaluate(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
	if (level >= 60) break;
	await page.keyboard.press("=");
	await settle(page, 120);
}

const agentId = await until(() => LINK.last("agents")?.focused);
const stageName = await until(() => LINK.last("stages")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);
const file = join((await deckState()).path, "stages", stageName ?? "?", "stage.pen");
const placed = (title) => {
	if (!existsSync(file)) return undefined;
	const node = JSON.parse(readFileSync(file, "utf8")).children.find((n) => n.type === "browser" && n.name === title);
	return node && { x: node.x, y: node.y, w: node.width };
};

const press = async (id) => {
	await page.frameLocator(`.board-node[data-path="${PATH}"] iframe`).locator(`[data-id="${id}"]`).click();
	const always = page.locator(".dialog-card button", { hasText: "Always allow this board" });
	await always.first().click({ timeout: 2500 }).catch(() => {});
};

await press("named");
const named = await until(() => placed("Placed where asked"));
say("a board made with at lands exactly there", named?.x === 30000 && named?.y === 20000, JSON.stringify(named));

await press("unnamed");
const unnamed = await until(() => placed("Placed for me"));
say(
	"a board made without at goes just right of the newest board, top edges level",
	unnamed?.y === 20000 && unnamed?.x === 30000 + (named?.w ?? 0) + 160,
	JSON.stringify(unnamed),
);

await press("moved");
const moved = await until(() => {
	const now = placed("Placed where asked");
	return now && now.x === 31000 ? now : undefined;
});
say("show with at moves a board already on the stage", moved?.x === 31000 && moved?.y === 25000, JSON.stringify(moved));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
LINK.close();
await browser.close();

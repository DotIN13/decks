/**
 * A message says where the chat's camera was (`apps/web/src/tabs/about.ts`,
 * `apps/server/src/agents/looking-at.ts`).
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front, and an agent
 * has no home canvas to take "here" for. So the page sends, with the words, the tab that was in
 * front, and the harness tells the agent in a line before the words (its own test reads that line).
 * The page adds nothing to the words themselves: put there, the line stood in front of a slash
 * command, and `/compact` reached the model as a sentence. The composer shows nothing of it.
 *
 * No agent runs here: the page's line is routed, and what it would send an agent is held back and read.
 */
import { API, CANVAS, asPerson, card, open, resetStage, rest, say } from "../harness.mjs";

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
const second = (await call("canvas.create", ["Tab two"])).value?.name;

/** Every message the page would send an agent, held back here: answered as sent, and never said to the harness. */
const sent = [];
const { browser, page, errors } = await open({
	width: 1400,
	height: 900,
	before: (made) =>
		made.routeWebSocket(/\/api\/v1\/socket/, (ws) => {
			const server = ws.connectToServer();
			server.onMessage((message) => ws.send(message));
			server.onClose(() => ws.close().catch(() => {}));
			ws.onClose(() => server.close().catch(() => {}));
			ws.onMessage((message) => {
				let said;
				try {
					said = JSON.parse(String(message));
				} catch {
					said = undefined;
				}
				if (said?.type === "line.call" && (said.verb === "chat.send" || said.verb === "chat.queue")) {
					sent.push(said.args?.[1]);
					ws.send(JSON.stringify({ type: "call.answered", id: said.id, ok: true }));
					return;
				}
				server.send(message);
			});
		}),
});
await rest(page, { start: 0 });
const write = async (words) => {
	const before = sent.length;
	await page.locator(".dockfield").fill(words);
	await page.locator(".dockfield").press("Enter");
	await until(() => sent.length > before);
	return sent.at(-1);
};

// --- on the chat's canvas: the words go as written, with the tab that was in front ----------------------------
say("the composer has no chip for it: nothing to press, nothing to leave out", (await page.locator(".dock-about").count()) === 0 && !/\bOn\b/.test(await page.locator(".dock .dock-row").first().innerText()), await page.locator(".dock .dock-row").first().innerText().catch(() => ""));
const first = await write("hello from the first canvas");
say("the words are sent as they were written, with nothing put before them", first?.text === "hello from the first canvas" && first?.parts === undefined, JSON.stringify(first));
say("…and with them the tab the person was looking at: the canvas, by its name", JSON.stringify(first?.at) === JSON.stringify({ kind: "canvas", target: CANVAS }), JSON.stringify(first?.at));

// --- the camera on another canvas: what is sent follows --------------------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
await until(async () => ((await page.locator('.v3-topbar .tab-chip[data-camera="true"]').innerText()).includes("Tab two") ? true : undefined));
const there = await write("hello from the tab");
say("with the camera on another canvas, that canvas is what is sent", there?.text === "hello from the tab" && JSON.stringify(there?.at) === JSON.stringify({ kind: "canvas", target: second }), JSON.stringify(there));

// --- a slash command is sent as the exact line it is --------------------------------------------------------------
await page.locator(".dockfield").fill("/compact");
const before = sent.length;
// With the command menu up the first Enter completes the row it is on, and the next one sends.
await page.locator(".dockfield").press("Enter");
if (!(await until(() => sent.length > before, 1200))) await page.locator(".dockfield").press("Enter");
await until(() => sent.length > before);
say("a slash command goes as the exact line it is, nothing put before it", sent.length === before + 1 && /^\/compact ?$/.test(sent.at(-1)?.text ?? ""), JSON.stringify(sent.at(-1)));

// --- a card in front: the card is what is sent ------------------------------------------------------------------
await call("view.open", [card("plan")]);
await until(() => page.locator('.tab-chip[data-kind="card"][data-front="true"]').count());
const onCard = await write("about this card");
say("with a card in front, the card is what is sent, by its path, and the words alone", onCard?.text === "about this card" && JSON.stringify(onCard?.at) === JSON.stringify({ kind: "card", target: card("plan") }), JSON.stringify(onCard));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

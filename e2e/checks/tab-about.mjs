/**
 * A message says where the chat's camera was (`apps/web/src/tabs/about.ts`).
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front, and an agent
 * has no home canvas to take "here" for. So the agent's text always carries one line in front of the
 * words saying what the person was looking at: a canvas by the name a call can use, and a card, a
 * document or an app with the canvas held behind it. The composer shows nothing of it and has no way
 * to leave it out, and the message kept in the conversation is the words alone.
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

// --- on the chat's canvas: the agent is told where the person is, and the composer says nothing of it --------
if (process.env.LOOK_SHOTS) await page.locator(".dock").first().screenshot({ path: `${process.env.LOOK_SHOTS}/composer.png` });
say("the composer has no chip for it: nothing to press, nothing to leave out", (await page.locator(".dock-about").count()) === 0 && !/\bOn\b/.test(await page.locator(".dock .dock-row").first().innerText()), await page.locator(".dock .dock-row").first().innerText().catch(() => ""));
const first = await write("hello from the first canvas");
say("the agent's text says which canvas the person was looking at, by the name a call can use", first?.text === `[The person wrote this while looking at the canvas "Auth refresh" (--canvas ${CANVAS}).]\n\nhello from the first canvas`, JSON.stringify(first?.text));
say("…and the message kept is the words alone", JSON.stringify(first?.parts) === JSON.stringify([{ type: "text", text: "hello from the first canvas" }]), JSON.stringify(first?.parts));

// --- the camera on another canvas: the line follows ------------------------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
await until(async () => ((await page.locator('.v3-topbar .tab-chip[data-camera="true"]').innerText()).includes("Tab two") ? true : undefined));
const there = await write("hello from the tab");
say("with the camera on another canvas the agent's text names that one", there?.text === `[The person wrote this while looking at the canvas "Tab two" (--canvas ${second}).]\n\nhello from the tab`, JSON.stringify(there?.text));
const again = await write("and again");
say("…in every message, not only the first", again?.text === `[The person wrote this while looking at the canvas "Tab two" (--canvas ${second}).]\n\nand again`, JSON.stringify(again?.text));

// --- a card in front: the line names the card, and the canvas behind it ------------------------------------------
await call("view.open", [card("plan")]);
await until(() => page.locator('.tab-chip[data-kind="card"][data-front="true"]').count());
const onCard = await write("about this card");
say("with a card in front the agent's text names it by its path", (onCard?.text ?? "").startsWith(`[The person wrote this while looking at the card "`) && (onCard?.text ?? "").includes(`(@${card("plan")})`), JSON.stringify(onCard?.text));
say("…and the canvas held behind it, by the name a call can use", (onCard?.text ?? "").includes(`, with the canvas "Tab two" (--canvas ${second}) behind it.]\n\nabout this card`), JSON.stringify(onCard?.text));
say("…and the message kept is still the words alone", JSON.stringify(onCard?.parts) === JSON.stringify([{ type: "text", text: "about this card" }]), JSON.stringify(onCard?.parts));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

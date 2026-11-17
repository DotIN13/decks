/**
 * A message says which tab it was written on (`apps/web/src/tabs/about.ts`).
 *
 * The composer talks to the agent of the conversation on screen whichever tab is in front, and an agent
 * has no home canvas to take "here" for. So the composer shows a chip with the name of the tab in
 * front, a canvas, a card, a document or an app, and the agent's text carries one line in front of
 * the words saying what the person was looking at, a canvas by the name a call can use, while the
 * message kept in the conversation is the words alone. A press on the chip leaves the line out.
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

// --- on the chat's canvas: the composer names it, and the agent is told where the person is ----------------
const chip = page.locator(".dock-about");
say("the composer names the canvas the chat's camera is on", (await until(() => chip.count())) === 1 && (await chip.getAttribute("aria-pressed")) === "true" && (await chip.innerText()).includes("Auth refresh"), await chip.innerText().catch(() => ""));
const first = await write("hello from the first canvas");
say("the agent's text says which canvas the person was looking at, by the name a call can use", first?.text === `[The person wrote this while looking at the canvas "Auth refresh" (--canvas ${CANVAS}).]\n\nhello from the first canvas`, JSON.stringify(first?.text));
say("…and the message kept is the words alone", JSON.stringify(first?.parts) === JSON.stringify([{ type: "text", text: "hello from the first canvas" }]), JSON.stringify(first?.parts));

// --- the camera on another canvas: the chip and the line follow ----------------------------------------------
await page.locator('.v3-topbar [aria-label="Open a tab"]').click();
await page.locator('.switcher-canvas:has-text("Tab two")').click();
say("with the camera on another canvas the composer names that one", (await until(async () => ((await chip.innerText()).includes("Tab two") ? true : undefined))) === true && (await chip.getAttribute("aria-pressed")) === "true", await chip.innerText().catch(() => ""));
const there = await write("hello from the tab");
say("…and so does the agent's text", there?.text === `[The person wrote this while looking at the canvas "Tab two" (--canvas ${second}).]\n\nhello from the tab`, JSON.stringify(there?.text));

// --- left out with a press ----------------------------------------------------------------------------------
await chip.click();
say("a press on the chip leaves the tab out", (await chip.getAttribute("aria-pressed")) === "false");
const without = await write("hello, no tab");
say("…and the message goes as written", without?.text === "hello, no tab" && without?.parts === undefined, JSON.stringify(without));
await chip.click();
say("a second press puts it back", (await chip.getAttribute("aria-pressed")) === "true" && /looking at the canvas/.test((await write("back on")).text ?? ""));

// --- a card in front: the line names the card ------------------------------------------------------------------
await call("view.open", [card("plan")]);
say("with a card in front the composer names the card", (await until(async () => (/plan/i.test(await chip.innerText()) ? true : undefined))) === true, await chip.innerText().catch(() => ""));
const onCard = await write("about this card");
say("…and the agent's text names it by its path", (onCard?.text ?? "").startsWith(`[The person wrote this while looking at the card "`) && (onCard?.text ?? "").includes(`(@${card("plan")})`), JSON.stringify(onCard?.text));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

/**
 * A new agent opens at once: its conversation on screen, and its canvas with it.
 *
 * "New agent" made the agent and left the screen on the conversation you were in, so you had to find the
 * new one in the list to talk to it or see its canvas. Here: the agent on screen, then New agent from the
 * side panel; the conversation on screen is the new agent's, and the canvas frame shows the canvas it is on.
 */
import { API, asPerson, canvasFrame, newAgent, open, resetStage, rest, say, settle } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await canvasFrame(page);
await rest(page);
const person = await asPerson();
const call = async (verb, args = []) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const before = new Set(((await call("agent.list")).value ?? []).map((one) => one.id));
const onScreen = () => page.evaluate(() => document.querySelector(".v3-agent-name")?.textContent?.trim() ?? "");
const was = await onScreen();

await newAgent(page);
await settle(page, 1200);
const made = ((await call("agent.list")).value ?? []).find((one) => !before.has(one.id));
say("New agent makes an agent", !!made, JSON.stringify(made?.name));
const now = await onScreen();
say("the conversation on screen is the new agent's", !!made && now === made.name && now !== was, `${was} → ${now}`);
const canvas = await canvasFrame(page);
let base = "";
for (let i = 0; i < 40 && made?.canvas && !base.includes(`/canvases/${made.canvas}/`); i++) {
	await settle(page, 200);
	base = String(await canvas.evaluate(() => globalThis.__decksProbes?.rust?.base ?? "").catch(() => ""));
}
say("the canvas on screen is the new agent's", !!made?.canvas && base.includes(`/canvases/${made.canvas}/`), `${made?.canvas} in ${base}`);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

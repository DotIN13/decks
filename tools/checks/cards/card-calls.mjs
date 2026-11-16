/**
 * A card's `card.decks` calls, in each shape the person's deck uses, do what they did.
 *
 * Old cards keep working forever (DESIGN.md's last note, rewire step 5): the frame turns an old call into
 * the new one (`@decks/protocol/compat`, `cardCall`). Here, on one canvas: a decision button in the new
 * shape and in the old one (`card.decks.agent.send`), a card made by the boards-to-cards migration whose
 * `data-eval` button runs `stage.send` (its module, as the migration wrote it), and old canvas calls
 * (insert, read, delete). Each is pressed; a message to an agent is asked of the person, allowed once and
 * refused once, and the card shows what it was answered.
 */
import { API, asPerson, canvasFrame, flyToCard, open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const post = async (name, body) => (await fetch(`${API}/api/v1/${name}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify(body) })).json();
const agents = (await post("agent.list", {})).value ?? [];
const AGENT = agents[0]?.name;
say("an agent to send to", typeof AGENT === "string", JSON.stringify(agents.map((one) => one.name)));

/** A card whose one button runs `press` with the card, and shows its answer, or its error, in #out. */
const button = (title, label, press) => `<style>#go { display: block; width: 100%; height: 120px; font-size: 18px }</style><div class="doc"><button id="go">${label}</button><pre id="out"></pre></div>
<script type="module">
export default function (card) {
	const out = card.root.querySelector("#out");
	const say = (text) => ((out.textContent = text), card.root.host.setAttribute("data-out", text));
	card.root.querySelector("#go").addEventListener("click", async () => {
		try {
			const answer = await (${press})(card);
			say("ok " + JSON.stringify(answer ?? null));
		} catch (error) {
			say("error " + (error?.message ?? String(error)));
		}
	}, { signal: card.signal });
}
</script>`;

/** The module the boards-to-cards migration wrote into a card for its data-eval buttons (its OLD table, as written then). */
const migrated = `<style>[data-eval] { display: block; width: 100%; height: 120px; font-size: 18px }</style><div class="doc"><button data-eval="pick" data-value="A">Option A</button><pre id="out"></pre></div>
<script type="module">
const blocksOf = (card) => ({
	"pick": async (stage, event) => {
		try {
			const answer = await stage.send(${JSON.stringify(AGENT)}, { task: "Picked " + event.value, boards: [event.board] });
			card.root.host.setAttribute("data-out", "ok " + JSON.stringify(answer ?? null));
		} catch (error) {
			card.root.host.setAttribute("data-out", "error " + (error?.message ?? String(error)));
		}
	},
});
const OLD = { send: "agent.queue", move: "canvas.move", moveBoard: "canvas.move", fit: "canvas.fit", boards: "canvas.read", show: "canvas.insert", hide: "canvas.delete", me: "agent.me", agents: "agent.list", camera: "view.camera", now: "now", here: "here" };
export default function (card) {
	const BLOCKS = blocksOf(card);
	const call = (name) => name.split(".").reduce((at, key) => at[key], card.decks);
	const stage = new Proxy(card.decks, { get: (decks, key) => (typeof key === "string" && key in OLD ? (...args) => call(OLD[key])(...args) : decks[key]) });
	card.root.addEventListener("click", (event) => {
		const element = event.target?.closest?.("[data-eval]");
		if (!event.isTrusted || !element) return;
		const id = element.getAttribute("data-eval");
		const value = element.dataset.value;
		BLOCKS[id](stage, { id, board: card.path, path: card.path, value });
	}, { signal: card.signal });
}
</script>`;

const cards = {
	newSend: button("New send", "Send (new)", `(card) => card.decks.agent.send({ agent: ${JSON.stringify(AGENT)}, task: "Option A, new shape", cards: [card.path] })`),
	oldSend: button("Old send", "Send (old)", `(card) => card.decks.agent.send(${JSON.stringify(AGENT)}, { task: "Option A, old shape", cards: [card.path] })`),
	migrated,
	oldCanvas: button("Old canvas calls", "Insert, read, delete", `async (card) => {
		const made = await card.decks.canvas.insert({ type: "note", content: "From an old card" }, { beside: card.path });
		const read = await card.decks.canvas.read();
		const had = (read.items ?? []).some((one) => one.id === made.id);
		await card.decks.canvas.delete(made.id);
		const after = await card.decks.canvas.read();
		return { made: !!made.id, had, gone: !(after.items ?? []).some((one) => one.id === made.id) };
	}`),
};
const placed = {};
for (const [name, html] of Object.entries(cards)) {
	const made = await post("canvas.insert", { args: [{ type: "card", title: name, html, width: 520, height: 220 }] });
	placed[name] = made.value?.card;
	say(`the ${name} card is on the canvas`, made.ok === true && !!placed[name], JSON.stringify(made).slice(0, 160));
}

const { browser, page, errors } = await open({ width: 1500, height: 950 });
const canvas = await canvasFrame(page);

/** Press the card's button (it fills the card's top), answer the person's question when one comes, and read what the card says. */
async function press(name, answer) {
	const path = placed[name];
	await flyToCard(page, path);
	await canvas.waitForFunction((wanted) => [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted)?.querySelector(".card-host"), path, { timeout: 10000 }).catch(() => {});
	await settle(page, 400);
	const hostOf = () => canvas.evaluate((wanted) => {
		const host = [...document.querySelectorAll(".card-node")].find((one) => one.dataset.path === wanted)?.querySelector(".card-host");
		const r = host?.getBoundingClientRect();
		return r ? { x: r.x, y: r.y, w: r.width, h: r.height, out: host.getAttribute("data-out") ?? "" } : null;
	}, path);
	const before = await hostOf();
	const frameBox = await (await canvas.frameElement()).boundingBox();
	await page.mouse.click(frameBox.x + before.x + before.w / 2, frameBox.y + before.y + before.h * 0.4);
	if (answer) {
		const choice = page.getByRole("button", { name: answer, exact: true });
		await choice.waitFor({ timeout: 6000 }).catch(() => {});
		await choice.click().catch(() => {});
	}
	for (let i = 0; i < 80; i++) {
		const now = await hostOf();
		if (now && now.out && now.out !== before.out) return now.out;
		await settle(page, 100);
	}
	return (await hostOf())?.out ?? "";
}

for (const name of ["newSend", "oldSend", "migrated"]) {
	const allowed = await press(name, "Allow");
	say(`${name}: asked, allowed, and answered by the server`, /^ok /.test(allowed), allowed.slice(0, 160));
	const refused = await press(name, "Don't allow");
	say(`${name}: asked, not allowed, and the card is told so`, /^error .*did not let/i.test(refused), refused.slice(0, 160));
}
const canvasCalls = await press("oldCanvas");
say("old canvas.insert, canvas.read and canvas.delete act on an item, as they did", /"made":true/.test(canvasCalls) && /"had":true/.test(canvasCalls) && /"gone":true/.test(canvasCalls), canvasCalls.slice(0, 160));
say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

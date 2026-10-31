/**
 * `decks canvas fit` measures a card the way the canvas frame lays it out, whether or not a canvas is open.
 *
 * A card nobody is looking at is measured by the server's own Chromium (`apps/web/measure.html`); one on
 * screen by the frame that shows it. The two must agree on a card whose height its own script sets and
 * whose `@container card` rule changes with its width, which is what a card in a plain page got wrong when
 * the page was not mounted as the frame mounts it (a shadow root, the module handed `card`, card.css adopted).
 */
import { API, CANVAS, asPerson, card, canvasFrame, deckState, open, resetStage, say, settle, write } from "../harness.mjs";

const call = async (verb, args = [], headers = {}) => {
	const response = await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
	return response.json();
};
const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
};

await resetStage();
const person = await asPerson();
const me = (await call("agent.me", [], person)).value;
const agent = { ...person, "x-decks-agent": me.id };

// 480 wide, so the container rule (narrower than 600) holds; the script adds 333 px after it wakes.
const made = await call("card.create", [{ title: "Fit check", w: 480, h: 200, canvas: CANVAS }], agent);
const path = made.value?.path;
say("a card to fit", !!path, JSON.stringify(made).slice(0, 200));
const deck = await deckState();
write(
	`${deck.path}/${path}`,
	`<title>Fit check</title>
<meta name="card" content='{"w":480,"h":200}' />
<style>
	.doc { padding: 24px }
	.doc h1 { margin: 0; font-size: 24px; line-height: 32px }
	.tall { height: 100px; background: #ddd }
	@container card (width < 600px) { .tall { height: 260px } }
</style>
<div class="doc"><h1>Fit check</h1><div class="tall"></div><div class="grown"></div></div>
<script type="module">
	export default function (card) {
		// What a card is handed in the frame (\`CardContext\`): its size, a listener, a file beside it; then a late change.
		card.on("size", () => {});
		if (!card.file("data.json").includes("/cards/fit-check")) return;
		setTimeout(() => (card.root.querySelector(".grown").style.height = "333px"), 400);
	}
</script>
`,
);
const placed = await call("canvas.insert", [{ type: "card", card: path }, { beside: card("plan") }], agent);
say("placed on the canvas", placed.ok !== false && !placed.error, JSON.stringify(placed).slice(0, 200));

// No browser open: the server's own Chromium measures it.
const away = await call("canvas.fit", [path, { margin: 0 }], agent);
const awayH = away.value?.h;
say("fit with no canvas open answers a height", Number.isFinite(awayH), JSON.stringify(away).slice(0, 300));
// The doc's 24 + 32 + 24 and its rows (~8 px of card.css spacing), plus 260 from the container rule (100 without it) and 333 from the script.
say("…which counts the script's late height and the container rule", (awayH ?? 0) > 660 && (awayH ?? 0) < 700, String(awayH));

// Now the frame shows it: its own measurement is the one fit reads.
const { browser, page, errors } = await open({ width: 1500, height: 950 });
await settle(page, 1500);
const mounted = await until(async () => (await canvasFrame(page)).evaluate(() => [...document.querySelectorAll(".card-node[data-path]")].some((one) => one.dataset.path.includes("fit-check") && one.querySelector(".card-host"))));
say("the card is mounted in the frame", !!mounted, await (await canvasFrame(page)).evaluate(() => [...document.querySelectorAll(".card-node[data-path]")].map((one) => one.dataset.path + ":" + !!one.querySelector(".card-host")).join(" ")));
await settle(page, 1500);
// Answered before the server's own Chromium would start (1.2 s): the frame's measurement, not the away one.
const started = Date.now();
const seen = await call("canvas.fit", [path, { margin: 0 }], agent);
const took = Date.now() - started;
const frameH = seen?.value?.h;
say("fit with the card on screen answers from the frame", Number.isFinite(frameH) && took < 1100, `${took} ms ${JSON.stringify(seen).slice(0, 300)}`);
say("the server's measurement is the frame's", Math.abs((awayH ?? 0) - (frameH ?? -99)) <= 1, `away ${awayH}, frame ${frameH}`);
say("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();

/**
 * The deck's import map reaches every card on the canvas, from the harness, and nothing asks for one the deck lacks.
 *
 * Each card looked for the map itself at `../../assets/importmap.json` from its own address, which is the
 * canvas's folder, not the deck's: a map in the deck's `assets/` was never found, and a deck without one had a
 * 404 in the console for every canvas. Now the harness hands the map with the canvas's pass (`/api/passes`,
 * `imports`), the frame adds it before any card's script runs (`items/card.ts`, `giveDeckImports`), and the
 * pass reads the libraries it names and the files beside them. Here: with no map, no request for one; with a
 * map naming a library under `assets/`, a card's script imports it by name, and the library its own neighbour.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { API, asPerson, canvasFrame, card, cardFile, deckState, open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const deck = await deckState();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const path = card("imports-check");
const file = await cardFile("imports-check");
mkdirSync(dirname(file), { recursive: true });
// The card says what it imported where the check can read it: the frame's own window, which its script runs in.
writeFileSync(
	file,
	`<title>Imports check</title>
<meta name="card" content='{"w":600}' />
<div class="doc"><p id="out">waiting</p></div>
<script type="module">
	export default async function (card) {
		let said;
		try { said = (await import("greet")).greet("deck"); } catch (error) { said = "no greet: " + error.message; }
		card.root.getElementById("out").textContent = said;
		globalThis.__importsCheck = said;
	}
</script>
`,
);

// Just written: the harness hears of the card's file a moment later.
let placed = { ok: false };
for (let i = 0; i < 40 && !placed.ok; i++) {
	placed = await call("canvas.insert", [{ type: "card", card: path }, { at: { x1: -1400, y1: 0 } }]);
	if (!placed.ok) await new Promise((resolve) => setTimeout(resolve, 250));
}
say("the card is on the canvas", placed.ok === true, JSON.stringify(placed).slice(0, 160));

// --- no map: the card's script runs, and nothing asks for a map ---
rmSync(join(deck.path, "assets", "importmap.json"), { force: true });
{
	const { browser, page, errors } = await open({ width: 1400, height: 900 });
	const asked = [];
	page.on("request", (request) => request.url().includes("importmap.json") && asked.push(request.url()));
	const canvas = await canvasFrame(page);
	await call("view.focus", [path]);
	let said = null;
	for (let i = 0; i < 60 && !said; i++) {
		await settle(page, 250);
		said = await canvas.evaluate(() => globalThis.__importsCheck ?? null).catch(() => null);
	}
	say("a deck with no import map: the card's script runs, finding no library by that name", typeof said === "string" && said.startsWith("no greet"), String(said));
	say("…and nothing asks for a map", asked.length === 0, asked.slice(0, 2).join(" | "));
	// The card's own failed import is its script's, said by it; nothing else may err.
	say("…and no other page errors", errors.filter((one) => !/greet/.test(one)).length === 0, errors.slice(0, 2).join(" | "));
	await browser.close();
}

// --- a map: a card imports the deck's library by its name ---
mkdirSync(join(deck.path, "assets", "libs", "greet"), { recursive: true });
writeFileSync(join(deck.path, "assets", "libs", "greet", "words.js"), 'export const hello = "hello";');
writeFileSync(join(deck.path, "assets", "libs", "greet", "index.js"), 'import { hello } from "./words.js";\nexport const greet = (who) => `${hello} from the ${who}`;');
writeFileSync(join(deck.path, "assets", "importmap.json"), JSON.stringify({ imports: { greet: "./libs/greet/index.js" } }));
{
	const { browser, page, errors } = await open({ width: 1400, height: 900 });
	const canvas = await canvasFrame(page);
	await call("view.focus", [path]);
	let said = null;
	for (let i = 0; i < 60 && !said; i++) {
		await settle(page, 250);
		said = await canvas.evaluate(() => globalThis.__importsCheck ?? null).catch(() => null);
	}
	say("a card imports the deck's library by its name, and the library its neighbour", said === "hello from the deck", String(said));
	say("…with no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
	await browser.close();
}

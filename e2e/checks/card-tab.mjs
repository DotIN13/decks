/**
 * A card opened in a tab of its own runs its scripts with the card the canvas gives them.
 *
 * The page a card is opened by itself in (`apps/server/src/cards/cards.ts`, `cardPage`) handed its scripts
 * a card with only its root, document, signal, address, theme, size and storage, so a script that read a
 * file beside it (`card.file("data.json")`, as cards are written to) threw "card.file is not a function"
 * and drew nothing. Here a card whose script uses `file`, `on`, `store`, `path` and `decks` is opened at
 * its address on a canvas pass, as a tab opens it: it draws, with no error, and its calls say they need
 * the canvas. And the page's response carries no Permissions-Policy header of the harness's.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { API, asPerson, card, cardFile, resetStage, say } from "../harness.mjs";

await resetStage();
const path = card("tab-check");
const file = await cardFile("tab-check");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(`${dirname(file)}/data.json`, JSON.stringify({ word: "beside" }));
writeFileSync(
	file,
	`<title>Tab check</title>
<meta name="card" content='{"w":600}' />
<div class="doc"><p id="out">waiting</p></div>
<script type="module">
	export default async function (card) {
		const data = await (await fetch(card.file("data.json"))).json();
		card.on("theme", () => {});
		card.store.setItem("seen", "yes");
		let refused = "";
		try { await card.decks.canvas.read(); } catch (error) { refused = String(error.message); }
		card.root.getElementById("out").textContent = [data.word, card.store.getItem("seen"), card.path.endsWith("tab-check/index.html"), /tab of its own/.test(refused)].join(" ");
	}
</script>
`,
);

const person = await asPerson();
const pass = (await (await fetch(`${API}/api/passes`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ canvas: "auth-refresh" }) })).json()).pass;
say("a canvas pass for the card's canvas", typeof pass === "string" && pass.length > 10);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
const response = await page.goto(`${API}/api/t/${pass}/card/${path}`);
say("the card's page opens", response?.status() === 200, String(response?.status()));
say("…with no Permissions-Policy header of the harness's", !Object.keys(response?.headers() ?? {}).some((name) => name.toLowerCase() === "permissions-policy"), JSON.stringify(response?.headers()["permissions-policy"] ?? null));
await page.waitForFunction(() => document.getElementById("out")?.textContent !== "waiting", null, { timeout: 8000 }).catch(() => {});
const out = await page.evaluate(() => document.getElementById("out")?.textContent ?? "");
say("its script ran with the card: a file beside it, its store, its path, and calls that say they need the canvas", out === "beside yes true true", out);
say("no errors on the page", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();

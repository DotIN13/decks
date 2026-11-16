/**
 * A card opened in a tab of its own runs its scripts with the card the canvas gives them.
 *
 * The page a card is opened by itself in (`apps/server/src/cards/cards.ts`, `cardPage`) handed its scripts
 * a card with only its root, document, signal, address, theme, size and storage, so a script that read a
 * file beside it (`card.file("data.json")`, as cards are written to) threw "card.file is not a function"
 * and drew nothing. Here a card whose script uses `file`, `on`, `store`, `path` and `decks` is opened at
 * its address on a canvas pass, as a tab opens it: it draws, with no error, and its calls say they need
 * the canvas. And the page's response carries no Permissions-Policy header of the harness's.
 *
 * The page reads the deck's import map as every program does (protocol's `deckFiles.importMap`): an
 * address under assets/ is found, `/x.js` is read as assets/x.js, one that climbs out of assets/ (`../`)
 * or names a hidden folder is dropped, and a map that is not JSON gives no names and breaks nothing.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { API, asPerson, card, cardFile, deckState, resetStage, say } from "../harness.mjs";

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

// --- the deck's import map, read by the rule every program shares ---
const deck = await deckState();
const assets = join(deck.path, "assets");
const map = join(assets, "importmap.json");
mkdirSync(join(assets, "libs", "tabcheck"), { recursive: true });
mkdirSync(join(assets, ".hidden"), { recursive: true });
for (const name of ["plain", "rooted"]) writeFileSync(join(assets, "libs", "tabcheck", `${name}.js`), `export const word = "${name}";`);
writeFileSync(join(assets, ".hidden", "secret.js"), 'export const word = "secret";');
writeFileSync(join(deck.path, "outside.js"), 'export const word = "outside";');
const mapCard = card("tab-map-check");
const mapFile = await cardFile("tab-map-check");
mkdirSync(dirname(mapFile), { recursive: true });
writeFileSync(
	mapFile,
	`<title>Tab map check</title>
<meta name="card" content='{"w":600}' />
<div class="doc"><p id="out">waiting</p></div>
<script type="module">
	export default async function (card) {
		const words = [];
		for (const name of ["plain", "rooted", "up", "hidden"]) {
			try { words.push(name + "=" + (await import(name)).word); } catch { words.push(name + "=none"); }
		}
		card.root.getElementById("out").textContent = words.join(" ");
	}
</script>
`,
);
/** The card opened in a fresh tab, with what its script said and the page's errors other than its own failed imports. */
async function mapTab() {
	const tab = await browser.newPage();
	const seen = [];
	tab.on("pageerror", (error) => seen.push(String(error)));
	await tab.goto(`${API}/api/t/${pass}/card/${mapCard}`);
	await tab.waitForFunction(() => document.getElementById("out")?.textContent !== "waiting", null, { timeout: 8000 }).catch(() => {});
	const said = await tab.evaluate(() => document.getElementById("out")?.textContent ?? "");
	await tab.close();
	return { said, seen };
}
try {
	writeFileSync(map, JSON.stringify({ imports: { plain: "./libs/tabcheck/plain.js", rooted: "/libs/tabcheck/rooted.js", up: "../outside.js", hidden: ".hidden/secret.js" } }));
	const read = await mapTab();
	say("the import map: a path under assets/ is found, and /x.js read as assets/x.js", /plain=plain/.test(read.said) && /rooted=rooted/.test(read.said), read.said);
	say("…one that climbs out of assets/, or names a hidden folder, is dropped", /up=none/.test(read.said) && /hidden=none/.test(read.said), read.said);
	writeFileSync(map, "{ not json");
	const broken = await mapTab();
	say("a map that is not JSON gives no names, and the card still runs with no page error", broken.said === "plain=none rooted=none up=none hidden=none" && broken.seen.length === 0, `${broken.said} ${broken.seen.slice(0, 2).join(" | ")}`);
} finally {
	rmSync(map, { force: true });
	rmSync(join(assets, "libs", "tabcheck"), { recursive: true, force: true });
	rmSync(join(assets, ".hidden"), { recursive: true, force: true });
	rmSync(join(deck.path, "outside.js"), { force: true });
}
await browser.close();

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

/*
 * The card snapshot writer is DOM through and through (a shadow root, live field values, a canvas's
 * pixels, adopted sheets), so it is tested in a real Chromium: the module bundled by esbuild and run in
 * a page. Skipped where Playwright has no Chromium.
 */
type Browser = import("playwright").Browser;
type Page = import("playwright").Page;

let browser: Browser | undefined;
let page: Page | undefined;
let why = "";

before(async () => {
	try {
		const { chromium } = await import("playwright");
		const { build } = await import("esbuild");
		const bundled = await build({
			entryPoints: [fileURLToPath(new URL("./card-snapshot.ts", import.meta.url))],
			bundle: true,
			write: false,
			format: "iife",
			globalName: "cardSnapshot",
			target: "es2022",
		});
		browser = await chromium.launch();
		page = await browser.newPage();
		// At an address of its own, so the card's origin is a real one, as the canvas frame's is.
		await page.route("http://card.test/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
		await page.goto("http://card.test/");
		// tsx keeps functions' names with a `__name` helper, which the functions handed to `evaluate` carry.
		await page.addScriptTag({ content: `globalThis.__name = (f) => f;\n${bundled.outputFiles[0]!.text}` });
	} catch (error) {
		why = error instanceof Error ? error.message.split("\n")[0]! : String(error);
	}
});
after(async () => {
	await browser?.close();
});

/** A card mounted as `card.ts` mounts one: a closed root, a shared sheet adopted, the body `.card-body`. Then `act` runs, then the writer. */
async function shoot(markup: string, act: string): Promise<{ html: string; w: number; h: number }> {
	return page!.evaluate(
		async ({ markup, act }) => {
			const host = document.createElement("div");
			host.style.cssText = "width: 400px; height: 300px; transform: scale(0.5)";
			document.body.replaceChildren(host);
			const root = host.attachShadow({ mode: "closed" });
			const shared = new CSSStyleSheet();
			shared.replaceSync(":host { display: block } .card-body { color: red }");
			const scripted = new CSSStyleSheet();
			scripted.replaceSync(".made-by-script { color: rgb(1, 2, 3) }");
			root.adoptedStyleSheets = [shared, scripted];
			const body = document.createElement("div");
			body.className = "card-body board";
			body.innerHTML = markup;
			root.append(body);
			// eslint-disable-next-line no-new-func
			await new Function("root", "body", `return (async () => { ${act} })()`)(root, body);
			const { snapshotOfCard } = (globalThis as unknown as { cardSnapshot: typeof import("./card-snapshot.ts") }).cardSnapshot;
			const shot = snapshotOfCard(root, { w: 400, h: 300, scheme: "dark", url: `${location.origin}/api/t/abc/card/canvases/c/cards/x@1/index.html`, skip: (sheet) => sheet === shared })!;
			return { html: shot.html, w: shot.w, h: shot.h };
		},
		{ markup, act },
	);
}

describe("snapshotOfCard", () => {
	it("writes in what was typed, chosen and ticked, and drops scripts", async (t) => {
		if (!page) return t.skip(why);
		const { html } = await shoot(
			`<input id=a value="old"><textarea id=b>old</textarea><select id=c><option>one</option><option>two</option></select><input id=d type=checkbox><details id=e><summary>s</summary>x</details><script>alert(1)</script>`,
			`root.getElementById("a").value = "typed"; root.getElementById("b").value = "written"; root.getElementById("c").value = "two"; root.getElementById("d").checked = true; root.getElementById("e").open = true;`,
		);
		assert.match(html, /<input id="a" value="typed">/);
		assert.match(html, /<textarea id="b">written<\/textarea>/);
		assert.match(html, /<option selected="">two<\/option>/);
		assert.match(html, /<input id="d" type="checkbox" checked="">/);
		assert.match(html, /<details id="e" open="">/);
		assert.doesNotMatch(html, /<script/);
	});

	it("is a card's page: board.css, body.board at the card's width, the card in #decks-card, the scheme", async (t) => {
		if (!page) return t.skip(why);
		const { html, w, h } = await shoot(`<p>hello</p>`, ``);
		assert.match(html, /<link rel="stylesheet" href="..\/..\/lib\/board.css"/);
		assert.match(html, /<html lang="en" data-theme="dark">/);
		assert.match(html, /<body class="board" style="width:400px">/);
		assert.match(html, /<div class="card-body" id="decks-card"><p>hello<\/p><\/div>/);
		assert.equal(w, 400);
		assert.equal(h, 300);
	});

	it("draws a canvas as its pixels, at its layout size, not the zoomed one", async (t) => {
		if (!page) return t.skip(why);
		const { html } = await shoot(
			`<canvas id=k width=20 height=10 style="width: 200px; height: 100px"></canvas>`,
			`const ctx = root.getElementById("k").getContext("2d"); ctx.fillStyle = "#0f0"; ctx.fillRect(0, 0, 20, 10);`,
		);
		assert.doesNotMatch(html, /<canvas/);
		assert.match(html, /<img id="k" width="20" height="10" style="width: 200px; height: 100px;?" src="data:image\/png;base64,/);
	});

	it("keeps rules a script made, but not the shared card sheet", async (t) => {
		if (!page) return t.skip(why);
		const { html } = await shoot(`<style id=s></style><p class=made-by-script>x</p>`, `root.getElementById("s").sheet.insertRule(".inserted { color: blue }");`);
		assert.match(html, /\.made-by-script \{ color: rgb\(1, 2, 3\); \}/);
		assert.match(html, /<style id="s">\.inserted \{ color: blue; \}<\/style>/);
		assert.doesNotMatch(html, /color: red/);
	});

	it("notes scroll positions and makes the card's own origin relative to the site", async (t) => {
		if (!page) return t.skip(why);
		const { html } = await shoot(
			`<div id=box style="height: 50px; overflow: auto"><div style="height: 500px"></div></div><img src="ORIGIN/api/t/abc/card/canvases/c/cards/x@1/a.png">`,
			`root.getElementById("box").scrollTop = 120; const img = root.querySelector("img"); img.setAttribute("src", img.getAttribute("src").replace("ORIGIN", location.origin));`,
		);
		assert.match(html, /data-decks-scroll="0,120"/);
		assert.match(html, /<img src="\/api\/t\/abc\/card\/canvases\/c\/cards\/x@1\/a.png">/);
	});
});

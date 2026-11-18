/**
 * The canvas list's small pictures are of the canvases as they are now (`CanvasSwitcher.tsx`,
 * `canvas/shots.ts` `thumb`, `pens.summary` `shot`).
 *
 * A picture is asked for and kept by the drawing's hash. It was asked for by the drawing's revision,
 * which counts from 1 again each time the harness starts: after a restart every canvas was at
 * revision 1, so the picture kept as revision 1 by an earlier run, and the one the browser had kept
 * for a year under `v=1`, were shown as today's. A canvas that had grown from one card to thirty
 * still showed the one.
 *
 * What is checked: each row of the list with cards on its canvas shows a picture that loaded, asked
 * for by a hash; the harness keeps that address for a year and no other; a picture left on disk
 * under an old revision number is not what is shown; and after the drawing changes the row asks for
 * a new picture, which loads. `LOOK_SHOTS=<dir>` keeps a picture of the open list.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { API, asPerson, deckState, open, resetStage, say, settle } from "../harness.mjs";

const OUT = process.env.LOOK_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const until = async (test, ms = 30000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test().catch(() => undefined);
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
};

await resetStage();
// A second canvas with a card on it: a canvas with no card has no picture to show.
const made = (await call("canvas.create", ["Picture check"])).value?.name;
await call("canvas.insert", [{ type: "card", html: '<div class="doc"><h1>One card</h1></div>', title: "One card", width: 600, height: 300 }, { canvas: made, at: { x1: 0, y1: 0 } }]);

// What an earlier run of the harness left: a picture of this canvas kept as revision 1, which is the revision a restart gives it again.
const folder = join((await deckState()).path, ".decks", "thumbs", "stages");
mkdirSync(folder, { recursive: true });
for (const scheme of ["light", "dark"]) writeFileSync(join(folder, `${made}-1-${scheme}.jpg`), "not a picture");

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await page.locator('[data-tip="Canvases"]:visible').first().click();
await settle(page, 300);
const rows = () =>
	page.evaluate(() =>
		[...document.querySelectorAll(".switcher-canvas")].map((row) => {
			const img = row.querySelector(".switcher-thumb img");
			const thumb = row.querySelector(".switcher-thumb").getBoundingClientRect();
			return { title: row.querySelector(".row-label")?.textContent?.trim(), asked: img?.getAttribute("data-src") ?? null, loaded: !!img && img.complete && img.naturalWidth > 0, wide: img?.naturalWidth ?? 0, box: [Math.round(thumb.width), Math.round(thumb.height)], drawn: img ? [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)] : null };
		}),
	);
const row = async (title) => (await rows()).find((one) => one.title === title);
const withCards = async () => (await rows()).filter((one) => one.asked);

const loaded = await until(async () => ((await withCards()).length >= 2 && (await withCards()).every((one) => one.loaded) ? await withCards() : undefined));
say("each canvas with cards shows a picture in the list, and it loaded", !!loaded, JSON.stringify(await rows()));
say("…asked for by the drawing's hash, not by a revision number", (loaded ?? []).every((one) => /^\/api\/stage-thumb\/[^?]+\?v=[0-9a-f]{12}&scheme=(light|dark)$/.test(one.asked)), JSON.stringify((loaded ?? []).map((one) => one.asked)));
say("…and it fills its small box", (loaded ?? []).every((one) => one.drawn && one.drawn[0] === one.box[0] && one.drawn[1] === one.box[1] && one.box[0] === 34 && one.box[1] === 24), JSON.stringify((loaded ?? []).map((one) => [one.box, one.drawn])));
if (OUT) await page.screenshot({ path: join(OUT, "canvas-list.png"), clip: { x: 0, y: 0, width: 700, height: 420 } });

const mine = await row("Picture check");
const kept = await fetch(`${API}${mine?.asked}`, { headers: person });
const bytes = Buffer.from(await kept.arrayBuffer());
say("the harness answers that address with a JPEG it lets the browser keep for a year", kept.status === 200 && bytes[0] === 0xff && bytes[1] === 0xd8 && /immutable/.test(kept.headers.get("cache-control") ?? ""), `${kept.status} ${kept.headers.get("cache-control")} ${bytes.length} bytes`);
const stale = await fetch(`${API}/api/stage-thumb/${made}?v=1&scheme=light`, { headers: person });
const staleBytes = Buffer.from(await stale.arrayBuffer());
say("an address by revision number gets today's picture, not the one an earlier run kept as revision 1, and is not kept", stale.status === 200 && staleBytes[0] === 0xff && staleBytes.length > 100 && /no-cache/.test(stale.headers.get("cache-control") ?? ""), `${stale.status} ${stale.headers.get("cache-control")} ${staleBytes.length} bytes`);
say("…and the earlier run's file is gone once today's is taken", !existsSync(join(folder, `${made}-1-light.jpg`)) && readdirSync(folder).some((file) => file.startsWith(`${made}-`) && file.endsWith("-light.jpg")), JSON.stringify(readdirSync(folder)));

// The drawing changes: the row asks for a new picture.
await call("canvas.insert", [{ type: "note", id: "after", content: "Added after the first picture" }, { canvas: made, at: { x1: 700, y1: 0 } }]);
const again = await until(async () => {
	const now = await row("Picture check");
	return now && now.asked !== mine?.asked && now.loaded ? now : undefined;
});
say("after the drawing changes its row asks for a new picture, which loads", !!again, JSON.stringify({ before: mine?.asked, after: (await row("Picture check"))?.asked }));
const other = await row((await rows()).find((one) => one.asked && one.title !== "Picture check")?.title);
say("…and the other canvas's picture is asked for as before", !!other && (loaded ?? []).some((one) => one.title === other.title && one.asked === other.asked), JSON.stringify(other));

say("no errors on the page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();

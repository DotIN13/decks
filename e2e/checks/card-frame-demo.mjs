/**
 * Pictures of four card frames side by side, for looking at: the default, a soft shadow with a round
 * corner and no outline, an accent outline inside a small corner, and a dashed outline on a square one.
 * Light and dark, at full size. `FRAME_SHOTS=<folder>` keeps them. Named: `node e2e/run.mjs card-frame-demo`.
 */
import { API, asPerson, canvasFrame, flyToCard, open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
const card = (title, line) => `<style>.doc{padding:24px 26px;font:17px/1.45 var(--b-font);color:var(--b-fg)} h1{font-size:21px;margin:0 0 8px} p{margin:0;color:var(--b-muted)} code{font:14px var(--b-mono)}</style><div class="doc"><h1>${title}</h1><p>${line}</p></div>`;
const frames = [
	["Default", "Nothing set: a 12 px corner and the canvas's thin outline.", {}],
	["Soft", "<code>cornerRadius 20</code>, <code>strokeWidth 0</code>, a shadow 12 down, blurred 32.", { cornerRadius: 20, strokeWidth: 0, effect: { type: "shadow", offset: { x: 0, y: 12 }, blur: 32, color: "#00000059" } }],
	["Accent", "<code>cornerRadius 6</code>, a 3 px blue outline inside the edge.", { cornerRadius: 6, stroke: "$decks-accent-blue", strokeWidth: 3, strokeAlignment: "inner" }],
	["Dashed", "<code>cornerRadius 0</code>, a dashed 2 px outline, as for a draft.", { cornerRadius: 0, stroke: "$decks-line-strong", strokeWidth: 2, strokeDash: "dashed" }],
];
const made = [];
for (const [i, [title, line, set]] of frames.entries()) {
	const one = await call("canvas.insert", [{ type: "card", title, html: card(title, line), width: 300, height: 170 }, { at: { x1: -3000 + i * 360, y1: -3000 } }]);
	if (Object.keys(set).length) await call("canvas.update", [one.value.id, { set }]);
	made.push(one.value.card);
}
say("four framed cards", made.every(Boolean));
for (const scheme of ["light", "dark"]) {
	const { browser, page } = await open({ width: 1600, height: 700, scheme });
	const canvas = await canvasFrame(page);
	await flyToCard(page, made[0]);
	await page.mouse.move(1590, 690);
	for (let i = 0; i < 8; i++) {
		const all = await canvas.evaluate((paths) => paths.map((p) => (globalThis.__decksProbes?.cards?.() ?? []).find((c) => c.path === p)?.rect.toJSON()), made);
		if (all.every((r) => r && r.x > 380 && r.x + r.width < 1580)) break;
		await page.keyboard.press("ControlOrMeta+Minus");
		await settle(page, 300);
	}
	await page.keyboard.press("Escape");
	await settle(page, 3000);
	if (process.env.FRAME_SHOTS) await page.screenshot({ path: `${process.env.FRAME_SHOTS}/demo-${scheme}.png`, clip: { x: 380, y: 150, width: 1220, height: 420 } });
	await browser.close();
}

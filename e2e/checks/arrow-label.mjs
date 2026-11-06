/**
 * An arrow's words (`metadata.label`) are drawn on the middle of its line (`stage/crates/paint`, `arrow_label`).
 * Here two notes joined by an arrow labelled "its tokens": the words show where the line's middle is, in
 * light and dark. `ARROW_SHOTS=<dir>` keeps the pictures.
 */
import { mkdirSync } from "node:fs";
import { API, asPerson, canvasFrame, open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const person = await asPerson();
const call = async (verb, args) => (await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json();
await call("canvas.insert", [{ type: "note", id: "al-a", content: "From" }, { at: { x1: -3000, y1: 0 } }]);
await call("canvas.insert", [{ type: "note", id: "al-b", content: "To" }, { at: { x1: -2200, y1: 300 } }]);
const arrow = await call("canvas.insert", [{ type: "path", id: "al-arrow", metadata: { type: "decks.arrow", from: "al-a", to: "al-b", route: "curved", label: "its tokens" } }]);
say("an arrow with words is on the canvas", arrow.ok === true, JSON.stringify(arrow).slice(0, 200));
const read = await call("canvas.read", [{ of: "al-arrow" }]);
say("…with a line drawn between the notes", (read.value?.items?.[0]?.box?.x2 ?? 0) > (read.value?.items?.[0]?.box?.x1 ?? 0), JSON.stringify(read.value?.items?.[0]?.box ?? null));
const OUT = process.env.ARROW_SHOTS;
if (OUT) mkdirSync(OUT, { recursive: true });
for (const [scheme, live] of [["light", false], ["dark", false], ["light", true]]) {
	const name = `${scheme}${live ? "-browser" : ""}`;
	const shot = await call("canvas.screenshot", [{ of: ["al-a", "al-b", "al-arrow"], scheme, ...(live ? { live: true } : {}), ...(OUT ? { to: `exports/arrow-${name}.png` } : {}) }]);
	say(`${name}: a picture of the notes and the arrow`, shot.ok === true, JSON.stringify(shot).slice(0, 200));
	if (OUT && shot.value?.file) {
		const { copyFileSync } = await import("node:fs");
		const { deckState } = await import("../harness.mjs");
		const deck = await deckState();
		copyFileSync(`${deck.path}/exports/arrow-${name}.png`, `${OUT}/${name}.png`);
	}
}

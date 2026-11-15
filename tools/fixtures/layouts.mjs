// Expected layouts of the fixture drawings, as today's pen lays them out.
// node --import tsx tools/fixtures/layouts.mjs --write writes drawings/<name>.layout.json; without it, it compares.
// Text is measured by pen's estimateText, so any client can match it without a font.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseTheme, parse, placements, warnings } from "../../pen/index.ts";

const DIR = new URL("./drawings/", import.meta.url).pathname;
const round = (n) => Math.round(n * 100) / 100;

/** One drawing's layout: each item's id, box, parent and paint order, in the light theme. */
export function layoutOf(text) {
	const doc = parse(text);
	const placed = placements(doc, { theme: baseTheme(doc, "light") });
	const items = {};
	for (const [id, p] of placed) {
		items[id] = { type: p.node.type, box: { x: round(p.box.x), y: round(p.box.y), w: round(p.box.w), h: round(p.box.h) }, parent: p.parent ?? null, order: p.order };
	}
	return { warnings: doc.children.flatMap((c) => warnings(c)), items };
}

export function drawings() {
	return readdirSync(DIR).filter((f) => f.endsWith(".pen")).sort().map((f) => ({ name: f.slice(0, -4), pen: join(DIR, f), expected: join(DIR, `${f.slice(0, -4)}.layout.json`) }));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	let differs = 0;
	for (const d of drawings()) {
		const now = `${JSON.stringify(layoutOf(readFileSync(d.pen, "utf8")), null, "\t")}\n`;
		if (process.argv.includes("--write")) writeFileSync(d.expected, now);
		else if (readFileSync(d.expected, "utf8") !== now) { differs++; console.error(`${d.name}: pen lays it out differently now`); }
	}
	process.exitCode = differs ? 1 : 0;
}

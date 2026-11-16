import { test } from "node:test";
import assert from "node:assert/strict";
import { baseTheme, clone, estimateText, placements, reroute, type PenDocument } from "@decks/pen";
import { rustRouter } from "./arrows.ts";

test("the server's Rust router reroutes a drawing exactly as pen's own does", () => {
	const box = (id: string, x: number, y: number) => ({ type: "rectangle", id, x, y, width: 120, height: 70 });
	const arrow = (id: string, metadata: Record<string, unknown>) => ({ type: "path", id, geometry: "M0 0 L1 1", strokeWidth: 3, metadata: { type: "decks.arrow", ...metadata } });
	const doc = {
		version: "2.6",
		children: [
			box("a", 0, 0),
			box("b", 400, 160),
			{ type: "frame", id: "f", x: 100, y: 500, width: 300, height: 200, layout: "none", children: [box("c", 40, 40), arrow("in", { from: "c", to: "a", route: "curved", bend: [30, -20] })] },
			arrow("s", { from: "a", to: "b" }),
			arrow("e", { from: { item: "a", side: "right", at: 0.25 }, to: { item: "b", side: "top" }, route: "elbow", bend: 0.3, heads: "both" }),
			arrow("p", { from: [-200, -100], to: "b", route: "curved" }),
			arrow("board", { from: "a", to: "boards/x.html", route: "elbow" }),
			arrow("lost", { from: "a", to: "nowhere" }),
		],
	} as unknown as PenDocument;
	const placed = placements(doc, { theme: baseTheme(doc, "light"), measure: estimateText });
	const boards = (name: string) => (name === "boards/x.html" ? { x: 900, y: -300, w: 400, h: 300 } : undefined);
	const ts = clone(doc);
	const rust = clone(doc);
	assert.equal(reroute(ts, placed, boards), true);
	assert.equal(reroute(rust, placed, boards, rustRouter), true);
	assert.deepEqual(rust, ts);
});

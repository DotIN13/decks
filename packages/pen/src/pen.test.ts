import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, baseTheme, color, emptyDocument, expand, layout, arrowRoute, arrowShape, arrowStyle, fillsOf, moveArrowEnds, parse, parseColor, pathBounds, read, reroute, serialize, strokeOf, toHex, variable, type PenDocument, type TextStyle } from "./index.ts";

/** A fixed-width font, so text boxes are exact: every character is half its size wide. */
const mono = (text: string, style: TextStyle, maxWidth: number | undefined) => {
	const perChar = style.fontSize / 2;
	const lineH = style.fontSize * (style.lineHeight ?? 1.2);
	if (maxWidth === undefined) return { w: Math.max(...text.split("\n").map((l) => l.length)) * perChar, h: text.split("\n").length * lineH };
	const perLine = Math.max(1, Math.floor(maxWidth / perChar));
	const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
	return { w: Math.min(maxWidth, text.length * perChar), h: lines * lineH };
};
const light = { theme: {}, measure: mono };

const boxes = (doc: PenDocument) => {
	const placed = layout(doc, expand(doc), light);
	return Object.fromEntries([...placed].map(([id, p]) => [id, [p.box.x, p.box.y, p.box.w, p.box.h]]));
};

test("parse refuses a document without children, and ids with a slash or used twice", () => {
	assert.throws(() => parse("{}"), /children/);
	assert.throws(() => parse('{"children":[{"type":"note","id":"a/b"}]}'), /contains "\/"/);
	assert.throws(() => parse('{"children":[{"type":"note","id":"a"},{"type":"note","id":"a"}]}'), /twice/);
	const doc = parse('{"version":"2.8","children":[{"type":"note","id":"n","content":"hi","mystery":{"kept":true}}]}');
	assert.equal(doc.version, "2.8");
	assert.match(serialize(doc), /"mystery": \{\n\s+"kept": true/);
});

test("a frame lays its children in a row by default, with gap and padding", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "frame", id: "row", x: 10, y: 20, gap: 8, padding: [4, 6], children: [
			{ type: "rectangle", id: "a", width: 30, height: 10 },
			{ type: "rectangle", id: "b", width: 20, height: 40 },
		] },
	] }));
	const b = boxes(doc);
	assert.deepEqual(b.row, [10, 20, 6 + 30 + 8 + 20 + 6, 4 + 40 + 4]);
	assert.deepEqual(b.a, [16, 24, 30, 10]);
	assert.deepEqual(b.b, [16 + 30 + 8, 24, 20, 40]);
});

test("fill_container shares the room left; alignItems and justifyContent place the rest", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "frame", id: "col", layout: "vertical", width: 100, height: 200, alignItems: "center", children: [
			{ type: "rectangle", id: "top", width: 40, height: 50 },
			{ type: "rectangle", id: "grow", width: "fill_container", height: "fill_container" },
		] },
		{ type: "frame", id: "spread", x: 300, width: 100, height: 10, justifyContent: "space_between", children: [
			{ type: "rectangle", id: "l", width: 10, height: 10 },
			{ type: "rectangle", id: "r", width: 10, height: 10 },
		] },
	] }));
	const b = boxes(doc);
	assert.deepEqual(b.top, [30, 0, 40, 50]);
	assert.deepEqual(b.grow, [0, 50, 100, 150]);
	assert.deepEqual(b.r, [390, 0, 10, 10]);
});

test("layout none places children at their own x and y; a group is the box around its children", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "frame", id: "free", x: 100, y: 100, layout: "none", children: [{ type: "ellipse", id: "e", x: 10, y: 5, width: 20, height: 20 }] },
		{ type: "group", id: "g", x: 500, y: 0, children: [{ type: "rectangle", id: "r1", x: 0, y: 0, width: 10, height: 10 }, { type: "rectangle", id: "r2", x: 30, y: 40, width: 10, height: 10 }] },
	] }));
	const b = boxes(doc);
	assert.deepEqual(b.free, [100, 100, 30, 25]);
	assert.deepEqual(b.e, [110, 105, 20, 20]);
	assert.deepEqual(b.g, [500, 0, 40, 50]);
	assert.deepEqual(b.r2, [530, 40, 10, 10]);
});

test("text sizes itself by textGrowth, and a note is a card around its words", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "text", id: "auto", content: "hello", fontSize: 20 },
		{ type: "text", id: "wrap", y: 100, content: "abcdefghij", fontSize: 10, textGrowth: "fixed-width", width: 25, lineHeight: 1 },
		{ type: "note", id: "n", y: 200, content: "hi", fontSize: 10, lineHeight: 1, width: 100 },
	] }));
	const b = boxes(doc);
	assert.deepEqual(b.auto, [0, 0, 50, 24]);
	assert.deepEqual(b.wrap, [0, 100, 25, 20]);
	assert.deepEqual(b.n, [0, 200, 100, 10 + 32]);
});

test("a ref copies its reusable item, lays its own fields over it, and overrides inside by id path", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "frame", id: "card", reusable: true, width: 100, height: 40, fill: "#fff", children: [{ type: "text", id: "label", content: "Agent" }] },
		{ type: "frame", id: "button", reusable: true, width: 30, height: 30, children: [{ type: "text", id: "caption", content: "ok" }] },
		{ type: "frame", id: "dialog", reusable: true, layout: "vertical", children: [{ type: "ref", id: "ok", ref: "button" }] },
		{ type: "ref", id: "c1", ref: "card", x: 200, y: 0, fill: "#000", descendants: { label: { content: "Wren" } } },
		{ type: "ref", id: "d1", ref: "dialog", x: 400, descendants: { "ok/caption": { content: "yes" } } },
		{ type: "ref", id: "bad", ref: "nothing" },
	] }));
	const expanded = expand(doc);
	const c1 = expanded.find((n) => n.id === "c1")!;
	assert.equal(c1.type, "frame");
	assert.equal(c1.fill, "#000");
	assert.equal(c1.reusable, undefined);
	assert.equal(c1.children![0]!.id, "c1/label");
	assert.equal(c1.children![0]!.content, "Wren");
	const d1 = expanded.find((n) => n.id === "d1")!;
	assert.equal(d1.children![0]!.id, "d1/ok");
	assert.equal(d1.children![0]!.children![0]!.id, "d1/ok/caption");
	assert.equal(d1.children![0]!.children![0]!.content, "yes");
	assert.equal(expanded.find((n) => n.id === "bad")!.type, "missing");
	// The document itself is untouched.
	assert.equal(doc.children[3]!.type, "ref");
});

test("variables follow the theme, and both stroke spellings are read", () => {
	const doc = parse(JSON.stringify({
		version: "2.14",
		themes: { Mode: ["Light", "Dark"] },
		variables: { "--bg": { type: "color", value: [{ value: "#ffffff" }, { value: "#000000", theme: { Mode: "Dark" } }] }, alias: { type: "color", value: "$--bg" } },
		children: [
			{ type: "rectangle", id: "new", stroke: "#ff0000", strokeWidth: 2, strokeAlignment: "inner" },
			{ type: "rectangle", id: "old", stroke: { align: "outside", thickness: { right: 3 }, fill: "#00ff00" } },
		],
	}));
	assert.deepEqual(color(doc, "$--bg", baseTheme(doc, "light")), [1, 1, 1, 1]);
	assert.deepEqual(color(doc, "$alias", baseTheme(doc, "dark")), [0, 0, 0, 1]);
	assert.equal(variable(doc, "missing", {}), undefined);
	const s1 = strokeOf(doc, doc.children[0]!, {})!;
	assert.deepEqual([s1.widths, s1.align], [[2, 2, 2, 2], "inner"]);
	const s2 = strokeOf(doc, doc.children[1]!, {})!;
	assert.deepEqual([s2.widths, s2.align, s2.fills], [[0, 3, 0, 0], "outer", ["#00ff00"]]);
});

test("path bounds come from the geometry when there is no viewBox", () => {
	assert.deepEqual(pathBounds("M10 10 L 30 50 H 5 Z"), { x: 5, y: 10, w: 25, h: 40 });
	assert.deepEqual(pathBounds("m0 0 l10 0 l0 10"), { x: 0, y: 0, w: 10, h: 10 });
	const doc = parse(JSON.stringify({ version: "2.14", children: [{ type: "path", id: "p", x: 5, y: 5, geometry: "M0 0 L 40 20" }] }));
	assert.deepEqual(boxes(doc).p, [5, 5, 40, 20]);
});

test("an arc is measured where it is drawn, not out to its radii", () => {
	// A circle drawn as two half-circles: bounded by its radii around both ends it came out 100 by 200.
	assert.deepEqual(pathBounds("M50 0A50 50 0 1 1 50 100A50 50 0 1 1 50 0Z"), { x: 0, y: 0, w: 100, h: 100 });
	// The cylinder, whose flat 50 by 14 arcs used to make it 200 wide.
	assert.deepEqual(pathBounds("M0 14A50 14 0 0 1 100 14V86A50 14 0 0 1 0 86Z"), { x: 0, y: 0, w: 100, h: 100 });
	assert.deepEqual(pathBounds("M0 0A10 10 0 0 1 10 10"), { x: 0, y: 0, w: 10, h: 10 });
	// A quarter arc passes no extreme of its own ellipse, so it is just its two ends.
	const quarter = pathBounds("M0 10A10 10 0 0 1 10 0")!;
	assert.ok(Math.abs(quarter.w - 10) < 1e-9 && Math.abs(quarter.h - 10) < 1e-9 && quarter.x === 0, JSON.stringify(quarter));
	// A rotated ellipse's extremes are not its quadrant points. Checked against a browser's getBBox.
	const turned = pathBounds("M0 0A10 5 90 0 1 10 10")!;
	assert.ok(Math.abs(turned.y + 6.1803) < 0.01 && Math.abs(turned.h - 16.1803) < 0.01, JSON.stringify(turned));
	// A radius of zero is a straight line, which is what SVG draws.
	assert.deepEqual(pathBounds("M10 10A0 20 0 0 1 40 40"), { x: 10, y: 10, w: 30, h: 30 });
	// Radii too small to reach both ends are grown until they just do, so this is a half-circle of radius 10.
	const grown = pathBounds("M0 0A2 2 0 0 1 20 0")!;
	assert.ok(grown.x === 0 && Math.abs(grown.y + 10) < 1e-9 && Math.abs(grown.w - 20) < 1e-9 && Math.abs(grown.h - 10) < 1e-9, JSON.stringify(grown));
});

test("edits: insert with a stage box inside a free frame writes pen's relative numbers", () => {
	const doc: PenDocument = { ...emptyDocument(), children: [{ type: "frame", id: "sec", x: -40, y: -120, width: 1340, height: 1320, layout: "none", children: [] }] };
	const { doc: next, results } = apply(doc, [{ op: "insert", parent: "sec", node: { type: "note", id: "restart", content: "Restart first" }, box: { x1: 620, y1: 0, x2: 860, y2: 90 } }], light);
	const note = next.children[0]!.children![0]!;
	assert.deepEqual([note.x, note.y, note.width, note.height], [660, 120, 240, 90]);
	assert.equal(results[0]!.id, "restart");
	const view = read(next, light);
	assert.deepEqual(view.children[0]!.children![0]!.box, { x1: 620, y1: 0, x2: 860, y2: 90 });
	// The original is untouched.
	assert.equal(doc.children[0]!.children!.length, 0);
});

test("edits: inside a row layout the box only sizes; update, move, copy and delete by id", () => {
	const doc: PenDocument = { ...emptyDocument(), children: [{ type: "frame", id: "row", children: [{ type: "rectangle", id: "a", width: 10, height: 10 }] }, { type: "frame", id: "other", layout: "none", children: [] }] };
	const step = apply(doc, [
		{ op: "insert", parent: "row", node: { type: "rectangle", id: "b" }, box: { x1: 500, y1: 500, x2: 520, y2: 530 } },
		{ op: "update", id: "a", set: { fill: "#f00", width: 12 } },
		{ op: "copy", id: "a", as: "a2" },
		{ op: "move", id: "b", parent: "other", box: { x1: 5, y1: 6 } },
		{ op: "delete", id: "a2" },
	], light);
	const [row, other] = step.doc.children;
	assert.match(step.results[0]!.note ?? "", /decides where b goes/);
	assert.deepEqual(row!.children!.map((n) => n.id), ["a"]);
	assert.equal(row!.children![0]!.fill, "#f00");
	assert.deepEqual(other!.children!.map((n) => [n.id, n.x, n.y, n.width, n.height]), [["b", 5, 6, 20, 30]]);
});

test("edits fail as a whole with a sentence naming the edit", () => {
	const doc: PenDocument = { ...emptyDocument(), children: [{ type: "note", id: "n" }] };
	assert.throws(() => apply(doc, [{ op: "update", id: "n", set: { content: "ok" } }, { op: "delete", id: "nope" }], light), /Edit 2 \(delete\) failed, and nothing was saved: no item "nope"/);
	assert.throws(() => apply(doc, [{ op: "insert", node: { type: "note", id: "n" } }], light), /already used/);
	assert.throws(() => apply(doc, [{ op: "move", id: "n", parent: "n" }], light), /inside itself|only a frame/);
});

test("edits: an update inside an instance goes to its descendants", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "frame", id: "card", reusable: true, children: [{ type: "text", id: "label", content: "Agent" }] },
		{ type: "ref", id: "c1", ref: "card", x: 300 },
	] }));
	const { doc: next } = apply(doc, [{ op: "update", id: "c1/label", set: { content: "Wren" } }], light);
	assert.deepEqual(next.children[1]!.descendants, { label: { content: "Wren" } });
	const view = read(next, light);
	assert.equal(view.children[1]!.inside![0]!.id, "c1/label");
	assert.equal(view.children[1]!.inside![0]!.content, "Wren");
	assert.throws(() => apply(doc, [{ op: "update", id: "card/label", set: { content: "x" } }], light), /not an instance/);
});

test("an arrow is redrawn between the facing edges of its ends, and follows them", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 },
		{ type: "rectangle", id: "b", x: 300, y: 0, width: 100, height: 50 },
		{ type: "path", id: "ab", metadata: { type: "decks.arrow", from: "a", to: "b" } },
		{ type: "path", id: "toBoard", metadata: { type: "decks.arrow", from: "a", to: "boards/x.html", route: "elbow" } },
	] }));
	const placed = layout(doc, expand(doc), light);
	const board = { x: 0, y: 400, w: 200, h: 100 };
	assert.equal(reroute(doc, placed, (name) => (name === "boards/x.html" ? board : undefined)), true);
	const ab = doc.children[2]!;
	// From a's right edge (100, 25) to b's left edge (300, 25), with the head inside the box.
	assert.equal(ab.x! <= 100 && ab.x! + (ab.width as number) >= 300, true);
	assert.match(ab.geometry!, /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ M/);
	assert.equal(ab.stroke, "#8a8f98");
	// Going down to the board: from a's bottom edge.
	const down = doc.children[3]!;
	assert.equal(down.y! <= 50 && down.y! + (down.height as number) >= 400, true);
	// Moving b moves the arrow; nothing moving changes nothing.
	const again = layout(doc, expand(doc), light);
	assert.equal(reroute(doc, again, (name) => (name === "boards/x.html" ? board : undefined)), false);
	doc.children[1]!.x = 600;
	assert.equal(reroute(doc, layout(doc, expand(doc), light), () => board), true);
	assert.equal((ab.x as number) + (ab.width as number) >= 600, true);
});

test("an arrow end can be a point on the stage, which a move shifts and a joined end ignores", () => {
	const doc = parse(JSON.stringify({ version: "2.14", children: [
		{ type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 },
		{ type: "path", id: "half", metadata: { type: "decks.arrow", from: "a", to: [400, 25] } },
		{ type: "path", id: "free", metadata: { type: "decks.arrow", from: [0, 200], to: [100, 300] } },
	] }));
	assert.equal(reroute(doc, layout(doc, expand(doc), light)), true);
	const half = doc.children[1]!;
	// From a's right edge to the point: the head reaches 400 and stops there.
	assert.equal(half.x! <= 100, true);
	assert.equal(Math.abs(half.x! + (half.width as number) - 400) <= 2, true);
	const free = doc.children[2]!;
	assert.equal(free.x! <= 0 && free.y! <= 200 && free.y! + (free.height as number) >= 300, true);
	assert.deepEqual(moveArrowEnds(free.metadata!, 10, -5), { type: "decks.arrow", from: [10, 195], to: [110, 295] });
	assert.deepEqual(moveArrowEnds(half.metadata!, 10, 10).from, "a");
});

test("the variables edit sets and removes document variables and theme axes", () => {
	const doc: PenDocument = { ...emptyDocument(), children: [] };
	const { doc: next } = apply(doc, [{ op: "variables", set: { card: { type: "color", value: [{ value: "#fff" }, { value: "#111", theme: { Mode: "Dark" } }] } }, themes: { Mode: ["Light", "Dark"] } }], light);
	assert.deepEqual(next.themes, { Mode: ["Light", "Dark"] });
	assert.deepEqual(color(next, "$card", baseTheme(next, "dark")), [0x11 / 255, 0x11 / 255, 0x11 / 255, 1]);
	assert.throws(() => apply(next, [{ op: "variables", set: { "a:b": { type: "color", value: "#fff" } } }], light), /no colon/);
	const { doc: gone } = apply(next, [{ op: "variables", set: { card: null } }], light);
	assert.deepEqual(gone.variables, {});
});

test("a group's box is the box round its children, and moving it by a box shifts it by the difference", () => {
	const doc: PenDocument = {
		version: "2.14",
		children: [{ type: "group", id: "g", children: [
			{ type: "rectangle", id: "a", x: 100, y: 50, width: 20, height: 10 },
			{ type: "rectangle", id: "b", x: 150, y: 80, width: 30, height: 30 },
		] }],
	};
	const theme = {};
	assert.deepEqual(layout(doc, expand(doc), { theme }).get("g")!.box, { x: 100, y: 50, w: 80, h: 60 });
	const { doc: moved, results } = apply(doc, [{ op: "update", id: "g", box: { x1: 110, y1: 40, x2: 999, y2: 999 } }], { theme });
	const group = moved.children[0]!;
	assert.equal(group.x, 10);
	assert.equal(group.y, -10);
	assert.equal(group.width, undefined);
	assert.match(results[0]!.note ?? "", /moved but not resized/);
	assert.deepEqual(layout(moved, expand(moved), { theme }).get("g")!.box, { x: 110, y: 40, w: 80, h: 60 });
});

test("an arrow's style: straight by default, a curve square to both edges, an elbow, and its heads", () => {
	const a = { x: 0, y: 0, w: 100, h: 100 };
	const b = { x: 300, y: 200, w: 100, h: 100 };
	assert.deepEqual(arrowStyle(undefined), { route: "straight", heads: "end", dash: false });
	assert.deepEqual(arrowStyle({ route: "curved", heads: "both", dash: true }), { route: "curved", heads: "both", dash: true });
	assert.equal(arrowRoute(a, b, "straight").length, 2);
	const curve = arrowRoute(a, b, "curved");
	assert.deepEqual(curve, [[100, 50], [200, 50], [200, 250], [300, 250]]);
	assert.equal(arrowRoute(a, b, "elbow").length, 4);
	assert.equal(arrowRoute(a, b, true).length, 4);
	const curved = arrowShape(curve, 2, { route: "curved" });
	assert.match(curved.geometry, /^M\S+ \S+ C/);
	assert.equal(curved.geometry.split("M").length - 1, 2);
	assert.equal(arrowShape(curve, 2, { route: "curved", heads: "both" }).geometry.split("M").length - 1, 3);
	assert.equal(arrowShape([[0, 0], [100, 0]], 2, { heads: "none" }).geometry, "M2 2 L102 2");
});

test("a ref names an item in an imported file as name:id, and its variables come from that file", () => {
	const components = parse(
		JSON.stringify({
			version: "2.14",
			variables: { "color.card": { type: "color", value: "#123456" } },
			children: [
				{ id: "badge", type: "rectangle", reusable: true, width: 20, height: 10 },
				{ id: "agent-card", type: "frame", reusable: true, layout: "vertical", width: 100, height: "fit_content", fill: "$color.card", children: [{ id: "title", type: "text", content: "Agent" }, { id: "mark", type: "ref", ref: "badge" }] },
			],
		}),
	);
	const doc = parse(
		JSON.stringify({
			version: "2.14",
			imports: { deck: "../../components.pen" },
			children: [
				{ id: "wren", type: "ref", ref: "deck:agent-card", x: 10, y: 20, descendants: { title: { content: "Wren" } } },
				{ id: "lost", type: "ref", ref: "nowhere:card", width: 30, height: 30 },
			],
		}),
	);
	doc["decks.imported"] = { deck: components };
	const [wren, lost] = expand(doc);
	assert.equal(wren!.type, "frame");
	assert.equal(wren!.children![0]!.content, "Wren");
	assert.equal(wren!.children![1]!.type, "rectangle", "a ref inside the imported item resolves in that file");
	assert.equal(wren!.children![1]!.id, "wren/mark");
	assert.equal(lost!.type, "missing");
	assert.deepEqual(color(doc, wren!.fill, {}), [0x12 / 255, 0x34 / 255, 0x56 / 255, 1], "the imported file's variable");
});

test("a slot frame takes its children from the instance, and refs among them are expanded", () => {
	const doc = parse(
		JSON.stringify({
			version: "2.14",
			children: [
				{ id: "chip", type: "rectangle", reusable: true, width: 12, height: 12 },
				{ id: "panel", type: "frame", reusable: true, layout: "vertical", children: [{ id: "body", type: "frame", slot: ["chip"], layout: "horizontal", children: [] }] },
				{ id: "p1", type: "ref", ref: "panel", descendants: { body: { children: [{ id: "c1", type: "ref", ref: "chip" }, { id: "t", type: "text", content: "hi" }] } } },
			],
		}),
	);
	const p1 = expand(doc)[2]!;
	const body = p1.children![0]!;
	assert.deepEqual(body.children!.map((c) => [c.id, c.type]), [["p1/c1", "rectangle"], ["p1/t", "text"]]);
});

test("a curve is measured where it goes, not out to its control points", () => {
	// Both control points sit 50 above the ends, and the curve itself reaches 37.5 of that.
	const arch = pathBounds("M0 50C0 0 100 0 100 50")!;
	assert.ok(Math.abs(arch.y - 12.5) < 1e-9 && Math.abs(arch.h - 37.5) < 1e-9, JSON.stringify(arch));
	// A quadratic, the curve the rounded corners are drawn with.
	const hump = pathBounds("M0 0Q50 100 100 0")!;
	assert.ok(Math.abs(hump.h - 50) < 1e-9, JSON.stringify(hump));
	// S and T mirror the last control point, so their curve is not measured as a straight line.
	const smooth = pathBounds("M0 0Q50 100 100 0T200 0")!;
	assert.ok(Math.abs(smooth.y + 50) < 1e-9 && Math.abs(smooth.h - 100) < 1e-9, JSON.stringify(smooth));
});

test("a colour is read in any notation somebody is likely to write", () => {
	/*
	 * Hex alone is what pen.dev writes, and hex alone was all this read — so a card filled
	 * "lightblue" drew its default paper with nothing said, which reads as "fill is ignored here".
	 */
	assert.equal(toHex(parseColor("#bfdbfe")), "#bfdbfe");
	assert.equal(toHex(parseColor("#abf")), "#aabbff");
	assert.equal(toHex(parseColor("#bfdbfeff")), "#bfdbfe");
	assert.equal(toHex(parseColor("LightBlue")), "#add8e6");
	assert.equal(toHex(parseColor(" white ")), "#ffffff");
	assert.equal(toHex(parseColor("rgb(191, 219, 254)")), "#bfdbfe");
	assert.equal(toHex(parseColor("hsl(210, 100%, 87%)")), "#bddeff");
	assert.equal(parseColor("rgba(191,219,254,0.5)")?.[3], 0.5);
	assert.equal(parseColor("hsla(210 100% 87% / 0.4)")?.[3], 0.4);
	assert.deepEqual(parseColor("transparent"), [0, 0, 0, 0]);
	// And nothing is read as a colour that is not one, so the note below can be trusted.
	for (const junk of ["periwinkleish", "", "#12345", "rgb(1, 2)", "url(x.png)", 12]) assert.equal(parseColor(junk), undefined, String(junk));
});

test("a fill written as solid is pen's own colour fill", () => {
	// Nobody writes `{ type: "color" }` first time; it is read as that, and stored as that.
	assert.deepEqual(fillsOf({ type: "solid", color: "#bfdbfe" }), [{ type: "color", color: "#bfdbfe" }]);
	const theme = baseTheme(emptyDocument(), "light");
	const { doc } = apply(emptyDocument(), [{ op: "insert", node: { type: "note", id: "a", content: "x", fill: { type: "solid", color: "#bfdbfe" } } }], { theme });
	assert.deepEqual(doc.children[0]!.fill, { type: "color", color: "#bfdbfe" });
});

test("a colour nobody can read is said, not drawn as nothing", () => {
	const theme = baseTheme(emptyDocument(), "light");
	const bad = apply(emptyDocument(), [{ op: "insert", node: { type: "note", id: "a", content: "x", fill: "periwinkleish" } }], { theme });
	assert.match(bad.results[0]!.note ?? "", /is not a colour and draws nothing/);
	const fine = apply(emptyDocument(), [{ op: "insert", node: { type: "note", id: "a", content: "x", fill: "lightblue" } }], { theme });
	assert.equal(fine.results[0]!.note, undefined);
	// A variable is resolved against the document, not parsed here.
	const vars = apply(emptyDocument(), [{ op: "variables", set: { paper: { type: "color", value: "#bfdbfe" } } }, { op: "insert", node: { type: "note", id: "a", content: "x", fill: "$paper" } }], { theme });
	assert.equal(vars.results[1]!.note, undefined);
});

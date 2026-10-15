// The C++ scene's layout against `layout` in @decks/pen, which is the reference: every saved stage
// on this machine, and thousands of made-up documents that reach every rule.
// node --import tsx packages/engine/test/layout-diff.mjs [made-up count]
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { baseTheme, estimateText, expand, layout, parse } from "@decks/pen";
import { loadScene } from "../src/scene.ts";

const scene = await loadScene();
let failed = 0;
let compared = 0;
const close = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

function compare(name, doc, measure = estimateText) {
	for (const mode of ["light", "dark"]) {
		const theme = baseTheme(doc, mode);
		const nodes = expand(doc);
		const want = layout(doc, nodes, { theme, measure });
		const got = scene.layout(doc, nodes, { theme, measure });
		compared++;
		const wantKeys = [...want.keys()];
		const gotKeys = [...got.keys()];
		let problem = wantKeys.length !== gotKeys.length ? `${wantKeys.length} items placed, C++ placed ${gotKeys.length}` : "";
		for (let i = 0; !problem && i < wantKeys.length; i++) {
			const a = want.get(wantKeys[i]);
			const b = got.get(wantKeys[i]);
			if (!b) problem = `${wantKeys[i]} not placed by C++`;
			else if (wantKeys[i] !== gotKeys[i]) problem = `order differs at ${i}: ${wantKeys[i]} vs ${gotKeys[i]}`;
			else if (!close(a.box.x, b.box.x) || !close(a.box.y, b.box.y) || !close(a.box.w, b.box.w) || !close(a.box.h, b.box.h)) problem = `${wantKeys[i]} (${a.node.type}) at ${JSON.stringify(a.box)}, C++ ${JSON.stringify(b.box)}`;
			else if (a.parent !== b.parent || a.order !== b.order) problem = `${wantKeys[i]} parent/order ${a.parent}/${a.order} vs ${b.parent}/${b.order}`;
			else if (JSON.stringify(a.theme) !== JSON.stringify(b.theme)) problem = `${wantKeys[i]} theme differs`;
		}
		if (problem) {
			failed++;
			if (failed <= 12) console.log(`FAIL ${name} (${mode}): ${problem}`);
		}
	}
}

// Every saved stage and frame on this machine.
const files = execSync("find /home/decks/data/decks /mnt/data/decks-data/worktrees -name '*.pen' -not -path '*/node_modules/*' 2>/dev/null || true", { encoding: "utf8" }).split("\n").filter(Boolean);
let saved = 0;
for (const file of files) {
	let doc;
	try {
		doc = parse(readFileSync(file, "utf8"));
	} catch {
		continue;
	}
	saved++;
	compare(file, doc);
}

// Made-up documents: a seeded random tree that uses every rule the layout has.
let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const size = () => pick([undefined, undefined, Math.round(rand() * 300), "fit_content", "fill_container", "fill_container(120)", "fit_content(80)", "hug_content", "$size", "$missing", "77"]);
let next = 0;
function item(depth) {
	const type = pick(depth > 3 ? ["rectangle", "text", "note", "ellipse", "icon_font", "path", "prompt"] : ["frame", "frame", "group", "rectangle", "text", "note", "path", "ellipse", "icon_font", "context", "frame"]);
	const node = { type, id: `n${next++}` };
	if (chance(0.7)) node.x = Math.round(rand() * 400 - 100);
	if (chance(0.7)) node.y = Math.round(rand() * 400 - 100);
	const w = size(), h = size();
	if (w !== undefined) node.width = w;
	if (h !== undefined) node.height = h;
	if (chance(0.08)) node.enabled = pick([false, "$shown"]);
	if (chance(0.15)) node.layoutPosition = "absolute";
	if (chance(0.1)) node.theme = { Mode: pick(["Light", "Dark"]) };
	if (type === "frame") {
		if (chance(0.8)) node.layout = pick(["horizontal", "vertical", "none", "bogus"]);
		if (chance(0.6)) node.padding = pick([8, [4, 12], [1, 2, 3, 4], "$pad"]);
		if (chance(0.6)) node.gap = pick([0, 6, 12, "$gap"]);
		if (chance(0.6)) node.justifyContent = pick(["start", "center", "end", "space_between", "space_around", "weird"]);
		if (chance(0.6)) node.alignItems = pick(["start", "center", "end", "stretch"]);
	}
	if (type === "text" || type === "note" || type === "prompt" || type === "context") {
		node.content = pick(["Hello", "A longer sentence that will need to wrap somewhere", "多语言的文字", "two\nlines", "", "$label"]);
		if (chance(0.5)) node.fontSize = pick([12, 20, 32, "$fs"]);
		if (chance(0.5)) node.textGrowth = pick(["auto", "fixed-width", "fixed-width-height"]);
		if (chance(0.3)) node.lineHeight = pick([1, 1.5]);
		if (chance(0.3)) node.letterSpacing = 1;
	}
	if (type === "path") {
		node.geometry = pick(["M0 0 L100 50 L20 80 Z", "M10 10 C 40 0, 80 90, 120 30", "bogus"]);
		if (chance(0.3)) node.viewBox = [0, 0, 50, 40];
	}
	if ((type === "frame" || type === "group") && depth < 5) {
		node.children = [];
		const n = Math.floor(rand() * 5);
		for (let i = 0; i < n; i++) node.children.push(item(depth + 1));
	}
	return node;
}
const variables = {
	size: { type: "number", value: [{ value: 140 }, { value: 90, theme: { Mode: "Dark" } }] },
	pad: { type: "number", value: 10 },
	gap: { type: "number", value: [{ value: 4 }, { value: 20, theme: { Mode: "Dark" } }] },
	fs: { type: "number", value: 18 },
	shown: { type: "boolean", value: [{ value: true }, { value: false, theme: { Mode: "Dark" } }] },
	label: { type: "string", value: "From a variable" },
};
const made = Number(process.argv[2] ?? 3000);
for (let i = 0; i < made; i++) {
	next = 0;
	const doc = { version: "2.6", themes: { Mode: ["Light", "Dark"] }, variables, children: Array.from({ length: 1 + Math.floor(rand() * 4) }, () => item(0)) };
	// Half measured by the estimate, half by a different fake font, as the browser's would differ.
	const measure = i % 2 ? estimateText : (text, style, max) => ({ w: Math.min(max ?? 1e9, text.length * style.fontSize * 0.6), h: style.fontSize * 1.3 * (1 + Math.floor((text.length * style.fontSize * 0.6) / Math.max(1, max ?? 1e9))) });
	compare(`made-up #${i}`, doc, measure);
}
console.log(`${saved} saved files and ${made} made-up documents, ${compared} layouts compared: ${failed ? `${failed} differ` : "all the same"}`);
process.exit(failed ? 1 : 0);

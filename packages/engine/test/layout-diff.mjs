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

function compare(name, doc, measure = estimateText, using = scene, measureKey = undefined, modes = ["light", "dark"]) {
	for (const mode of modes) {
		const theme = baseTheme(doc, mode);
		const nodes = expand(doc);
		const want = layout(doc, nodes, { theme, measure });
		const got = using.layout(doc, nodes, { theme, measure, measureKey });
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
// One scene kept through a long run of edits, as the page keeps it: after each edit its layout must
// still be a fresh TypeScript layout's, and an unchanged drawing must measure nothing.
const kept = await loadScene();
let edits = 0;
let idleMeasures = 0;
let fontVersion = 0;
const fontMeasure = (text, style, max) => {
	const per = style.fontSize * (0.5 + fontVersion * 0.05);
	const w = text.length * per;
	return { w: Math.min(max ?? 1e9, w), h: style.fontSize * 1.25 * (1 + Math.floor(w / Math.max(1, max ?? 1e9))) };
};
const all = (node, out = []) => (out.push(node), (node.children ?? []).forEach((child) => all(child, out)), out);
for (let run = 0; run < 40; run++) {
	next = 0;
	const doc = { version: "2.6", themes: { Mode: ["Light", "Dark"] }, variables: structuredClone(variables), children: Array.from({ length: 2 + Math.floor(rand() * 3) }, () => item(0)) };
	for (let step = 0; step < 60; step++) {
		const nodes = doc.children.flatMap((node) => all(node));
		const target = pick(nodes);
		const what = Math.floor(rand() * 9);
		if (what === 0) target.width = size();
		else if (what === 1 && "content" in target) target.content = pick(["Changed", "A new longer sentence to wrap here and there", ""]);
		else if (what === 2) target.enabled = pick([true, false, undefined]);
		else if (what === 3 && target.children) target.children.push(item(3));
		else if (what === 4 && target.children?.length) target.children.splice(Math.floor(rand() * target.children.length), 1);
		else if (what === 5 && target.children?.length > 1) target.children.reverse();
		else if (what === 6) doc.variables.size.value[0].value = Math.round(rand() * 200);
		else if (what === 7) fontVersion++;
		else if (what === 8 && doc.children.length > 1) doc.children.push(doc.children.shift());
		else target.x = Math.round(rand() * 300);
		edits++;
		compare(`edit ${run}.${step}`, doc, fontMeasure, kept, `fonts ${fontVersion}`, ["light"]);
	}
	// Laid out again with nothing changed: nothing is sent and nothing measured.
	compare(`unchanged ${run}`, doc, fontMeasure, kept, `fonts ${fontVersion}`, ["light"]);
	if (kept.last.sent !== 0) { failed++; console.log(`FAIL unchanged ${run}: ${kept.last.sent} records sent`); }
	idleMeasures += kept.last.measured;
}
if (idleMeasures) { failed++; console.log(`FAIL an unchanged drawing measured ${idleMeasures} times`); }
console.log(`kept scene: ${edits} edits laid out, ${kept.last.held} items held at the end`);
console.log(`${saved} saved files and ${made} made-up documents, ${compared} layouts compared: ${failed ? `${failed} differ` : "all the same"}`);
process.exit(failed ? 1 : 0);

import assert from "node:assert/strict";
import { test } from "node:test";
import { tailwindClass, toHtml } from "./html.ts";
import type { PenDocument } from "./types.ts";

const doc = (children: unknown[], more: Partial<PenDocument> = {}): PenDocument => ({ version: "2.6", children, ...more }) as PenDocument;
/** The style written on an item, by its id. */
const styleOf = (page: string, id: string) => new RegExp(`data-pen-id="${id}"[^>]*style="([^"]*)"`).exec(page)?.[1] ?? "";

test("a frame with a layout is a flexbox, its fills along it flex 1 and across it stretch", () => {
	const page = toHtml(
		doc([
			{ type: "frame", id: "row", width: 400, height: 100, layout: "horizontal", gap: 8, padding: [4, 12], justifyContent: "space_between", alignItems: "center", children: [
				{ type: "rectangle", id: "a", width: "fill_container", height: "fill_container", fill: "#f00" },
				{ type: "frame", id: "b", layout: "vertical", children: [{ type: "text", id: "t", content: "hi" }] },
			] },
		]),
		["row"],
		{ format: "html" },
	);
	assert.match(styleOf(page, "row"), /width: 400px; height: 100px; display: flex; flex-direction: row; gap: 8px; padding: 4px 12px 4px 12px; justify-content: space-between; align-items: center/);
	assert.match(styleOf(page, "a"), /^flex: 1 1 0px; min-width: 0; align-self: stretch;/);
	// fit_content (the default) writes no size: the content gives it.
	assert.doesNotMatch(styleOf(page, "b"), /width|height:/);
	assert.match(styleOf(page, "t"), /white-space: pre/);
});

test("a fill inside a frame that hugs has nothing to fill, and is the size pen gives it", () => {
	const page = toHtml(doc([{ type: "frame", id: "f", layout: "horizontal", children: [{ type: "rectangle", id: "r", width: "fill_container(50)", height: 10 }] }]), ["f"], { format: "html" });
	assert.match(styleOf(page, "r"), /width: 50px; flex-shrink: 0; height: 10px/);
});

test("a frame with no layout holds its children where pen puts them, and its stroke goes over them", () => {
	const page = toHtml(
		doc([{ type: "frame", id: "f", x: 100, y: 100, layout: "none", width: 200, height: 120, cornerRadius: 8, stroke: "#000", strokeWidth: 2, strokeAlignment: "inner", children: [{ type: "ellipse", id: "e", x: 30, y: 20, width: 40, height: 40, fill: "#00f" }] }]),
		["f"],
		{ format: "html" },
	);
	assert.match(styleOf(page, "e"), /position: absolute; left: 30px; top: 20px; width: 40px; height: 40px;.*border-radius: 50%/);
	assert.match(page, /<div aria-hidden="true" style="position: absolute; pointer-events: none; top: 0px; right: 0px; bottom: 0px; left: 0px; border-style: solid; border-color: #000; border-width: 2px; border-radius: 8px"><\/div>\n<\/div>/);
});

test("a gradient turns as pen turns it, and shadows, opacity and turns are CSS's own", () => {
	const page = toHtml(
		doc([{ type: "rectangle", id: "g", width: 100, height: 100, rotation: 30, opacity: 0.5, effect: [{ type: "shadow", offset: { x: 0, y: 2 }, blur: 6, color: "#0003" }, { type: "shadow", shadowType: "inner", blur: 4 }], fill: { type: "gradient", rotation: 90, colors: [{ color: "#000", position: 0 }, { color: "#fff", position: 1 }] } }]),
		["g"],
		{ format: "html" },
	);
	const style = styleOf(page, "g");
	assert.match(style, /opacity: 0.5; transform: rotate\(-30deg\); transform-origin: 0 0/);
	// 90° in pen points left: 270deg in CSS, whose line is the box's width here.
	assert.match(style, /linear-gradient\(270deg, #000 0%, #fff 100%\)/);
	assert.match(style, /box-shadow: 0px 2px 6px 0px #0003(;|$)/);
});

test("an angular gradient is a conic gradient from pen's start, its stops where the stage puts them", () => {
	const wheel = [{ color: "#f00", position: 0 }, { color: "#ff0", position: 0.25 }, { color: "#00f", position: 1 }];
	const page = toHtml(
		doc([
			{ type: "rectangle", id: "a", width: 100, height: 100, fill: { type: "gradient", gradientType: "angular", rotation: 90, center: { x: 0.25, y: 0.5 }, colors: wheel } },
			{ type: "rectangle", id: "b", width: 200, height: 100, fill: { type: "gradient", gradientType: "angular", colors: wheel } },
		]),
		["a", "b"],
		{ format: "html" },
	);
	// 90° counter-clockwise from up is 270deg clockwise.
	assert.match(styleOf(page, "a"), /conic-gradient\(from 270deg at 25% 50%, #f00 0%, #ff0 25%, #00f 100%\)/);
	// On a box twice as wide as tall, a quarter of the way round the ellipse is still the right.
	assert.match(styleOf(page, "b"), /conic-gradient\(from 0deg at 50% 50%, #f00 0%, #ff0 25%, #00f 100%\)/);
});

test("variables are custom properties with their dark values, and an item with a theme sets its own", () => {
	const page = toHtml(
		doc(
			[{ type: "frame", id: "f", width: 10, height: 10, fill: "$paper", children: [{ type: "frame", id: "d", theme: { mode: "dark" }, width: 5, height: 5, fill: "$paper" }] }],
			{ themes: { mode: ["light", "dark"] }, variables: { paper: { type: "color", value: [{ value: "#ffffff" }, { value: "#000000", theme: { mode: "dark" } }] } } },
		),
		["f"],
		{ format: "html" },
	);
	assert.match(page, /:root \{\n {2}--paper: #ffffff;\n\}/);
	assert.match(page, /@media \(prefers-color-scheme: dark\) \{\n:root \{\n {2}--paper: #000000;/);
	assert.match(styleOf(page, "d"), /--paper: #000000;.*background-color: var\(--paper\)/);
});

test("Tailwind has a utility for what it names, and an arbitrary property for the rest", () => {
	assert.equal(tailwindClass("width", "320px"), "w-[320px]");
	assert.equal(tailwindClass("justify-content", "space-between"), "justify-between");
	assert.equal(tailwindClass("background-color", "#fff"), "bg-[color:#fff]");
	assert.equal(tailwindClass("background-color", "var(--paper)"), "[background-color:var(--paper)]");
	assert.equal(tailwindClass("box-shadow", "0px 2px 6px 0px #0003"), "[box-shadow:0px_2px_6px_0px_#0003]");
	assert.equal(tailwindClass("--paper", "#000"), "[--paper:#000]");
	const page = toHtml(doc([{ type: "frame", id: "f", layout: "vertical", gap: 4, children: [] }]), ["f"], { format: "tailwind" });
	assert.match(page, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4"><\/script>/);
	assert.match(page, /data-pen-id="f" class="relative w-\[max-content\] flex flex-col gap-\[4px\] justify-start items-start"/);
});

test("icons are inline SVG of the shapes handed over, in the item's colour", () => {
	const page = toHtml(doc([{ type: "icon", id: "i", library: "lucide", icon: "check", width: 24, height: 24, fill: "#123456" }]), ["i"], {
		format: "html",
		icons: (library, name) => (library === "lucide" && name === "check" ? { viewBox: [0, 0, 24, 24], parts: [{ d: "M20 6 9 17l-5-5", fill: false, stroke: true, strokeWidth: 2, cap: "round", join: "round", evenOdd: false }] } : undefined),
	});
	assert.match(page, /<svg data-pen-id="i"[^>]*viewBox="0 0 24 24"[^>]*><path d="M20 6 9 17l-5-5" fill="none" stroke="#123456" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"\/><\/svg>/);
	assert.throws(() => toHtml(doc([]), ["nope"], { format: "html" }), /no item nope/);
});

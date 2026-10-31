import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";

/**
 * The calls borrowed from pen.dev's drawing API, end to end over `/api/v1`: ids from names,
 * warnings in the notes, reading part of a canvas or its values worked out, the clipped flag, and
 * finding empty space.
 */

const board = (title: string, w = 900, h = 400) =>
	`<!doctype html><html><head><title>${title}</title><meta name="board" content='{"w":${w},"h":${h},"bg":"grid"}' /></head><body class="board"></body></html>`;

async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-pen-calls-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(join(deck, "boards", "a.html"), board("Revenue is up"));
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
	const agent = app.agents.focused();
	const headers = { authorization: `Bearer ${app.bridge.issue(agent.id)}` };
	type Answer = { ok: boolean; value?: any; error?: string; notes: string[] };
	const call = async (verb: string, args: unknown[] = []): Promise<Answer> => {
		const response = await fetch(`${base}/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
		return (await response.json()) as Answer;
	};
	const must = async (verb: string, args: unknown[] = []) => {
		const answer = await call(verb, args);
		assert.ok(answer.ok, `${verb}: ${answer.error}`);
		return answer;
	};
	return {
		app,
		agent,
		call,
		must,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("an inserted item with a name is given its name as its id, and a second one -2", async () => {
	const { must, cleanup } = await open();
	try {
		const first = (await must("canvas.insert", [{ type: "frame", name: "Pricing card", width: 200, height: 100, children: [{ type: "text", name: "Plan name", content: "Pro" }] }, { at: { x1: 0, y1: 0 } }])).value;
		assert.equal(first.id, "pricing-card");
		assert.equal(first.children[0].id, "plan-name");
		const [second, copy] = (await must("canvas.batch", [[
			{ op: "insert", item: { type: "frame", name: "Pricing card", width: 200, height: 100 }, at: { x1: 400, y1: 0 } },
			{ op: "copy", id: "pricing-card", at: { x1: 800, y1: 0 } },
		]])).value;
		assert.equal(second.id, "pricing-card-2");
		assert.equal(copy.id, "pricing-card-3");
		assert.equal(copy.children[0].id, "plan-name-2");
		const plain = (await must("canvas.insert", [{ type: "note", content: "no name" }, { at: { x1: 0, y1: 400 } }])).value;
		assert.match(plain.id, /^[A-Za-z0-9]{5}$/);
	} finally {
		cleanup();
	}
});

test("a field pen has no place for, or one Decks does not draw, is a note and never a refusal", async () => {
	const { must, cleanup } = await open();
	try {
		const single = await must("canvas.insert", [{ type: "text", name: "Title", content: "Hi", padding: 8 }, { at: { x1: 0, y1: 0 } }]);
		assert.ok(single.notes.includes('"padding" does nothing on a text.'), single.notes.join("\n"));
		assert.equal(single.value.padding, 8, "the field is kept");
		const batch = await must("canvas.batch", [[
			{ op: "insert", item: { type: "rectangle", name: "Plain", width: 10, height: 10 }, at: { x1: 0, y1: 100 } },
			{ op: "insert", item: { type: "rectangle", name: "Glow", width: 10, height: 10, effect: { type: "background_blur", radius: 8 } }, at: { x1: 0, y1: 200 } },
			{ op: "update", id: "title", set: { gap: 4, fill: { type: "mesh_gradient", colors: [] } } },
			{ op: "replace", id: "plain", item: { type: "script", scriptUri: "./a.js", width: 10, height: 10 } },
		]]);
		const said = batch.notes.join("\n");
		assert.match(said, /^Op 2 \(insert\): A background_blur effect on a rectangle is kept for pen\.dev, but Decks does not draw it\.$/m);
		assert.match(said, /^Op 3 \(update\): "gap" does nothing on a text\.$/m);
		assert.match(said, /^Op 3 \(update\): A mesh_gradient fill on a text is kept for pen\.dev/m);
		assert.match(said, /^Op 4 \(replace\): A script is kept, but Decks does not run scripts/m);
		assert.ok(!/Op 1/.test(said), said);
	} finally {
		cleanup();
	}
});

test("canvas.read of one item, by id or a board's path, and to a depth", async () => {
	const { must, call, cleanup } = await open();
	try {
		await must("canvas.insert", [{ type: "board", board: "boards/a.html" }, { at: { x1: 0, y1: 0 } }]);
		await must("canvas.insert", [{ type: "frame", name: "Panel", layout: "none", width: 300, height: 200, children: [{ type: "frame", name: "Row", layout: "none", width: 100, height: 40, children: [{ type: "text", name: "Cell", content: "x" }] }] }, { at: { x1: 0, y1: 600 } }]);
		const panel = (await must("canvas.read", [{ of: "panel" }])).value;
		assert.deepEqual(panel.items.map((n: { id: string }) => n.id), ["panel"]);
		assert.equal(panel.items[0].children[0].children[0].id, "cell");
		const board = (await must("canvas.read", [{ of: "boards/a.html" }])).value.items;
		assert.equal(board.length, 1);
		assert.equal(board[0].type, "card", "a library board lands as a card");
		const top = (await must("canvas.read", [{ depth: 0 }])).value.items;
		assert.deepEqual(top.map((n: { id: string; childCount?: number; children?: unknown }) => [n.id, n.childCount, n.children]), [[board[0].id, undefined, undefined], ["panel", 1, undefined]]);
		const one = (await must("canvas.read", [{ of: "panel", depth: 1 }])).value.items[0];
		assert.equal(one.children[0].id, "row");
		assert.equal(one.children[0].childCount, 1);
		const missing = await call("canvas.read", [{ of: "nope" }]);
		assert.ok(!missing.ok && /no item "nope"/.test(missing.error ?? ""), missing.error);
	} finally {
		cleanup();
	}
});

test("canvas.read resolves variables in a theme, instances and geometry when asked, and reads as written otherwise", async () => {
	const { must, cleanup } = await open();
	try {
		await must("canvas.variables", [{ ink: { type: "color", value: [{ value: "#111111" }, { value: "#eeeeee", theme: { mode: "dark" } }] } }, { themes: { mode: ["light", "dark"] } }]);
		await must("canvas.batch", [[
			{ op: "insert", item: { type: "frame", name: "Card", reusable: true, layout: "vertical", fill: "$ink", children: [{ type: "text", name: "Label", content: "Card" }] }, at: { x1: 0, y1: 0 } },
			{ op: "insert", item: { type: "ref", id: "c1", ref: "card", descendants: { label: { content: "First" } } }, at: { x1: 400, y1: 0 } },
			{ op: "insert", item: { type: "ellipse", name: "Dot", width: 20, height: 10 }, at: { x1: 0, y1: 400 } },
		]]);
		const items = (opts: object) => must("canvas.read", [opts]).then((a) => a.value.items as Array<Record<string, any>>);
		assert.equal((await items({}))[0]!.fill, "$ink");
		assert.equal((await items({ of: "card", resolve: { variables: true } }))[0]!.fill, "#111111");
		assert.equal((await items({ of: "card", resolve: { variables: true }, theme: { mode: "dark" } }))[0]!.fill, "#eeeeee");
		const c1 = (await items({ of: "c1", resolve: { instances: true } }))[0]!;
		assert.equal(c1.ref, "card");
		assert.deepEqual(c1.children.map((n: { id: string; content: string }) => [n.id, n.content]), [["c1/label", "First"]]);
		assert.equal((await items({ of: "c1" }))[0]!.type, "ref");
		assert.equal((await items({ of: "dot", resolve: { geometry: true } }))[0]!.outline, "M20 5 A10 5 0 0 1 0 5 A10 5 0 0 1 20 5 Z");
	} finally {
		cleanup();
	}
});

test("an item cut by a clipping frame reads as clipped, and the change calls answer with it too", async () => {
	const { must, cleanup } = await open();
	try {
		const view = (await must("canvas.insert", [{ type: "frame", name: "View", layout: "none", clip: true, width: 100, height: 100, children: [{ type: "rectangle", name: "Half", x: 50, y: 0, width: 100, height: 20 }, { type: "rectangle", name: "Gone", x: 200, y: 0, width: 10, height: 10 }, { type: "rectangle", name: "Whole", x: 0, y: 50, width: 10, height: 10 }] }, { at: { x1: 0, y1: 0 } }])).value;
		assert.deepEqual(view.children.map((n: { id: string; clipped?: string }) => [n.id, n.clipped]), [["half", "partly"], ["gone", "fully"], ["whole", undefined]]);
		assert.equal(view.clipped, undefined);
		const read = (await must("canvas.read", [{ of: "half" }])).value.items[0];
		assert.equal(read.clipped, "partly");
	} finally {
		cleanup();
	}
});

test("an item read and written back keeps none of what the read added", async () => {
	const { must, cleanup } = await open();
	try {
		await must("canvas.insert", [{ type: "frame", name: "View", layout: "none", clip: true, width: 100, height: 100, children: [{ type: "rectangle", name: "Half", x: 50, y: 0, width: 100, height: 20 }] }, { at: { x1: 0, y1: 0 } }]);
		const half = (await must("canvas.read", [{ of: "half", resolve: { geometry: true } }])).value.items[0];
		assert.ok(half.clipped && half.outline && half.box);
		const back = await must("canvas.replace", ["half", { ...half, width: 90 }]);
		assert.ok(!back.notes.some((note: string) => /does nothing/.test(note)), back.notes.join("\n"));
		assert.equal(back.value.outline, undefined);
		assert.equal(back.value.clipped, "partly");
	} finally {
		cleanup();
	}
});

test("canvas.space finds room near an item or the middle, and places nothing", async () => {
	const { must, call, cleanup } = await open();
	try {
		await must("canvas.insert", [{ type: "board", board: "boards/a.html" }, { at: { x1: 0, y1: 0 } }]);
		await must("canvas.insert", [{ type: "rectangle", name: "Block", width: 500, height: 500 }, { at: { x1: 1100, y1: 100 } }]);
		const before = (await must("canvas.read")).value.items.length;
		assert.deepEqual((await must("canvas.space", [{ w: 300, h: 200 }, { near: "boards/a.html" }])).value, { x1: 1760, y1: 0 });
		assert.deepEqual((await must("canvas.space", [{ w: 300, h: 200 }, { near: "block", side: "below", margin: 40 }])).value, { x1: 1100, y1: 640 });
		const free = (await must("canvas.space", [{ w: 100, h: 100 }])).value;
		assert.equal(typeof free.x1, "number");
		assert.equal((await must("canvas.read")).value.items.length, before);
		const bad = await call("canvas.space", [{ w: 0, h: 10 }]);
		assert.ok(!bad.ok, "a box with no size has no room to find");
		const missing = await call("canvas.space", [{ w: 10, h: 10 }, { near: "nope" }]);
		assert.ok(!missing.ok && /Nothing called nope/.test(missing.error ?? ""), missing.error);
	} finally {
		cleanup();
	}
});

test("a placeholder frame an agent draws names that agent as the canvas's writer, which the drawing is sent with", async () => {
	const { app, agent, must, cleanup } = await open();
	try {
		await must("canvas.insert", [{ type: "frame", name: "Hero", placeholder: true, width: 400, height: 200 }, { at: { x1: 0, y1: 0 } }]);
		const stage = agent.stageName()!;
		assert.equal(app.pens.writerOf(stage), agent.id);
		const frame = app.pens.frame(agent.id, stage);
		assert.equal(frame.type === "stage.pen" && frame.by, agent.id);
		// A person's edit over the wire leaves the writer as it was.
		app.pens.edit(stage, [{ op: "update", id: "hero", set: { x: 10 } }] as never);
		assert.equal(app.pens.writerOf(stage), agent.id);
		const [delta] = app.pens.changes([agent.id], stage);
		assert.equal(delta?.type === "stage.pen.delta" && delta.by, agent.id);
	} finally {
		cleanup();
	}
});

test("canvas.export writes a frame as one HTML page in the deck, as flexbox or as Tailwind classes", async () => {
	const { app, must, call, cleanup } = await open();
	try {
		await must("canvas.variables", [{ ink: { type: "color", value: [{ value: "#111111" }, { value: "#eeeeee", theme: { mode: "dark" } }] } }, { themes: { mode: ["light", "dark"] } }]);
		await must("canvas.insert", [
			{ type: "frame", name: "Price card", width: 300, layout: "vertical", gap: 12, padding: 20, fill: "#ffffff", cornerRadius: 12, children: [
				{ type: "text", name: "Title", content: "Pro <plan>", fontSize: 20, fontWeight: 700, fill: "$ink" },
				{ type: "rectangle", name: "Bar", width: "fill_container", height: 8, fill: "#3b5cf6" },
				{ type: "path", name: "Tick", geometry: "M0 5 L4 9 L12 0", width: 12, height: 9, stroke: "#2eaf5a", strokeWidth: 2 },
				{ type: "rectangle", name: "Photo", width: 100, height: 60, fill: { type: "image", url: "pics/sea.png", mode: "fit" } },
			] },
			{ at: { x1: 0, y1: 0 } },
		]);
		const deck = app.stage.deckPath();
		const html = (await must("canvas.export", ["price-card", { format: "html" }])).value;
		assert.deepEqual(html, { file: "exports/price-card.html" });
		const page = readFileSync(join(deck, html.file), "utf8");
		assert.match(page, /data-pen-id="price-card" style="[^"]*display: flex; flex-direction: column; gap: 12px; padding: 20px/);
		assert.match(page, /data-pen-id="bar" style="align-self: stretch; height: 8px/);
		assert.match(page, /Pro &lt;plan&gt;/);
		assert.match(page, /color: var\(--ink\)/);
		assert.match(page, /--ink: #111111;[\s\S]*prefers-color-scheme: dark[\s\S]*--ink: #eeeeee;/);
		// A picture is read from the canvas's folder, as the page finds it from exports/.
		assert.match(page, /url\(&quot;\.\.\/canvases\/[^/]+\/pics\/sea\.png&quot;\)[^"]*background-size: contain/);
		assert.match(page, /<svg data-pen-id="tick"[^>]*><path d="[^"]+" fill="none" stroke="#2eaf5a" stroke-width="2"/);
		const tailwind = (await must("canvas.export", [["price-card"], { format: "tailwind", to: "exports/tw/price.html" }])).value;
		const tw = readFileSync(join(deck, tailwind.file), "utf8");
		assert.match(tw, /cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4/);
		assert.match(tw, /data-pen-id="price-card" class="[^"]*flex flex-col gap-\[12px\] p-\[20px\] justify-start items-start bg-\[color:#ffffff\] rounded-\[12px\]/);
		assert.deepEqual((await must("canvas.export", ["price-card"])).value, { file: "exports/price-card.html" }, "html is the default");
		assert.ok(!(await call("canvas.export", ["price-card", { format: "pdf" }])).ok, "a format it does not write is refused");
		assert.ok(!(await call("canvas.export", ["nope", { format: "html" }])).ok, "an id that is not there is refused");
		assert.ok(!(await call("canvas.export", ["price-card", { format: "html", to: "../outside.html" }])).ok, "a page outside the deck is refused");
	} finally {
		cleanup();
	}
});

test("an agent's shape with no colour is coloured as the tools colour theirs, light and dark; one given colours keeps them", async () => {
	const { must, cleanup } = await open();
	try {
		const made = (await must("canvas.batch", [[
			{ op: "insert", item: { type: "rectangle", id: "plain", width: 100, height: 60 }, at: { x1: 0, y1: 0 } },
			{ op: "insert", item: { type: "ellipse", id: "round", width: 60, height: 60 }, at: { x1: 200, y1: 0 } },
			{ op: "insert", item: { type: "frame", id: "box", width: 200, height: 100 }, at: { x1: 400, y1: 0 } },
			{ op: "insert", item: { type: "icon", id: "star", library: "lucide", icon: "star" }, at: { x1: 700, y1: 0 } },
			{ op: "insert", item: { type: "rectangle", id: "red", width: 100, height: 60, fill: "#ff0000" }, at: { x1: 0, y1: 200 } },
			{ op: "insert", item: { type: "frame", id: "row", layout: "horizontal", children: [{ type: "rectangle", id: "spacer", width: 10, height: 10 }] }, at: { x1: 200, y1: 200 } },
			{ op: "insert", item: { type: "path", id: "link", metadata: { type: "decks.arrow", from: "plain", to: "round" } } },
			{ op: "insert", item: { type: "path", id: "blue-link", stroke: "#2563eb", metadata: { type: "decks.arrow", from: "round", to: "box" } } },
		]])).value;
		const by = Object.fromEntries((made as Array<Record<string, any>>).map((one) => [one.id, one]));
		assert.equal(by.plain.fill, "$decks-fill-slate");
		assert.equal(by.round.fill, "$decks-fill-sky");
		assert.equal(by.box.fill, "$decks-surface");
		assert.equal(by.box.stroke, "$decks-line-subtle");
		assert.equal(by.star.fill, "$decks-text");
		assert.equal(by.red.fill, "#ff0000", "a colour given is kept");
		assert.equal(by.row.fill, undefined, "a frame holding items is a layout, left as it is");
		assert.equal(by.row.children[0].fill, undefined, "nor what is inside one");
		assert.equal(by.link.stroke, "$decks-line", "an arrow's line is the tools' grey, light and dark");
		assert.equal(by["blue-link"].stroke, "#2563eb");
		const vars = (await must("canvas.read", [])).value.variables ?? {};
		for (const name of ["decks-fill-slate", "decks-fill-sky", "decks-surface", "decks-line-subtle", "decks-text", "decks-line"]) assert.ok(vars[name], `${name} is defined`);
	} finally {
		cleanup();
	}
});

test("canvas.variables takes values short: { light, dark } keyed to the canvas's own axis, a hex, a number; pen's full form as it is", async () => {
	const { must, cleanup } = await open();
	try {
		// A canvas with no axis: mode: ["light", "dark"] is added.
		let answer = (await must("canvas.variables", [{ brand: { light: "#4f46e5", dark: "#818cf8" }, mark: "#ff0000", space: 16 }])).value;
		assert.deepEqual(answer.variables.brand, { type: "color", value: [{ value: "#4f46e5" }, { value: "#818cf8", theme: { mode: "dark" } }] });
		assert.deepEqual(answer.variables.mark, { type: "color", value: "#ff0000" }, "a plain hex is the same in both");
		assert.deepEqual(answer.variables.space, { type: "number", value: 16 });
		assert.deepEqual(answer.themes, { mode: ["light", "dark"] });
		assert.deepEqual(answer.values, { brand: { light: "#4f46e5", dark: "#818cf8" }, mark: "#ff0000", space: 16 }, "read back short as set");
		// Again: the axis is there, nothing added.
		answer = (await must("canvas.variables", [{ other: { light: "#000000", dark: "#ffffff" } }])).value;
		assert.deepEqual(answer.themes, { mode: ["light", "dark"] });
		assert.deepEqual((await must("canvas.read", [])).value.values.other, { light: "#000000", dark: "#ffffff" });
		// The full form, unchanged.
		const full = { type: "color", value: [{ value: "#111111" }, { value: "#eeeeee", theme: { mode: "dark" } }] };
		answer = (await must("canvas.variables", [{ ink: full }])).value;
		assert.deepEqual(answer.variables.ink, full);
	} finally {
		cleanup();
	}
	const older = await open();
	try {
		// An older canvas's Mode: ["Light", "Dark"] is used as it is.
		await older.must("canvas.variables", [{ x: "#000000" }, { themes: { Mode: ["Light", "Dark"] } }]);
		const answer = (await older.must("canvas.variables", [{ brand: { light: "#4f46e5", dark: "#818cf8" } }])).value;
		assert.deepEqual(answer.variables.brand, { type: "color", value: [{ value: "#4f46e5" }, { value: "#818cf8", theme: { Mode: "Dark" } }] });
		assert.deepEqual(answer.themes, { Mode: ["Light", "Dark"] });
		assert.deepEqual(answer.values.brand, { light: "#4f46e5", dark: "#818cf8" });
	} finally {
		older.cleanup();
	}
});

test("an old Decks colour name an agent still writes is defined, with its new colour's values", async () => {
	const { must, cleanup } = await open();
	try {
		await must("canvas.insert", [{ type: "rectangle", id: "old", width: 100, height: 60, fill: "$decks-ink" }]);
		const vars = (await must("canvas.read", [])).value.variables ?? {};
		assert.deepEqual(vars["decks-ink"], { type: "color", value: [{ value: "#1f2328" }, { value: "#e6e6e6", theme: { mode: "dark" } }] });
		assert.equal(vars["decks-text"], undefined, "only the name the item uses");
	} finally {
		cleanup();
	}
});

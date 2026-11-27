import assert from "node:assert/strict";
import { namingCanvas } from "./names-canvas.test-helper.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../connections/http.ts";

/** Write a file, making its folder: a card is `cards/<name>/index.html`. */
function put(file: string, data: string | Uint8Array): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}


/**
 * The calls borrowed from pen.dev's drawing API, end to end over `/api/v1`: ids from names,
 * warnings in the notes, reading part of a canvas or its values worked out, the clipped flag, and
 * finding empty space.
 */

const card = (title: string, w = 900, h = 400) =>
	`<!doctype html><html><head><title>${title}</title><meta name="card" content='{"w":${w},"h":${h},"bg":"grid"}' /></head><body class="card-page"></body></html>`;

async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-pen-calls-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "cards"), { recursive: true });
	put(join(deck, "canvases", "t", "cards", "a", "index.html"), card("Revenue is up"));
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
	const agent = app.agents.focused();
	const headers = { authorization: `Bearer ${app.bridge.issue(agent.id)}` };
	type Answer = { ok: boolean; value?: any; error?: string; notes: string[] };
	// The agent's calls name the canvas it works on, the one its chat is on here (`names-canvas.test-helper.ts`).
	const call = async (verb: string, given: unknown[] = []): Promise<Answer> => {
		const args = namingCanvas(verb, given, agent.seat.canvasFolder(true));
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

test("canvas.read of one item, by id or a card's path, and to a depth", async () => {
	const { must, call, cleanup } = await open();
	try {
		await must("canvas.insert", [{ type: "card", card: "canvases/t/cards/a/index.html" }, { at: { x1: 0, y1: 0 } }]);
		await must("canvas.insert", [{ type: "frame", name: "Panel", layout: "none", width: 300, height: 200, children: [{ type: "frame", name: "Row", layout: "none", width: 100, height: 40, children: [{ type: "text", name: "Cell", content: "x" }] }] }, { at: { x1: 0, y1: 600 } }]);
		const panel = (await must("canvas.read", [{ of: "panel" }])).value;
		assert.deepEqual(panel.items.map((n: { id: string }) => n.id), ["panel"]);
		assert.equal(panel.items[0].children[0].children[0].id, "cell");
		const card = (await must("canvas.read", [{ of: "canvases/t/cards/a/index.html" }])).value.items;
		assert.equal(card.length, 1);
		assert.equal(card[0].type, "card", "a library card lands as a card");
		const top = (await must("canvas.read", [{ depth: 0 }])).value.items;
		assert.deepEqual(top.map((n: { id: string; childCount?: number; children?: unknown }) => [n.id, n.childCount, n.children]), [[card[0].id, undefined, undefined], ["panel", 1, undefined]]);
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
		await must("canvas.insert", [{ type: "card", card: "canvases/t/cards/a/index.html" }, { at: { x1: 0, y1: 0 } }]);
		await must("canvas.insert", [{ type: "rectangle", name: "Block", width: 500, height: 500 }, { at: { x1: 1100, y1: 100 } }]);
		const before = (await must("canvas.read")).value.items.length;
		assert.deepEqual((await must("canvas.space", [{ w: 300, h: 200 }, { near: "canvases/t/cards/a/index.html" }])).value, { x1: 1760, y1: 0 });
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
		const canvas = agent.seat.canvasFolder()!;
		assert.equal(app.pens.log.writerOf(canvas), agent.id);
		assert.equal(app.pens.log.frame(canvas).by, agent.id);
		// A person's edit over the wire leaves the writer as it was.
		app.pens.edit(canvas, [{ op: "update", id: "hero", set: { x: 10 } }] as never);
		assert.equal(app.pens.log.writerOf(canvas), agent.id);
		const delta = app.pens.log.changes(canvas);
		assert.equal(delta.type === "canvas.changed" && delta.by, agent.id);
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
		const deck = app.canvas.deckPath();
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

test("a link is placed by what it opens, kept as a tagged pill, and read back as a link", async () => {
	const { must, call, app, agent, cleanup } = await open();
	try {
		const notes = (await must("canvas.create", ["Research notes"])).value.name as string;
		// By a canvas's title, as `view open` takes it: the address is its folder's, the words its title.
		const chip = (await must("canvas.insert", [{ type: "link", to: "Research notes" }, { at: { x1: 0, y1: 0 } }])).value;
		assert.deepEqual({ type: chip.type, to: chip.to, title: chip.title }, { type: "link", to: `#canvas/${notes}`, title: "Research notes" });
		assert.ok(chip.box.x2 - chip.box.x1 > 80 && chip.box.y2 - chip.box.y1 > 20, JSON.stringify(chip.box));
		// The file keeps a pill pen.dev can open: a frame with a mark, the name and an arrow, tagged with the address.
		const kept = app.canvas.pens!.get(agent.seat.canvasFolder(true)!).doc.children!.find((node) => node.id === chip.id)!;
		assert.equal(kept.type, "frame");
		assert.deepEqual(kept.metadata, { type: "decks.link", to: `#canvas/${notes}` });
		assert.deepEqual(kept.children!.map((child) => [child.type, child.icon ?? child.content]), [["icon", "layers"], ["text", "Research notes"], ["icon", "arrow-up-right"]]);
		assert.ok(kept.children!.every((child) => typeof child.id === "string" && child.id), "each part has an id");
		// By a card's path, and by the address itself; a title of the caller's own is kept.
		const card = (await must("canvas.insert", [{ type: "link", to: "canvases/t/cards/a" }, { beside: chip.id }])).value;
		assert.deepEqual([card.to, card.title], ["#card/canvases/t/cards/a/index.html", "Revenue is up"]);
		const named = (await must("canvas.insert", [{ type: "link", to: `#canvas/${notes}`, title: "The interviews" }, { below: chip.id }])).value;
		assert.deepEqual([named.to, named.title], [`#canvas/${notes}`, "The interviews"]);
		// Read with the canvas, it is a link among the items; written back as read, it is the same chip.
		const read = (await must("canvas.read", [])).value.items.find((item: { id: string }) => item.id === chip.id);
		assert.deepEqual({ type: read.type, to: read.to, title: read.title }, { type: "link", to: `#canvas/${notes}`, title: "Research notes" });
		const again = (await must("canvas.replace", [chip.id, read])).value;
		assert.deepEqual({ id: again.id, to: again.to, title: again.title }, { id: chip.id, to: `#canvas/${notes}`, title: "Research notes" });
		// A name that is nothing in the deck is refused, in words; an address whose target is gone is kept, dimmed.
		const none = await call("canvas.insert", [{ type: "link", to: "nothing-by-that-name" }]);
		assert.ok(!none.ok && /Nothing to open is called/.test(none.error ?? ""), none.error);
		const gone = (await must("canvas.insert", [{ type: "link", to: "#canvas/long-gone" }, { at: { x1: 0, y1: 400 } }])).value;
		assert.deepEqual([gone.to, gone.title, gone.opacity], ["#canvas/long-gone", "long-gone", 0.45]);
		// The canvas called something else: the chip that showed its name follows, and the one with words of its own keeps them.
		await must("canvas.rename", ["Field notes", { canvas: notes }]);
		const after = (await must("canvas.read", [])).value.items as Array<{ id: string; to?: string; title?: string }>;
		assert.deepEqual(after.filter((item) => item.id === chip.id || item.id === named.id).map((item) => [item.to, item.title]), [[`#canvas/${notes}`, "Field notes"], [`#canvas/${notes}`, "The interviews"]]);
	} finally {
		cleanup();
	}
});

test("placed beside, below or nowhere, an item aims there and steps on past what is in the way; a corner given is kept and what it covers said", async () => {
	const { must, cleanup } = await open();
	try {
		const box = async (id: string) => (await must("canvas.read", [{ of: id }])).value.items[0].box;
		const rect = (name: string, width: number, height: number) => ({ type: "rectangle", name, width, height });
		await must("canvas.insert", [rect("A", 400, 300), { at: { x1: 0, y1: 0 } }]);
		// Something already where "beside A" aims (x 560), and something where "below A" aims (y 460).
		await must("canvas.insert", [rect("Right", 300, 300), { at: { x1: 600, y1: 50 } }]);
		await must("canvas.insert", [rect("Under", 300, 300), { at: { x1: 20, y1: 500 } }]);
		const beside = await must("canvas.insert", [rect("Beside", 200, 200), { beside: "a" }]);
		assert.deepEqual(await box("beside"), { x1: 1060, y1: 0, x2: 1260, y2: 200 }, "on right, past Right, tops still level with A");
		assert.ok(beside.notes.some((note) => /aimed at x1 560, y1 0, which was taken: it went on right past 1 item, to x1 1060/.test(note)), beside.notes.join(" | "));
		await must("canvas.insert", [rect("Below", 200, 200), { below: "a" }]);
		assert.deepEqual(await box("below"), { x1: 0, y1: 960, x2: 200, y2: 1160 }, "on down, past Under, lefts still level with A");
		// Nowhere said: beside the newest (Below), and on past nothing, so right where it aimed.
		const free = await must("canvas.insert", [rect("Free", 100, 100)]);
		assert.deepEqual(await box("free"), { x1: 360, y1: 960, x2: 460, y2: 1060 });
		assert.ok(free.notes.some((note) => /went beside below, at x1 360, y1 960/.test(note)), free.notes.join(" | "));
		// A batch: each new item keeps clear of the ones before it.
		await must("canvas.batch", [[{ op: "insert", item: rect("One", 200, 200), beside: "a" }, { op: "insert", item: rect("Two", 200, 200), beside: "a" }]]);
		assert.equal((await box("one")).x1, 1420);
		assert.equal((await box("two")).x1, 1780);
		// A corner given is the caller's decision: kept, and what it covers is said.
		const over = await must("canvas.insert", [rect("Over", 100, 100), { at: { x1: 50, y1: 50 } }]);
		assert.deepEqual(await box("over"), { x1: 50, y1: 50, x2: 150, y2: 150 });
		assert.ok(over.notes.some((note) => /over sits over a: a corner given with at is kept as given/.test(note)), over.notes.join(" | "));
		// Moved beside another, as an insert: on past what is in the way.
		const moved = await must("canvas.move", ["free", { beside: "a" }]);
		assert.equal((await box("free")).x1, 2140);
		assert.ok(moved.notes.some((note) => /^Warning: free was aimed at x1 560/.test(note)), moved.notes.join(" | "));
		// Every fallback is a warning: the notes above all start so.
		for (const answer of [beside, free, over]) assert.ok(answer.notes.some((note) => note.startsWith("Warning: ")), answer.notes.join(" | "));
		// Room asked for where it is taken says so; room where it is free says nothing.
		const taken = await must("canvas.space", [{ w: 200, h: 200 }, { near: "a" }]);
		assert.ok(taken.notes.some((note) => /^Warning: right of a at x1 560, y1 0 is taken/.test(note)), taken.notes.join(" | "));
		const around = await must("canvas.space", [{ w: 100, h: 100 }, { around: { x: 200, y: 150 } }]);
		assert.ok(around.notes.some((note) => /^Warning: a box centred on x 200, y 150 would touch/.test(note)), around.notes.join(" | "));
		const clear = await must("canvas.space", [{ w: 100, h: 100 }, { around: { x: 20000, y: 20000 } }]);
		assert.deepEqual(clear.value, { x1: 19950, y1: 19950 });
		assert.ok(!clear.notes.some((note) => note.startsWith("Warning: ")), clear.notes.join(" | "));
	} finally {
		cleanup();
	}
});

test("a link can point at any item, by its id or its address, and says how it opens", async () => {
	const { must, call, agent, cleanup } = await open();
	try {
		const canvas = agent.seat.canvasFolder(true) ?? "";
		await must("canvas.insert", [{ type: "note", name: "Risks", content: "Three risks" }, { at: { x1: 0, y1: 0 } }]);
		// By its id on this canvas: an item's address, opened on the canvas unless it says otherwise.
		const chip = (await must("canvas.insert", [{ type: "link", to: "risks" }, { at: { x1: 0, y1: 600 } }])).value;
		assert.deepEqual({ to: chip.to, open: chip.open, title: chip.title }, { to: `#item/${encodeURIComponent(canvas)}/risks`, open: "canvas", title: "Risks" });
		// Said: a tab. Kept in the file's address and read back.
		const tab = (await must("canvas.insert", [{ type: "link", to: "risks", open: "tab" }, { at: { x1: 400, y1: 600 } }])).value;
		assert.equal(tab.open, "tab");
		const kept = JSON.parse(JSON.stringify((await must("canvas.read", [{ of: tab.id }])).value.items[0]));
		assert.equal(kept.open, "tab");
		// A card opens on the canvas by default, a canvas in a tab.
		const card = (await must("canvas.insert", [{ type: "link", to: "canvases/t/cards/a" }, { at: { x1: 800, y1: 600 } }])).value;
		assert.equal(card.open, "canvas");
		const other = (await must("canvas.insert", [{ type: "link", to: `#canvas/${canvas}` }, { at: { x1: 1200, y1: 600 } }])).value;
		assert.equal(other.open, "tab");
		// An item on a canvas that does not have it: kept, dimmed. A wrong opening is refused, in words.
		const gone = (await must("canvas.insert", [{ type: "link", to: "#item/nowhere/x" }, { at: { x1: 0, y1: 900 } }])).value;
		assert.equal(gone.opacity, 0.45);
		const bad = await call("canvas.insert", [{ type: "link", to: "risks", open: "window" }]);
		assert.ok(!bad.ok && /open is how the link opens/.test(bad.error ?? ""), bad.error);
		const none = await call("canvas.insert", [{ type: "link", to: "no-such-thing" }]);
		assert.ok(!none.ok && /Nor is it an item's id on this canvas/.test(none.error ?? ""), none.error);
	} finally {
		cleanup();
	}
});

test("a new canvas is made empty: its areas are the agent's to lay out", async () => {
	const { must, cleanup } = await open();
	try {
		const made = (await must("canvas.create", ["Areas test"])).value;
		assert.deepEqual((await must("canvas.read", [{ canvas: made.name }])).value.items, []);
	} finally {
		cleanup();
	}
});

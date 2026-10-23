import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
		assert.equal(board[0].type, "board");
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

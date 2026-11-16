import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";

/**
 * Copy and paste within one harness (`paste.ts`): `canvas.clip` holds the items as the drawing has
 * them, `canvas.paste` puts them in with new ids, arrows joined, and the files they need copied from
 * the canvas they came from, as one edit the person can undo.
 */

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
let n = 0;
const fresh = () => `clip${Date.now().toString(36)}${(n++).toString(36)}abcdefghij`;

async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-paste-")));
	const deck = join(dataDir, "decks");
	mkdirSync(deck, { recursive: true });
	// A friend's canvas, shared to view, with a card on it.
	const shared = join(deck, "shared", "canvases", "ada", "fetcher");
	mkdirSync(join(shared, "cards", "chart"), { recursive: true });
	writeFileSync(join(shared, "canvas.json"), JSON.stringify({ title: "Fetcher", shared: { owner: "u1", ownerName: "Ada", role: "view" } }));
	writeFileSync(join(shared, "cards", "chart", "index.html"), `<title>Chart</title><meta name="card" content='{"w":400}' /><p>Chart</p><script>document.title = "ran"</script>`);
	writeFileSync(join(shared, "canvas.pen"), JSON.stringify({ version: "2.8", children: [{ type: "browser", id: "chart", name: "Chart", url: "cards/chart/index.html", x: 0, y: 0, width: 400, height: 300, metadata: { type: "decks.card", path: "cards/chart/index.html" } }] }));
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const pens = app.stage.pens!;
	const one = pens.claim("One");
	const two = pens.claim("Two");
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const person = { authorization: `Bearer ${app.tokens.issue({ kind: "person" }).token}` };
	type Answer = { ok: boolean; value?: any; error?: string; notes: string[] };
	const call = async (verb: string, args: unknown[], headers: Record<string, string> = person): Promise<Answer> => {
		const response = await fetch(`${origin}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
		return (await response.json()) as Answer;
	};
	const must = async (verb: string, args: unknown[], headers?: Record<string, string>) => {
		const answer = await call(verb, args, headers);
		assert.ok(answer.ok, `${verb}: ${answer.error}`);
		return answer.value;
	};
	/** A canvas pass's headers, as the canvas frame sends them. */
	const frame = (canvas: string) => ({ authorization: `Bearer ${app.passes.canvas(canvas, "edit", app.tokens.issue({ kind: "person" }).id).pass}`, origin: "null", "sec-fetch-site": "cross-site" });
	const items = async (canvas: string) => (await must("canvas.read", [{ canvas }])).items as Array<Record<string, any>>;
	return {
		app,
		deck,
		one,
		two,
		call,
		must,
		frame,
		items,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("a paste on the same canvas makes new items with new ids, the arrow joined to the copies, at the point given", async () => {
	const { one, must, frame, items, cleanup } = await open();
	try {
		const [a, b, arrow] = await must("canvas.batch", [[
			{ op: "insert", item: { type: "note", id: "a", content: "First" }, at: { x1: 0, y1: 0 } },
			{ op: "insert", item: { type: "note", id: "b", content: "Second" }, at: { x1: 400, y1: 0 } },
			{ op: "insert", item: { type: "path", id: "ab", metadata: { type: "decks.arrow", from: "a", to: "b" } } },
		], { canvas: one }]);
		assert.deepEqual([a.id, b.id, arrow.id], ["a", "b", "ab"]);
		const id = fresh();
		const held = await must("canvas.clip", [["a", "b", "ab"], { id }], frame(one));
		assert.equal(held.items, 3);
		const pasted = await must("canvas.paste", [{ v: 1, id, canvas: one }, { at: { x: 1000, y: 500 } }], frame(one));
		assert.equal(pasted.length, 3);
		const ids = pasted.map((item: { id: string }) => item.id);
		for (const old of ["a", "b", "ab"]) assert.ok(!ids.includes(old), "new ids");
		const [na, nb, narrow] = pasted;
		assert.equal(narrow.metadata.from, na.id);
		assert.equal(narrow.metadata.to, nb.id);
		assert.equal(na.x, 1000);
		assert.equal(na.y, 500);
		assert.equal(nb.x, 1400);
		assert.equal((await items(one)).length, 6);
	} finally {
		cleanup();
	}
});

test("a paste on another canvas copies the card's folder and the picture, points the items at the copies, and takes a free name", async () => {
	const { deck, one, two, must, frame, items, cleanup } = await open();
	try {
		mkdirSync(join(deck, "canvases", one, "files"), { recursive: true });
		writeFileSync(join(deck, "canvases", one, "files", "a.png"), PNG);
		const card = await must("canvas.insert", [{ type: "card", title: "Sales", html: "<p>Sales</p>" }, { canvas: one, at: { x1: 0, y1: 0 } }]);
		mkdirSync(join(deck, "canvases", one, "cards", "sales", "data"), { recursive: true });
		writeFileSync(join(deck, "canvases", one, "cards", "sales", "data", "rows.json"), "[1,2]");
		await must("canvas.batch", [[
			{ op: "insert", item: { type: "rectangle", id: "pic", width: 100, height: 100, fill: { type: "image", url: "files/a.png", mode: "fill" } }, at: { x1: 800, y1: 0 } },
			{ op: "insert", item: { type: "path", id: "to-card", metadata: { type: "decks.arrow", from: "pic", to: card.id } } },
		], { canvas: one }]);
		// A different a.png on Two already, and the card's name taken there.
		mkdirSync(join(deck, "canvases", two, "files"), { recursive: true });
		writeFileSync(join(deck, "canvases", two, "files", "a.png"), "not the same");
		mkdirSync(join(deck, "canvases", two, "cards", "sales"), { recursive: true });
		writeFileSync(join(deck, "canvases", two, "cards", "sales", "index.html"), "<p>Two's own</p>");
		const id = fresh();
		await must("canvas.clip", [[card.id, "pic", "to-card"], { id }], frame(one));
		const pasted = await must("canvas.paste", [{ v: 1, id, canvas: one }, { at: { x: 0, y: 2000 } }], frame(two));
		const [pastedCard, pic, arrow] = pasted;
		assert.equal(pastedCard.type, "card");
		assert.equal(pastedCard.card, `canvases/${two}/cards/sales-2/index.html`);
		assert.ok(existsSync(join(deck, "canvases", two, "cards", "sales-2", "index.html")));
		assert.equal(readFileSync(join(deck, "canvases", two, "cards", "sales-2", "data", "rows.json"), "utf8"), "[1,2]", "the whole folder");
		assert.equal(readFileSync(join(deck, "canvases", two, "cards", "sales", "index.html"), "utf8"), "<p>Two's own</p>", "Two's own card untouched");
		assert.equal(pic.fill.url, "files/a-2.png");
		assert.deepEqual(readFileSync(join(deck, "canvases", two, "files", "a-2.png")), PNG);
		assert.equal(arrow.metadata.from, pic.id);
		assert.equal(arrow.metadata.to, pastedCard.id);
		// Again: another card folder, and the identical picture used as it is.
		const again = fresh();
		await must("canvas.clip", [["pic"], { id: again }], frame(one));
		const [second] = await must("canvas.paste", [{ v: 1, id: again, canvas: one }, { at: { x: 0, y: 3000 } }], frame(two));
		assert.equal(second.fill.url, "files/a-2.png", "the same file, not a third");
		assert.ok(!existsSync(join(deck, "canvases", two, "files", "a-3.png")));
		assert.equal((await items(two)).length, 4);
	} finally {
		cleanup();
	}
});

test("a path out of the source canvas's folder refuses the paste, and nothing is copied", async () => {
	const { app, deck, one, two, call, must, frame, items, cleanup } = await open();
	try {
		for (const url of ["../../../../etc/passwd", "/etc/passwd", `../${two}/files/x.png`]) {
			app.stage.pens!.edit(one, [{ op: "insert", node: { type: "rectangle", id: `bad${n++}`, x: 0, y: 0, width: 10, height: 10, fill: { type: "image", url, mode: "fill" } } as never }]);
			const bad = app.stage.pens!.get(one).doc.children.at(-1)!.id;
			const id = fresh();
			await must("canvas.clip", [[bad], { id }], frame(one));
			const refused = await call("canvas.paste", [{ v: 1, id, canvas: one }, { at: { x: 0, y: 0 } }], frame(two));
			assert.equal(refused.ok, false, url);
			assert.match(refused.error ?? "", /nothing was pasted/, url);
		}
		assert.equal((await items(two)).length, 0);
		assert.ok(!existsSync(join(deck, "canvases", two, "files")));
	} finally {
		cleanup();
	}
});

test("a copy the harness does not hold, or from a canvas the caller cannot read, is refused", async () => {
	const { app, one, two, call, must, frame, cleanup } = await open();
	try {
		await must("canvas.insert", [{ type: "note", id: "n", content: "Hi" }, { canvas: one, at: { x1: 0, y1: 0 } }]);
		const made = await call("canvas.paste", [{ v: 1, id: fresh(), canvas: one, items: [{ type: "note", id: "x", content: "forged" }] }, { at: { x: 0, y: 0 } }], frame(two));
		assert.equal(made.ok, false);
		assert.match(made.error ?? "", /no longer holds that copy/);
		// Two's frame may not read One: its copy is One's frame's to make.
		const reach = await call("canvas.clip", [["n"], { id: fresh(), canvas: one }], frame(two));
		assert.equal(reach.ok, false);
		// The source canvas gone since the copy: nothing to read it from.
		const id = fresh();
		await must("canvas.clip", [["n"], { id }], frame(one));
		const mismatch = await call("canvas.paste", [{ v: 1, id, canvas: two }, {}], frame(two));
		assert.equal(mismatch.ok, false, "the clip says another canvas");
		app.stage.pens!.remove(one);
		const gone = await call("canvas.paste", [{ v: 1, id, canvas: one }, {}], frame(two));
		assert.equal(gone.ok, false);
		assert.match(gone.error ?? "", /not one you can read/);
	} finally {
		cleanup();
	}
});

test("a card from a friend's canvas lands with its scripts off", async () => {
	const { deck, two, must, frame, cleanup } = await open();
	try {
		const id = fresh();
		await must("canvas.clip", [["chart"], { id }], frame("shared/ada/fetcher"));
		const [card] = await must("canvas.paste", [{ v: 1, id, canvas: "shared/ada/fetcher" }, { at: { x: 0, y: 0 } }], frame(two));
		assert.equal(card.card, `canvases/${two}/cards/chart/index.html`);
		assert.ok(existsSync(join(deck, "canvases", two, "cards", "chart", "index.html")));
		const drawn = JSON.parse(readFileSync(join(deck, "canvases", two, "canvas.pen"), "utf8")).children[0];
		assert.equal(drawn.metadata.scripts, false);
		assert.equal(drawn.metadata.from, "shared/ada/fetcher");
	} finally {
		cleanup();
	}
});

test("undo takes the pasted items back as one edit", async () => {
	const { one, two, must, frame, items, cleanup } = await open();
	try {
		await must("canvas.batch", [[
			{ op: "insert", item: { type: "note", id: "a", content: "First" }, at: { x1: 0, y1: 0 } },
			{ op: "insert", item: { type: "note", id: "b", content: "Second" }, at: { x1: 400, y1: 0 } },
		], { canvas: one }]);
		const id = fresh();
		await must("canvas.clip", [["a", "b"], { id }], frame(one));
		await must("canvas.paste", [{ v: 1, id, canvas: one }, { at: { x: 0, y: 0 } }], frame(two));
		assert.equal((await items(two)).length, 2);
		await must("canvas.step", ["undo"], frame(two));
		assert.equal((await items(two)).length, 0);
		await must("canvas.step", ["redo"], frame(two));
		assert.equal((await items(two)).length, 2);
	} finally {
		cleanup();
	}
});

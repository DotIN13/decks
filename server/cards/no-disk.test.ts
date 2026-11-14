import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "../kernel/testing.ts";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { features } from "../main.ts";

// The no-disk check: a client with no disk builds a card and a document
// through calls alone, on the in-memory deck, with every feature main.ts runs.
// Each feature adds its own test here: what a client does with it, by calls.
const ann = callers.agent("ann", "work");
const start = () => testServer({ features: features(), deck: new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' }) });

test("a card with a script and a data file, three lines changed by file.edit, read back", async () => {
	const s = await start();
	const card = await s.value<{ path: string }>("card.create", { title: "Sales by month" }, ann);
	const folder = card.path.replace(/index\.html$/, "");
	await s.value("file.write", { path: `${folder}data.json`, text: '{ "jan": 10, "feb": 12 }\n' }, ann);
	await s.value("file.write", { path: `${folder}chart.js`, text: "export function draw(root, data) {\n\troot.textContent = JSON.stringify(data);\n}\n" }, ann);
	const page = `<title>Sales by month</title>
<div class="doc"><h1>Sales by month</h1><p id="out">loading</p></div>
<script type="module">
	import { draw } from "./chart.js";
	export default async function (card) {
		const data = await (await fetch(card.file("data.json"))).json();
		draw(card.root.getElementById("out"), data);
	}
</script>
`;
	await s.value("file.write", { path: card.path, text: page }, ann);
	await s.value("file.edit", {
		path: card.path,
		edits: [
			{ find: "<title>Sales by month</title>", replace: "<title>Sales rose in February</title>" },
			{ find: "<h1>Sales by month</h1>", replace: "<h1>Sales rose in February</h1>" },
			{ find: "loading", replace: "drawing" },
		],
	}, ann);
	const read = await s.value<{ text: string }>("file.read", { path: card.path });
	assert.match(read.text, /<title>Sales rose in February<\/title>/);
	assert.match(read.text, /id="out">drawing/);
	const files = await s.value<{ path: string }[]>("file.list", { path: folder });
	assert.deepEqual(files.map((f) => f.path.split("/").pop()), ["chart.js", "data.json", "index.html"]);
	const placed = await s.value<{ type: string; card: string }>("item.insert", { item: { type: "card", card: card.path }, at: { x: 0, y: 0 } }, ann);
	assert.deepEqual([placed.type, placed.card], ["card", card.path]);
	const got = await s.value<{ title: string; by: string; placements?: { canvas: string }[] }>("card.get", { card: folder });
	assert.deepEqual([got.title, got.by, got.placements?.map((p) => p.canvas)], ["Sales rose in February", "ann", ["work"]]);
	await s.close();
});

test("a document written, typed into, edited, and its versions listed", async () => {
	const s = await start();
	const path = "canvases/work/files/notes.md";
	await s.value("file.write", { path, text: "# Notes\n\nFirst line.\n" }, ann);
	const opened = await s.value<{ rev: number }>("file.open", { path, client: "page" }, "person");
	await s.value("file.splice", { path, client: "page", rev: opened.rev, batch: "1", splices: [{ at: 21, before: "", text: "Typed.\n" }] }, "person");
	await s.value("file.edit", { path, edits: [{ find: "First line.", replace: "First line, edited." }] }, ann);
	const state = await s.value<{ text: string; changes: { by: string }[] }>("file.open", { path, client: "page" }, "person");
	assert.equal(state.text, "# Notes\n\nFirst line, edited.\nTyped.\n");
	assert.deepEqual(state.changes.map((c) => c.by), ["ann"]);
	const versions = await s.value<{ sha: string }[]>("file.versions", { path });
	assert.equal(versions.length, 3, "written, typed, edited");
	const first = await s.value<{ text: string }>("file.read", { path, sha: versions.at(-1)!.sha });
	assert.equal(first.text, "# Notes\n\nFirst line.\n");
	await s.close();
});

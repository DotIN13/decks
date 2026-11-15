import { test } from "node:test";
import assert from "node:assert/strict";
import { features } from "../main.ts";
import { testServer } from "../kernel/testing.ts";

// Today's GET /api/deck lists every card, and a friend's old board, with its deck path.

const card = (id: string, path: string, type = "decks.card") => ({ type: "browser", id, name: id, x: 0, y: 0, width: 100, height: 100, metadata: { type, path } });

test("GET /api/deck lists the cards on every canvas and a friend's old board", async () => {
	const deck = {
		"canvases/plan/canvas.pen": JSON.stringify({ version: "2.14", children: [card("one", "cards/one/index.html")] }),
		"canvases/plan/cards/one/index.html": "<p>one</p>",
		"shared/canvases/ada/old/canvas.pen": JSON.stringify({ version: "2.14", children: [card("notes", "boards/notes.html", "decks.board")] }),
		"shared/canvases/ada/old/boards/notes.html": "<p>notes</p>",
	};
	const server = await testServer({ features: features(), deck });
	const doors = await server.listen(0);
	const answer = await fetch(`${doors.url}/api/deck`, { headers: { authorization: `Bearer ${doors.token}` } });
	const paths = ((await answer.json()) as { deck: { boards: Array<{ path: string }> } }).deck.boards.map((b) => b.path).sort();
	assert.deepEqual(paths, ["canvases/plan/cards/one/index.html", "shared/canvases/ada/old/boards/notes.html"]);
	await doors.close();
	await server.close();
});

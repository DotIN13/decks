import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "./session.ts";
import { touchedFiles } from "./timeline.ts";

const session = (items: unknown[]) => ({ history: () => items }) as unknown as Session;

test("the files an agent's tool calls named count, made relative to the deck, whoever the server says wrote them", () => {
	const items = [
		{ kind: "tool", args: { path: "canvases/a/cards/plan/index.html" }, title: "canvases/a/cards/plan/index.html" },
		{ kind: "tool", args: { command: `node -e 'fs.writeFileSync("/deck/canvases/a/cards/risks/card.css", t)'` } },
		{ kind: "tool", args: { path: "/elsewhere/notes.md" } },
		{ kind: "assistant", text: "canvases/a/cards/ignored/index.html" },
	];
	assert.deepEqual(touchedFiles(session(items), "/deck").sort(), ["canvases/a/cards/plan/index.html", "canvases/a/cards/risks/card.css"]);
});

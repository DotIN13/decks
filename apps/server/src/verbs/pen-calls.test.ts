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

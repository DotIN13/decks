import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach, detach } from "../../clients/attach/index.ts";
import { clientFor } from "../../clients/sdk/index.ts";
import { features } from "../../server/main.ts";
import { callers, testServer } from "../../server/kernel/testing.ts";

// decks attach against Decks-local's real features and doors: the agent it
// makes calls as itself, makes a card, and detach leaves the folder as it was.

test("attach makes an agent that works as itself, and detach puts the folder back", async () => {
	const server = await testServer({ features: features(), deck: { "canvases/plan/canvas.pen": '{"version":"2.6","children":[]}' } });
	const doors = await server.listen(4605);
	const dir = mkdtempSync(`${tmpdir()}/decks-attach-real-`);
	try {
		writeFileSync(join(dir, "notes.md"), "mine\n");
		const person = clientFor(doors.url, server.token(callers.person));
		const said = await attach(["--tool", "claude", "--as", "Wren", "--canvas", "plan", "--dir", dir], person);
		assert.match(said, /Wren is attached here as a claude agent in #/);
		const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8")) as { env: { DECKS_TOKEN: string } };
		const wren = clientFor(doors.url, settings.env.DECKS_TOKEN);
		const me = await wren.decks.agent.me();
		assert.equal(me.name, "Wren");
		const card = await wren.decks.card.create({ title: "Wren was here", canvas: "plan" });
		assert.equal(card.by, me.id);
		assert.match(await detach(["--dir", dir], person), /agent removed/);
		assert.deepEqual(readdirSync(dir), ["notes.md"]);
		await assert.rejects(wren.decks.agent.me(), { code: "refused" });
	} finally {
		rmSync(dir, { recursive: true });
		await doors.close();
		await server.close();
	}
});

test("attached with no --canvas, the agent has a home, so its calls have a here", async () => {
	const server = await testServer({ features: features() });
	const doors = await server.listen(4603);
	const dir = mkdtempSync(`${tmpdir()}/decks-attach-home-`);
	try {
		const person = clientFor(doors.url, server.token(callers.person));
		assert.match(await attach(["--tool", "claude", "--as", "Kite", "--dir", dir], person), /at home on /);
		// The server runs in this process, so the command must not block it: run it asynchronously.
		const run = async (...words: string[]) => (await promisify(execFile)(join(dir, ".claude/decks"), words, { encoding: "utf8" })).stdout;
		const me = JSON.parse(await run("agent", "me")) as { id: string; canvas?: string };
		assert.ok(me.canvas, "agent me has a home canvas");
		const card = JSON.parse(await run("card", "create", "Kite made this with no canvas named")) as { path: string; by: string };
		assert.ok(card.path.startsWith(`canvases/${me.canvas}/cards/`), card.path);
		assert.equal(card.by, me.id);
		await run("view", "goto", me.canvas!);
		await detach(["--dir", dir], person);
	} finally {
		rmSync(dir, { recursive: true });
		await doors.close();
		await server.close();
	}
});

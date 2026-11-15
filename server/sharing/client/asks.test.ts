import assert from "node:assert/strict";
import { test } from "node:test";
import type { Caller } from "../../../protocol/index.ts";
import { callers, testServer } from "../../kernel/testing.ts";
import { sharingFeature } from "../feature.ts";
import { memoryStudio } from "../testing.ts";
import { answerAsk, type Ask } from "./asks.ts";

// A call Studio passes down: only for the account that owns this deck's key,
// as a person of its own, never for the calls that stay at this machine.

const ask = (name: string, by = "ada"): Ask => ({ type: "ask", id: "q", name, args: {}, caller: { kind: "person", id: by, name: "Ada" } });

test("only the owner is served, as studio:<id>, and local-only calls are refused", async () => {
	const seen: Caller[] = [];
	const run = async (_n: string, _a: Record<string, unknown>, c: Caller) => (seen.push(c), { ok: true as const, value: 1, notes: [] });
	assert.deepEqual(await answerAsk(ask("deck.now"), "ada", run), { ok: true, value: 1, notes: [] });
	assert.deepEqual(seen[0], { kind: "person", id: "studio:ada", name: "Ada" });
	const other = await answerAsk(ask("deck.now", "bob"), "ada", run);
	assert.equal(!other.ok && other.error.code, "refused");
	for (const name of ["studio.disconnect", "deck.pair", "deck.revoke", "deck.update", "agent.attach"]) {
		const r = await answerAsk(ask(name), "ada", run);
		assert.equal(!r.ok && r.error.code, "refused", name);
	}
	const none = await answerAsk(ask("deck.now"), "ada", undefined);
	assert.equal(!none.ok && none.error.code, "unavailable");
});

test("Studio's askCall reaches a connected Decks-local and gets its envelope back", async () => {
	const studio = memoryStudio();
	studio.keys.set("good", { user: { id: "ada", name: "Ada" }, harness: { id: "h1", name: "mini" } });
	const server = await testServer({ features: [sharingFeature({ transport: studio.transport, settleMs: 10 })] });
	await server.value("studio.connect", { url: studio.url, key: "good" }, callers.person);
	let answer: Awaited<ReturnType<typeof studio.live.askCall>> | undefined;
	for (let i = 0; i < 50 && !answer; i++) {
		answer = await studio.live.askCall("h1", "deck.now", {}, { id: "ada", name: "Ada" }, 200).catch(() => undefined);
	}
	assert.equal(answer?.ok, true, JSON.stringify(answer));
	const refused = await studio.live.askCall("h1", "studio.disconnect", {}, { id: "ada", name: "Ada" });
	assert.equal(!refused.ok && refused.error.code, "refused");
	assert.deepEqual(await server.value("studio.status"), { connected: true, url: studio.url }, "still linked");
	await assert.rejects(studio.live.askCall("nobody", "deck.now", {}, { id: "ada", name: "Ada" }), /not connected/);
	await server.value("studio.disconnect");
	await server.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { toDeckPath } from "@decks/server/kernel";
import { start } from "./start.ts";

// A deck from today's Decks opens on the new server with nothing lost: every
// entry today's .decks/ keeps is listed in old-entries.json with its owner and
// what becomes of it, and what is adopted is reachable after the start.
// An entry the fixture has and the list lacks fails; a listed one it lacks too.

type Entries = Record<string, { owner: string; becomes: string }>;
const OLD = new URL("../fixtures/old-deck/.decks", import.meta.url).pathname;

test("every entry of today's .decks/ is listed with its owner and what becomes of it", async () => {
	const listed = JSON.parse(await readFile(new URL("old-entries.json", import.meta.url), "utf8")) as Entries;
	const present = (await readdir(OLD)).filter((name) => !name.startsWith("."));
	assert.deepEqual(present.filter((name) => !(name in listed)), [], "in the old deck's .decks/ but not in old-entries.json");
	assert.deepEqual(Object.keys(listed).filter((name) => !present.includes(name)), [], "in old-entries.json but not in the old deck: take it out or add it to the fixture");
});

test("what is adopted is reachable: tokens, versions, bylines, Studio link, ports, app logs, agents", async () => {
	const started = await start("old-deck");
	try {
		const { server } = started;
		assert.equal(server.callers.resolve("dk_old_deck_fixture_person_token")?.kind, "person");
		assert.equal(server.callers.resolve("dk_old_deck_fixture_agent_token")?.kind, "agent");
		const card = toDeckPath("canvases/plan/cards/a/index.html");
		assert.deepEqual((await server.history.revisions(card)).filter((one) => one.rev < 0).length, 2);
		const written = await server.value<{ by?: string }>("card.get", { card: "canvases/plan/cards/a/index.html" });
		assert.ok(written.by, "the card's byline from authors.json is gone");
		const studio = await server.value<{ url?: string }>("studio.status", {});
		assert.equal(studio.url, "http://127.0.0.1:9", "the Studio link from studio.json is gone");
		const ports = await server.value<{ port: number }[]>("port.list", {});
		assert.ok(ports.some((one) => one.port === 3999), "the forwarded port from ports.json is gone");
		const log = await server.kernel.store("apps").get("log/notes");
		assert.ok(log && new TextDecoder().decode(log).includes("started on 4700"), "the app's log from apps/notes.log is gone");
		const agents = (await server.value<{ name: string }[]>("agent.list", {})).map((one) => one.name).sort();
		for (const name of ["Ada", "Bo", "ada 2"]) assert.ok(agents.includes(name), `agent ${name} is not listed: ${agents.join(", ")}`);
		const version = JSON.parse(await readFile(join(started.root, ".decks", "migrations.json"), "utf8")) as { version: string };
		assert.notEqual(version.version, "0.5.1", "the deck's version record did not move on");
	} finally {
		await started.stop();
	}
});

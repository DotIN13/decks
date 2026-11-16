import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CALLS, WHO } from "@decks/protocol";
import { harnessOffers, line, start } from "./start.ts";

// Every call the protocol declares is answered: by a feature of the server
// started as main.ts starts it, or by the host the harness connects as. A call
// that is neither must be in unhandled.json, with its owner and why; a line
// there that is answered now fails too, so the list only shrinks.

type Listed = Record<string, { owner: string; why: string }>;
/** Calls a feature handles but that work only with an outside service main.ts must give it. */
const NEEDS = { "google.read": "googleStore", "google.edit": "googleStore" } as const;

test("every declared call is answered by a feature or the harness, or listed with its owner", async () => {
	const started = await start();
	try {
		const offered = harnessOffers();
		const host = await line(started.url, started.token);
		assert.equal((await host.call("agent.host", { kinds: [], calls: offered })).ok, true, "agent.host refused the harness's offer");
		host.close();
		const handled = new Set(WHO.flatMap((kind) => started.server.router.callable({ kind, id: "complete", name: "complete" }).map((call) => call.name)));
		const needs = (name: string) => name in NEEDS && !started.options[NEEDS[name as keyof typeof NEEDS]];
		const answered = (name: string) => (handled.has(name) && !needs(name)) || offered.includes(name);
		const listed = JSON.parse(await readFile(new URL("unhandled.json", import.meta.url), "utf8")) as Listed;
		const missing = CALLS.map((call) => call.name).filter((name) => !answered(name) && !(name in listed));
		const stale = Object.keys(listed).filter((name) => answered(name) || !CALLS.some((call) => call.name === name));
		assert.deepEqual(missing, [], "answered by no one, and not in unhandled.json");
		assert.deepEqual(stale, [], "in unhandled.json but answered now, or no longer declared: take them out");
	} finally {
		await started.stop();
	}
});

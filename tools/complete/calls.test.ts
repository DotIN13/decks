import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessAnswers } from "@decks/harness";
import { CALLS, PROTOCOL_VERSION, WHO } from "@decks/protocol";
import { features, startOptions } from "@decks/server";
import { FolderDeck } from "@decks/server/kernel";
import { testServer } from "@decks/server/kernel/testing";

// Every call the protocol declares is answered: by a feature of the server
// started as main.ts starts it, or by the host the harness connects as. A call
// that is neither must be in unhandled.json, with its owner and why; a line
// there that is answered now fails too, so the list only shrinks.

type Listed = Record<string, { owner: string; why: string }>;
const FIXTURE = new URL("../fixtures/deck", import.meta.url).pathname;
/** Calls a feature handles but that work only with an outside service main.ts must give it. */
const NEEDS = { "google.read": "docs", "google.edit": "docs" } as const;

/** The calls the harness answers, read from its own table; nothing it builds is used. */
function harnessOffers(): string[] {
	const idle = new Proxy(() => undefined, { get: () => idle, apply: () => undefined }) as never;
	return Object.keys(harnessAnswers({ sessions: idle, accounts: idle, settings: idle, host: idle, forks: new Map() }));
}

/** A host on a real socket, offering what the harness offers through agent.host. */
async function offer(url: string, token: string, calls: string[]): Promise<{ ok: boolean; close(): void }> {
	const ws = new WebSocket(`${url.replace("http", "ws")}/api/v1/socket`);
	return new Promise((done) => {
		ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
		ws.onmessage = (m) => {
			const message = JSON.parse(String(m.data));
			if (message.type === "hello") ws.send(JSON.stringify({ type: "call", id: "offer", name: "agent.host", args: { kinds: [], calls } }));
			if (message.type === "answer") done({ ok: message.envelope.ok, close: () => ws.close() });
		};
	});
}

test("every declared call is answered by a feature or the harness, or listed with its owner", async () => {
	const root = await mkdtemp(join(tmpdir(), "complete-"));
	await cp(FIXTURE, root, { recursive: true });
	const deck = new FolderDeck(root);
	const options = startOptions() as Record<string, unknown>;
	const server = await testServer({ features: features(options), deck });
	const doors = await server.listen(0);
	try {
		const offered = harnessOffers();
		const host = await offer(doors.url, doors.token, offered);
		assert.equal(host.ok, true, "agent.host refused the harness's offer");
		host.close();
		const handled = new Set(WHO.flatMap((kind) => server.router.callable({ kind, id: "complete", name: "complete" }).map((call) => call.name)));
		const answered = (name: string) => (handled.has(name) && !(name in NEEDS && !options[NEEDS[name as keyof typeof NEEDS]])) || offered.includes(name);
		const listed = JSON.parse(await readFile(new URL("unhandled.json", import.meta.url), "utf8")) as Listed;
		const missing = CALLS.map((call) => call.name).filter((name) => !answered(name) && !(name in listed));
		const stale = Object.keys(listed).filter((name) => answered(name) || !CALLS.some((call) => call.name === name));
		assert.deepEqual(missing, [], "answered by no one, and not in unhandled.json");
		assert.deepEqual(stale, [], "in unhandled.json but answered now, or no longer declared: take them out");
	} finally {
		await doors.close();
		await server.close();
		deck.close();
		await rm(root, { recursive: true, force: true });
	}
});

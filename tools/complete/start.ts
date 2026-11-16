import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessAnswers } from "@decks/harness";
import { PROTOCOL_VERSION } from "@decks/protocol";
import { features, startOptions } from "@decks/server";
import { FolderDeck, FolderStore, folderVersion } from "@decks/server/kernel";
import { testServer, type TestServer } from "@decks/server/kernel/testing";

// The server as main.ts starts it (its features, the deck's version record,
// today's .decks/ to adopt), on a copy of a fixture deck, with its doors open;
// socket lines that call and hear; what the harness answers.

type Envelope = { ok: boolean; value?: any; error?: { code: string; message: string } };
export type Line = { call(name: string, args: unknown): Promise<Envelope>; heard: string[]; close(): void };
export type Started = { server: TestServer; url: string; token: string; root: string; options: Record<string, unknown>; stop(): Promise<void> };

/** The server as main starts it, on a copy of a fixture deck in tools/fixtures/ ("deck" or "old-deck");
 *  before it starts, prepare may add to the copy (another canvas, a secret file). */
export async function start(fixture = "deck", prepare?: (root: string) => Promise<void>): Promise<Started> {
	const folder = await mkdtemp(join(tmpdir(), "complete-"));
	const root = join(folder, "decks");
	await cp(new URL(`../fixtures/${fixture}`, import.meta.url).pathname, root, { recursive: true });
	await prepare?.(root);
	const deck = new FolderDeck(root);
	const options = startOptions(root) as Record<string, unknown>;
	const server = await testServer({ features: features(options), deck, version: folderVersion(root), old: new FolderStore(join(root, ".decks")) });
	const doors = await server.listen(0);
	const stop = async () => {
		await doors.close();
		await server.close();
		deck.close();
		await rm(folder, { recursive: true, force: true });
	};
	return { server, url: doors.url, token: doors.token, root, options, stop };
}

/** A socket line as the person: hello, watch everything, then calls; heard keeps each event's name. */
export function line(url: string, token: string): Promise<Line> {
	const ws = new WebSocket(`${url.replace("http", "ws")}/api/v1/socket`);
	const waiting = new Map<string, (envelope: Envelope) => void>();
	const heard: string[] = [];
	let next = 0;
	const call = (name: string, args: unknown) =>
		new Promise<Envelope>((done) => {
			const id = String(++next);
			waiting.set(id, done);
			ws.send(JSON.stringify({ type: "call", id, name, args }));
		});
	return new Promise((ready) => {
		ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
		ws.onmessage = (m) => {
			const message = JSON.parse(String(m.data));
			if (message.type === "hello") (ws.send(JSON.stringify({ type: "watch" })), ready({ call, heard, close: () => ws.close() }));
			if (message.type === "event") heard.push(message.name);
			if (message.type === "answer") waiting.get(message.id)?.(message.envelope);
		};
	});
}

/** The calls the harness answers, read from its own table; nothing it builds is used. */
export function harnessOffers(): string[] {
	const idle = new Proxy(() => undefined, { get: () => idle, apply: () => undefined }) as never;
	return Object.keys(harnessAnswers({ sessions: idle, accounts: idle, settings: idle, host: idle, forks: new Map() }));
}

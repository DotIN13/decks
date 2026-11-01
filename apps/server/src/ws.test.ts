import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import type { ServerMessage } from "@decks/protocol";
import { App } from "./app.ts";
import { verifyOn } from "./auth/guard.ts";
import { realPathOf } from "./deck/roots.ts";
import { createHttpApp } from "./http.ts";
import { Hub } from "./ws.ts";

/** A deck, its server with the tab's socket on /ws as index.ts wires it, and a way to open one. */
async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-ws-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "canvases"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const hub = new Hub(
		createServer(),
		(message, reply, view) => app.handle(message, reply, view),
		(reply, view) => app.greet(reply, view),
		(token, headers) => {
			const seen = verifyOn(app, token, headers);
			return seen.ok && (seen.principal.kind === "person" || seen.principal.kind === "site");
		},
	);
	app.attach(hub);
	const server = createServer(createHttpApp(app));
	server.on("upgrade", (request, socket, head) => {
		const url = new URL(request.url ?? "/", "http://decks");
		if (url.pathname !== "/ws") return socket.destroy();
		const given = url.searchParams.get("decks_token");
		hub.handleUpgrade(request, socket, head, given !== null && app.tokens.verify(given).ok);
	});
	server.listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
	const connect = (query = "") => {
		const ws = new WebSocket(url + query);
		const heard: ServerMessage[] = [];
		ws.on("message", (data) => heard.push(JSON.parse(String(data)) as ServerMessage));
		const closed = new Promise<number>((done) => ws.on("close", (code) => done(code)));
		const opened = new Promise<void>((done) => ws.on("open", () => done()));
		const greeted = (ms = 3000) =>
			new Promise<boolean>((done) => {
				const started = Date.now();
				const tick = () => (heard.some((m) => m.type === "backend") ? done(true) : Date.now() - started > ms ? done(false) : setTimeout(tick, 20));
				tick();
			});
		return { ws, heard, closed, opened, greeted };
	};
	return {
		app,
		connect,
		async stop() {
			hub.close();
			app.dispose();
			await new Promise((done) => server.close(() => done(undefined)));
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("the tab's socket takes its token in hello: greeted after a good one, closed on a bad one or on anything said first, and still opened by the address for one release", async () => {
	const { app, connect, stop } = await open();
	try {
		const person = app.tokens.issue({ kind: "person" }, { label: "ws test" }).token;

		const polite = connect();
		await polite.opened;
		await new Promise((done) => setTimeout(done, 100));
		assert.equal(polite.heard.length, 0, "nothing is said before hello");
		polite.ws.send(JSON.stringify({ type: "hello", token: person }));
		assert.ok(await polite.greeted(), "greeted with the deck once the token is heard");
		polite.ws.close();

		const liar = connect();
		await liar.opened;
		liar.ws.send(JSON.stringify({ type: "hello", token: "nope" }));
		assert.equal(await liar.closed, 4401);

		const rude = connect();
		await rude.opened;
		rude.ws.send(JSON.stringify({ type: "runtimes" }));
		assert.equal(await rude.closed, 4401, "a frame before hello closes the socket");

		const older = connect(`?decks_token=${encodeURIComponent(person)}`);
		await older.opened;
		assert.ok(await older.greeted(), "the address's token still opens it");
		older.ws.close();
	} finally {
		await stop();
	}
});

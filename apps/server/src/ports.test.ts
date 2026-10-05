import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { forwardRequest, forwardTarget, Forwards, forwardUpgrade } from "./ports.ts";

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const closed = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

test("node keeps the path and rnode takes it off, as Open OnDemand does", () => {
	assert.deepEqual(forwardTarget("/node/localhost/8766/static/a.js?x=1"), { port: 8766, path: "/node/localhost/8766/static/a.js?x=1" });
	assert.deepEqual(forwardTarget("/rnode/localhost/3000/static/a.js?x=1"), { port: 3000, path: "/static/a.js?x=1" });
	assert.deepEqual(forwardTarget("/rnode/localhost/3000"), { port: 3000, path: "/" }, "a bare port is its root");
	assert.equal(forwardTarget("/api/deck"), undefined, "anything else is not ours");
	assert.equal(forwardTarget("/node/localhost/99999/"), undefined, "nor a port that cannot exist");
});

test("a port is opened, kept across a restart, closed, and Decks' own is refused", () => {
	const deck = mkdtempSync(join(tmpdir(), "ports-"));
	try {
		const forwards = new Forwards(deck, 4329);
		assert.throws(() => forwards.open(4329), /Decks itself/);
		assert.throws(() => forwards.open("8766"), /whole number/);
		forwards.open(8766, { label: "VS Code", by: "Ray" });
		assert.deepEqual(new Forwards(deck, 4329).all().map((one) => [one.port, one.label, one.by]), [[8766, "VS Code", "Ray"]], "read back from disk");
		assert.equal(forwards.close(8766), true);
		assert.equal(forwards.close(8766), false, "closing twice says it was not open");
		assert.deepEqual(new Forwards(deck, 4329).all(), []);
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a forwarded port answers through Decks, websockets too, and an unopened one does not", async () => {
	const deck = mkdtempSync(join(tmpdir(), "ports-"));
	// The server being forwarded to: says what path it saw, and echoes on a websocket.
	const target = createServer((req, res) => res.end(`saw ${req.method} ${req.url} host=${req.headers["x-forwarded-host"]}`));
	const echo = new WebSocketServer({ server: target });
	echo.on("connection", (socket, req) => socket.on("message", (data) => socket.send(`${req.url} ${data}`)));
	const targetPort = await listen(target);

	const forwards = new Forwards(deck, 1);
	const decks = createServer((req, res) => {
		if (!forwardRequest(req, res, forwards)) res.writeHead(418).end();
	});
	decks.on("upgrade", (req, socket, head) => {
		if (!forwardUpgrade(req, socket, head, forwards)) socket.destroy();
	});
	const decksPort = await listen(decks);
	const base = `http://127.0.0.1:${decksPort}`;
	try {
		const shut = await fetch(`${base}/rnode/localhost/${targetPort}/hello`);
		assert.equal(shut.status, 404, "nothing is forwarded until an agent opens it");
		assert.match(await shut.text(), /stage\.ports\(\{ open:/);

		forwards.open(targetPort);
		assert.equal(await (await fetch(`${base}/rnode/localhost/${targetPort}/hello?a=1`)).text(), `saw GET /hello?a=1 host=127.0.0.1:${decksPort}`);
		const kept = await fetch(`${base}/node/localhost/${targetPort}/x`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
		assert.equal(await kept.text(), `saw POST /node/localhost/${targetPort}/x host=127.0.0.1:${decksPort}`, "node keeps the prefix, and a body goes through");
		assert.equal((await fetch(`${base}/api/deck`)).status, 418, "the rest of the app is untouched");

		const reply = await new Promise<string>((resolve, reject) => {
			const socket = new WebSocket(`ws://127.0.0.1:${decksPort}/rnode/localhost/${targetPort}/live`);
			socket.on("open", () => socket.send("ping"));
			socket.on("message", (data) => {
				resolve(String(data));
				socket.close();
			});
			socket.on("error", reject);
		});
		assert.equal(reply, "/live ping", "a websocket goes through, with the prefix taken off");

		forwards.close(targetPort);
		assert.equal((await fetch(`${base}/rnode/localhost/${targetPort}/hello`)).status, 404, "and closing it stops it");
	} finally {
		echo.close();
		await closed(decks);
		await closed(target);
		rmSync(deck, { recursive: true, force: true });
	}
});

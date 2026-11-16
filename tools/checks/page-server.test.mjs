// The checks' page server: the dev server's proxy rules, the token in index.html, and sockets passed through.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proxied, startPageServer, withSession } from "./page-server.mjs";

/** Every temp folder a test here makes, removed when the file's tests end. */
const made = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

test("the dev server's paths go to Decks-local; the page's own are served", () => {
	for (const path of ["/api", "/api/v1/x", "/files/a.png", "/compat/v1/socket", "/ws", "/frame-assets/a.js", "/app/x/"]) assert.ok(proxied(path), path);
	for (const path of ["/", "/index.html", "/assets/a.js", "/canvas-frame.html", "/apiary"]) assert.ok(!proxied(path), path);
	assert.match(withSession("<html><head><title>x</title></head>", "tok"), /<head><meta name="decks-session" content="tok">/);
});

function upstream() {
	const server = createServer((req, res) => res.end(`up ${req.method} ${req.url}`));
	server.on("upgrade", (req, socket) => {
		server.sockets = [...(server.sockets ?? []), socket];
		const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
		socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
		socket.write(Buffer.from([0x81, 2, 0x68, 0x69])); // "hi"
	});
	return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

test("the built page is served with the token, and HTTP and sockets reach Decks-local", async () => {
	const up = await upstream();
	const scratch = mkdtempSync(join(tmpdir(), "page-"));
	made.push(scratch);
	const dist = join(scratch, "dist");
	const deck = join(scratch, "deck");
	mkdirSync(dist);
	mkdirSync(join(deck, ".decks"), { recursive: true });
	writeFileSync(join(dist, "index.html"), "<html><head></head><body>app</body></html>");
	writeFileSync(join(deck, ".decks/server.json"), JSON.stringify({ url: `http://127.0.0.1:${up.address().port}`, token: "tok" }));
	const page = await startPageServer({ dist, deck, port: 0 });
	const at = `http://127.0.0.1:${page.address().port}`;
	assert.match(await (await fetch(`${at}/`)).text(), /decks-session" content="tok"/);
	assert.match(await (await fetch(`${at}/somewhere`)).text(), /app/, "an address with no file is the app");
	assert.deepEqual(await (await fetch(`${at}/page.json`)).json(), { url: "", token: "tok" });
	assert.equal(await (await fetch(`${at}/api/v1/x`, { method: "POST" })).text(), "up POST /api/v1/x");
	const said = await new Promise((done, fail) => {
		const ws = new WebSocket(`${at.replace("http", "ws")}/compat/v1/socket`);
		ws.onmessage = (m) => (ws.close(), done(String(m.data)));
		ws.onerror = fail;
	});
	assert.equal(said, "hi");
	// Keep-alive connections would hold both servers open after close: end them too.
	page.closeAllConnections();
	page.close();
	up.closeAllConnections();
	for (const socket of up.sockets ?? []) socket.destroy();
	up.close();
});

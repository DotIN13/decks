import assert from "node:assert/strict";
import { get } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";
import { commandAllowed, credentialsOf, fromBrowser, isCommand, isTopNavigation, PersonKey, personKeyOf, withPersonKey } from "./person-key.ts";

/** A GET with exactly these headers: Node's fetch puts its own `Sec-Fetch-Mode` over the one given. */
function getPage(url: string, headers: Record<string, string>): Promise<{ html: string; headers: Record<string, string | string[] | undefined> }> {
	return new Promise((done, fail) => {
		get(url, { headers }, (response) => {
			let html = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => (html += chunk));
			response.on("end", () => done({ html, headers: response.headers }));
		}).on("error", fail);
	});
}

/** A harness with one board on a free port. */
async function open() {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-person-key-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	writeFileSync(join(deck, "boards", "a.html"), `<!doctype html><html><head><title>A</title><meta name="board" content='{"w":400,"h":300}' /></head><body></body></html>`);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	/** What a page on the harness's own address sends: the browser's own headers. */
	const page = { origin, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "content-type": "application/json" };
	const post = async (path: string, headers: Record<string, string>, body: unknown = { args: [] }) => {
		const response = await fetch(`${origin}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
		return { status: response.status, text: await response.text() };
	};
	return {
		app,
		origin,
		page,
		post,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("a same-origin page gives no command without credentials, however it names itself", async () => {
	const { app, origin, page, post, cleanup } = await open();
	try {
		assert.equal((await post("/api/v1/agent.list", { ...page, "x-decks-person": "1" })).status, 401, "X-Decks-Person alone");
		assert.equal((await post("/api/v1/now", { ...page, "x-decks-board": "boards%2Fa.html" })).status, 401, "X-Decks-Board alone");
		assert.equal((await post("/api/v1/now", { ...page, "x-decks-agent": app.agents.focused().id })).status, 401, "an agent's name");
		assert.equal((await post("/api/relay", page, { id: "abcd", base: "http://x.test", token: "t" })).status, 401, "a route other than the verbs");
		assert.equal((await post("/c/abcd/api/v1/now", page)).status, 401, "another server passed through this one");
		const upload = await fetch(`${origin}/api/upload?name=x.txt`, { method: "POST", headers: page, body: "not json" });
		assert.equal(upload.status, 401, "refused before its body is read");
		// Without Sec-Fetch-Site, as on a plain http:// address: the Origin alone says it is a browser.
		const { "sec-fetch-site": _site, ...plain } = page;
		assert.equal((await post("/api/v1/agent.list", { ...plain, "x-decks-person": "1" })).status, 401, "Origin only");
		// A wrong key is no key.
		assert.equal((await post("/api/v1/agent.list", { ...page, "x-decks-person": "1", "x-decks-key": "guess" })).status, 401, "a wrong key");
	} finally {
		cleanup();
	}
});

test("the Decks page's person key makes it the person, and lets it name a board it framed", async () => {
	const { app, page, post, cleanup } = await open();
	try {
		const key = { ...page, "x-decks-key": app.personKey.value };
		const listed = await post("/api/v1/agent.list", { ...key, "x-decks-person": "1" });
		assert.equal(listed.status, 200, listed.text);
		app.evalTrust.allow("boards/a.html");
		const board = await post("/api/v1/now", { ...key, "x-decks-board": encodeURIComponent("boards/a.html") });
		assert.equal(board.status, 200, board.text);
	} finally {
		cleanup();
	}
});

test("a program on this machine with no browser headers calls as before, the person included", async () => {
	const { app, origin, cleanup } = await open();
	try {
		const call = (headers: Record<string, string>) => fetch(`${origin}/api/v1/agent.list`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: '{"args":[]}' });
		assert.equal((await call({ "x-decks-person": "1" })).status, 200, "the person, as studio sync calls");
		assert.equal((await call({ "x-decks-agent": app.agents.focused().id })).status, 200, "an agent's decks command");
		// Passed on by a proxy on this machine, it is no longer this machine: a browser behind it may say anything.
		assert.equal((await call({ "x-decks-person": "1", "x-forwarded-for": "100.64.0.9" })).status, 401, "through a proxy");
	} finally {
		cleanup();
	}
});

test("the socket's rule: a browser needs the key or a token, a program on this machine does not", () => {
	const key = new PersonKey("k".repeat(43));
	const pairing = { verdict: (token: string | undefined) => (token === "good" ? ("paired" as const) : ("unpaired" as const)) };
	const loopback = { remoteAddress: "127.0.0.1" };
	const browser = { origin: "http://127.0.0.1:4329" };
	assert.equal(credentialsOf({ headers: browser, url: "/ws", socket: loopback }, key, pairing), undefined);
	assert.equal(credentialsOf({ headers: browser, url: `/ws?decks_key=${key.value}`, socket: loopback }, key, pairing), "key");
	assert.equal(credentialsOf({ headers: browser, url: "/ws?decks_token=good", socket: loopback }, key, pairing), "token");
	assert.equal(credentialsOf({ headers: {}, url: "/ws", socket: loopback }, key, pairing), "machine");
	assert.equal(credentialsOf({ headers: {}, url: "/ws", socket: { remoteAddress: "100.64.0.9" } }, key, pairing), undefined);
	assert.equal(personKeyOf({ "x-decks-key": "a" }, "/ws?decks_key=b"), "a", "the header wins");
});

test("what is a command, and which open routes stay open", () => {
	const key = new PersonKey();
	const pairing = { verdict: () => "unpaired" as const };
	const browser = { origin: "http://127.0.0.1:4329", "sec-fetch-site": "same-origin" };
	const ask = (method: string, path: string) => commandAllowed({ method, path, headers: browser, originalUrl: path, socket: { remoteAddress: "127.0.0.1" } }, key, pairing);
	assert.equal(ask("GET", "/api/deck"), true, "a read");
	assert.equal(ask("HEAD", "/api/board/boards/a.html"), true);
	assert.equal(ask("POST", "/api/pair"), true);
	assert.equal(ask("POST", "/api/studio/connect"), true);
	assert.equal(ask("POST", "/api/upload"), false);
	assert.equal(ask("POST", "/api/agents/x/stop"), false);
	assert.equal(ask("DELETE", "/api/anything"), false);
	assert.equal(ask("POST", "/app/x/form"), true, "an app's own server answers its own pages");
	assert.equal(isCommand("PUT", "/c/ab/api/x"), true);
	assert.equal(fromBrowser({ "user-agent": "node", "sec-fetch-mode": "cors" }), false, "Node's fetch is not a browser");
});

test("the person key is written only into a page opened in a tab, never stored, alone in its window group", async (t) => {
	const { existsSync } = await import("node:fs");
	const dist = new URL("../../../web/dist/index.html", import.meta.url);
	assert.equal(isTopNavigation({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }), true);
	assert.equal(isTopNavigation({ "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }), false);
	assert.equal(isTopNavigation({ "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }), false);
	assert.equal(isTopNavigation({}), false, "no Fetch Metadata at all: not given it");
	assert.equal(withPersonKey("<!doctype html><html><head><title>x</title></head></html>", "K"), '<!doctype html><html><head><meta name="decks-person-key" content="K"><title>x</title></head></html>');
	if (!existsSync(dist)) {
		t.skip("no built web app to serve");
		return;
	}
	const { app, origin, cleanup } = await open();
	try {
		const tag = `<meta name="decks-person-key" content="${app.personKey.value}">`;
		for (const path of ["/", "/index.html", "/some/route"]) {
			const tab = await getPage(`${origin}${path}`, { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" });
			assert.ok(tab.html.includes(tag), `a tab at ${path} is given the key`);
			assert.equal(tab.headers["cross-origin-opener-policy"], "same-origin");
			assert.equal(tab.headers["cache-control"], "no-store");
		}
		const frame = await getPage(`${origin}/`, { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin" });
		assert.ok(!frame.html.includes("decks-person-key"), "a frame is not");
		const script = await getPage(`${origin}/`, { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" });
		assert.ok(!script.html.includes("decks-person-key"), "a script's fetch is not");
		assert.equal(script.headers["cross-origin-opener-policy"], "same-origin");
		const opened = await getPage(`${origin}/`, { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-origin", "accept-encoding": "br, gzip" });
		assert.ok(opened.html.includes(tag) || opened.headers["content-encoding"] === undefined, "the compressed copy is not served in its place");
	} finally {
		cleanup();
	}
});

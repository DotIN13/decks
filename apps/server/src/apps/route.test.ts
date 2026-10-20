import assert from "node:assert/strict";
import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { appRequest, withoutToken } from "./route.ts";
import type { Apps } from "./service.ts";

function listen(server: Server): Promise<number> {
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

test("a request the browser drops closes the app's side too", async () => {
	// The app streams far more than a socket buffers, as a video does, and says when its socket closes.
	let appClosed!: () => void;
	const closed = new Promise<void>((resolve) => (appClosed = resolve));
	const app = createServer((_req, res) => {
		res.socket?.on("close", appClosed);
		res.writeHead(200, { "content-type": "video/mp4" });
		const chunk = Buffer.alloc(1 << 20);
		const write = (): void => {
			while (res.write(chunk));
			res.once("drain", write);
		};
		write();
	});
	const appPort = await listen(app);
	const apps = {
		exists: () => true,
		manifest: () => ({ kind: "server" }),
		seen: () => {},
		portFor: async () => appPort,
	} as unknown as Apps;
	const decks = createServer((req, res) => void appRequest(req, res as Parameters<typeof appRequest>[1], apps));
	const decksPort = await listen(decks);

	await new Promise<void>((resolve) => {
		const req = get({ host: "127.0.0.1", port: decksPort, path: "/app/review/draft.mp4" }, (res) => {
			res.once("data", () => {
				req.destroy();
				resolve();
			});
		});
	});
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("the app's socket stayed open")), 3000)));
	try {
		await Promise.race([closed, timeout]);
	} finally {
		clearTimeout(timer);
		decks.closeAllConnections();
		decks.close();
		app.closeAllConnections();
		app.close();
	}
});

test("the app never sees Decks' pairing token or X-Decks headers, and keeps its own bearer token", async () => {
	let seen: { url?: string; headers: Record<string, unknown> } = { headers: {} };
	const app = createServer((req, res) => {
		seen = { url: req.url, headers: req.headers };
		res.end("ok");
	});
	const appPort = await listen(app);
	const apps = { exists: () => true, manifest: () => ({ kind: "server" }), seen: () => {}, portFor: async () => appPort } as unknown as Apps;
	const decks = createServer((req, res) => void appRequest(req, res as Parameters<typeof appRequest>[1], apps, (token) => token === "paired"));
	const decksPort = await listen(decks);
	const ask = async (path: string, headers: Record<string, string>) => {
		const response = await fetch(`http://127.0.0.1:${decksPort}${path}`, { headers });
		await response.text();
		return response.status;
	};
	try {
		assert.equal(await ask("/app/x/items?a=1&decks_token=paired&b=2", { authorization: "Bearer paired", "x-decks-agent": "a1", "x-decks-person": "1" }), 200);
		assert.equal(seen.url, "/items?a=1&b=2");
		assert.equal(seen.headers.authorization, undefined);
		assert.equal(seen.headers["x-decks-agent"], undefined);
		assert.equal(seen.headers["x-decks-person"], undefined);
		assert.equal(await ask("/app/x/items", { authorization: "Bearer the-apps-own" }), 200);
		assert.equal(seen.headers.authorization, "Bearer the-apps-own");

		assert.equal(await ask("/app/x/", { "sec-fetch-site": "cross-site" }), 403, "another site");
		assert.equal(await ask("/app/x/", { "sec-fetch-site": "same-site" }), 403, "a sibling site");
		assert.equal(await ask("/app/x/", { origin: "http://evil.test" }), 403, "an Origin that is not this host");
		assert.equal(await ask("/app/x/", { "sec-fetch-site": "cross-site", authorization: "Bearer paired" }), 200, "a paired site");
		assert.equal(await ask("/app/x/?decks_token=paired", { "sec-fetch-site": "cross-site" }), 200, "a paired site, token in the address");
		assert.equal(await ask("/app/x/", { "sec-fetch-site": "cross-site", authorization: "Bearer wrong" }), 403);
		assert.equal(await ask("/app/x/", { "sec-fetch-site": "same-origin" }), 200);
		assert.equal(await ask("/app/x/", { "sec-fetch-site": "none" }), 200);
		assert.equal(await ask("/app/x/", { origin: `http://127.0.0.1:${decksPort}` }), 200);
	} finally {
		decks.closeAllConnections();
		decks.close();
		app.closeAllConnections();
		app.close();
	}
});

test("only decks_token leaves the query", () => {
	assert.equal(withoutToken(""), "");
	assert.equal(withoutToken("?a=1"), "?a=1");
	assert.equal(withoutToken("?decks_token=x"), "");
	assert.equal(withoutToken("?decks_token=x&q=a%20b"), "?q=a+b");
});

test("another site opens an app with a ticket for it, which the app never sees, and a token copied to another site is refused", async () => {
	let seen: { url?: string } = {};
	const app = createServer((req, res) => {
		seen = { url: req.url };
		res.end("ok");
	});
	const appPort = await listen(app);
	const apps = { exists: () => true, manifest: () => ({ kind: "server" }), seen: () => {}, portFor: async () => appPort } as unknown as Apps;
	const paired = (token: string | undefined, origin?: string) => token === "paired" && (!origin || origin === "https://studio.test");
	const ticketed = (ticket: string | undefined, path: string | undefined) => ticket === "good" && !!path?.startsWith("/app/x/");
	const decks = createServer((req, res) => void appRequest(req, res as Parameters<typeof appRequest>[1], apps, paired, ticketed));
	const decksPort = await listen(decks);
	const ask = async (path: string, headers: Record<string, string>, method = "GET") => {
		const response = await fetch(`http://127.0.0.1:${decksPort}${path}`, { method, headers });
		await response.text();
		return { status: response.status, referrer: response.headers.get("referrer-policy") };
	};
	try {
		const opened = await ask("/app/x/page?a=1&decks_ticket=good", { "sec-fetch-site": "cross-site" });
		assert.equal(opened.status, 200, "a frame with a ticket for the app");
		assert.equal(opened.referrer, "no-referrer", "its address, ticket and all, is not sent on");
		assert.equal(seen.url, "/page?a=1");
		assert.equal((await ask("/app/y/?decks_ticket=good", { "sec-fetch-site": "cross-site" })).status, 403, "another app");
		assert.equal((await ask("/app/x/?decks_ticket=bad", { "sec-fetch-site": "cross-site" })).status, 403, "a ticket that does not check out");
		assert.equal((await ask("/app/x/?decks_ticket=good", { "sec-fetch-site": "cross-site" }, "POST")).status, 403, "a ticket admits a GET only");
		assert.equal((await ask("/app/x/", { "sec-fetch-site": "cross-site", origin: "https://studio.test", authorization: "Bearer paired" })).status, 200);
		assert.equal((await ask("/app/x/", { "sec-fetch-site": "cross-site", origin: "https://evil.test", authorization: "Bearer paired" })).status, 403, "the token, from a page on another site");
	} finally {
		decks.closeAllConnections();
		decks.close();
		app.closeAllConnections();
		app.close();
	}
});

test("a ticket leaves the query as the token does", () => {
	assert.equal(withoutToken("?decks_ticket=t"), "");
	assert.equal(withoutToken("?a=1&decks_ticket=t&decks_token=x"), "?a=1");
});

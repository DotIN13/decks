import { test } from "node:test";
import assert from "node:assert/strict";
import { testServer } from "../testing.ts";
import { defineFeature, type Route } from "../types.ts";

// Feature routes: a public GET needs no token even from a module script, a
// raw route sees the request unbuffered, an upgrade under a prefix gets the
// kernel's socket parts, an upgrade hook runs before start, url() is set.

const routes: Route[] = [
	{ method: "GET", prefix: "/frame/", public: true, answer: async (ctx, path) => ({ type: "text/plain", body: `${ctx.caller.id}:${path}` }) },
	{ method: "ANY", prefix: "/app/", serve: async (ctx, req, res) => void res.writeHead(200, { "content-type": "text/plain" }).end(`${req.method} ${req.headers["x-thing"]} ${ctx.caller.id}`) },
	{
		method: "GET",
		prefix: "/line/",
		upgrade(req, socket, _head, door) {
			if (!req.url?.includes("code=ok")) return void socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
			const peer = door.accept();
			peer?.onText((text) => peer.send(`echo ${text}`));
		},
	},
];

test("public, raw and upgrade routes, the upgrade hook and url()", async () => {
	const order: string[] = [];
	const feature = defineFeature({ name: "pages", calls: [], routes, upgrade: async () => void order.push("upgrade"), start: () => void order.push("start") });
	const server = await testServer({ features: [feature] });
	assert.deepEqual(order, ["upgrade", "start"]);
	assert.equal(server.kernel.url(), undefined);
	const doors = await server.listen(4620);
	assert.equal(server.kernel.url(), doors.url);
	const page = await fetch(`${doors.url}/frame/a.js`, { headers: { origin: "https://x.example" } });
	assert.equal(await page.text(), "public:/frame/a.js");
	assert.equal((await fetch(`${doors.url}/app/x`, { method: "PUT" })).status, 401);
	const raw = await fetch(`${doors.url}/app/x`, { method: "PUT", headers: { authorization: `Bearer ${doors.token}`, "x-thing": "yes" } });
	assert.equal(await raw.text(), "PUT yes person");
	const echoed = await new Promise<string>((done) => {
		const ws = new WebSocket(`${doors.url.replace("http", "ws")}/line/relay?code=ok`);
		ws.onopen = () => ws.send("hi");
		ws.onmessage = (m) => (ws.close(), done(String(m.data)));
	});
	assert.equal(echoed, "echo hi");
	const refused = await new Promise<boolean>((done) => {
		const ws = new WebSocket(`${doors.url.replace("http", "ws")}/line/relay?code=bad`);
		ws.onerror = () => done(true);
		ws.onopen = () => done(false);
	});
	assert.equal(refused, true);
	await doors.close();
	await server.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryVersion, testServer } from "../testing.ts";
import { defineFeature, type Route, type VersionFile } from "../types.ts";

// Feature routes: a public GET needs no token even from a module script, a
// raw route sees the request unbuffered, an upgrade under a prefix gets the
// kernel's socket parts, an upgrade hook runs before start, url() is set.

const routes: Route[] = [
	{ method: "GET", prefix: "/frame/", public: true, answer: async (ctx, path) => ({ type: "text/plain", body: `${ctx.caller.id}:${path}` }) },
	{
		method: "GET",
		prefix: "/app/t/",
		tokenOf: (url) => {
			const m = /^\/app\/t\/([^/]+)(\/.*)$/.exec(url.pathname);
			return m ? { token: m[1]!, path: `/app${m[2]}` } : undefined;
		},
		serve: async (ctx, req, res) => void res.writeHead(200).end(`${req.url} ${ctx.caller.id}`),
	},
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
	const upgrade = async (_deck: unknown, version: VersionFile) => {
		order.push(`upgrade from ${await version.read()}`);
		await version.write("2");
	};
	const feature = defineFeature({ name: "pages", calls: [], routes, upgrade, start: () => void order.push("start") });
	const version = memoryVersion("1");
	const server = await testServer({ features: [feature], version });
	assert.deepEqual(order, ["upgrade from 1", "start"]);
	assert.equal(await version.read(), "2");
	assert.equal(server.kernel.url(), undefined);
	const doors = await server.listen(4620);
	assert.equal(server.kernel.url(), doors.url);
	const page = await fetch(`${doors.url}/frame/a.js`, { headers: { origin: "https://x.example" } });
	assert.equal(await page.text(), "public:/frame/a.js");
	assert.equal((await fetch(`${doors.url}/app/x`, { method: "PUT" })).status, 401);
	const raw = await fetch(`${doors.url}/app/x`, { method: "PUT", headers: { authorization: `Bearer ${doors.token}`, "x-thing": "yes" } });
	assert.equal(await raw.text(), "PUT yes person");
	const inPath = await fetch(`${doors.url}/app/t/${doors.token}/notes/style.css?v=1`);
	assert.equal(await inPath.text(), "/app/notes/style.css?v=1 person");
	assert.equal((await fetch(`${doors.url}/app/t/bad/notes/style.css`)).status, 401);
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

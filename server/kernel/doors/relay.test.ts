import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "../../../protocol/index.ts";
import { testServer } from "../testing.ts";
import { defineFeature } from "../types.ts";

// One door for the page: a harness call made at the server's HTTP door goes
// to the host that answers it, as an ask on that host's socket, and its reply
// comes back. No host, or the host gone, answers unavailable. A host's tell
// of a harness event reaches the server's stream.

type Json = any;
const post = async (url: string, token: string, name: string, args: unknown): Promise<Json> =>
	(await fetch(`${url}/api/v1/${name}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) })).json();

/** A host on a raw socket: answers chat.list with one entry, or never when silent. */
function fakeHost(url: string, token: string, silent = false): Promise<{ ws: WebSocket; id: string }> {
	const ws = new WebSocket(`${url.replace("http", "ws")}/api/v1/socket`);
	return new Promise((ready) => {
		ws.onopen = () => ws.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
		ws.onmessage = (m) => {
			const message = JSON.parse(String(m.data));
			if (message.type === "hello") ready({ ws, id: "" });
			if (message.type === "ask" && !silent) {
				const value = [{ kind: "user", id: "e1", text: message.caller.id, at: 1 }];
				ws.send(JSON.stringify({ type: "reply", id: message.id, envelope: { ok: true, value, notes: ["from the host"] } }));
			}
		};
	});
}

/** Stands in for the people feature: the newest connected socket answers every harness call. */
function hostsFeature() {
	const seen: { clients: string[] } = { clients: [] };
	const feature = defineFeature({ name: "hosts", calls: [], start: (kernel) => kernel.relay(() => seen.clients.at(-1)) });
	return { feature, seen };
}

test("a harness call at the HTTP door is answered by the connected host", async () => {
	const { feature, seen } = hostsFeature();
	const server = await testServer({ features: [feature] });
	const doors = await server.listen(4627);
	const none = await post(doors.url, doors.token, "chat.list", { agent: "ann" });
	assert.equal(none.error.code, "unavailable");
	assert.match(none.error.message, /No harness is connected/);
	const host = await fakeHost(doors.url, doors.token);
	seen.clients.push([...(server.relay as unknown as { sockets: Map<string, unknown> }).sockets.keys()].at(-1)!);
	const answer = await post(doors.url, doors.token, "chat.list", { agent: "ann" });
	assert.equal(answer.ok, true);
	assert.equal(answer.value[0].text, "person");
	assert.deepEqual(answer.notes, ["from the host"]);
	assert.equal((await post(doors.url, doors.token, "chat.list", { agent: 3 })).error.code, "invalid");
	host.ws.close();
	await new Promise((r) => setTimeout(r, 50));
	assert.equal((await post(doors.url, doors.token, "chat.list", { agent: "ann" })).error.code, "unavailable");
	await doors.close();
	await server.close();
});

test("a host that never replies, or goes, answers unavailable", async () => {
	const { feature, seen } = hostsFeature();
	const server = await testServer({ features: [feature], relayWaitMs: 400 });
	const doors = await server.listen(4628);
	const host = await fakeHost(doors.url, doors.token, true);
	seen.clients.push([...(server.relay as unknown as { sockets: Map<string, unknown> }).sockets.keys()].at(-1)!);
	const late = await post(doors.url, doors.token, "chat.list", { agent: "ann" });
	assert.match(late.error.message, /did not answer chat.list/);
	const pending = post(doors.url, doors.token, "chat.list", { agent: "ann" });
	setTimeout(() => host.ws.close(), 20);
	assert.match((await pending).error.message, /went away|did not answer/);
	await doors.close();
	await server.close();
});

test("a person's host tells a harness event; anything else is dropped", async () => {
	const server = await testServer();
	const doors = await server.listen(4629);
	const host = await fakeHost(doors.url, doors.token);
	host.ws.send(JSON.stringify({ type: "tell", name: "chat.changed", payload: { ids: ["ann"], by: "ann", rev: 1 } }));
	host.ws.send(JSON.stringify({ type: "tell", name: "item.changed", payload: { canvas: "a", ids: [], by: "x", rev: 1 } }));
	host.ws.send(JSON.stringify({ type: "tell", name: "chat.changed", payload: { wrong: true } }));
	await new Promise((r) => setTimeout(r, 50));
	assert.deepEqual(server.heard.map((one) => one.name), ["chat.changed"]);
	host.ws.close();
	await doors.close();
	await server.close();
});

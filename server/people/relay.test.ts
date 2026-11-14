import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, SOCKET_PATH, callPath } from "../../protocol/index.ts";
import { testServer } from "../kernel/testing.ts";
import { peopleFeature } from "./feature.ts";

// One door for the page: a host on the socket offers chat.list with
// agent.host; a person's chat.list over HTTP gets the host's answer, and with
// the host gone the call is unavailable. Kernel, people and wire together.

type Frame = { type: string; id?: string; name?: string; envelope?: { ok: boolean }; args?: unknown };

/** A host on a real WebSocket, answering every request with the given value. */
async function fakeHost(url: string, token: string, answer: (name: string) => unknown) {
	const ws = new WebSocket(`${url.replace(/^http/, "ws")}${SOCKET_PATH}`);
	const frames: Frame[] = [];
	const waiting = new Map<string, (f: Frame) => void>();
	ws.addEventListener("message", (e) => {
		const frame = JSON.parse(String(e.data)) as Frame;
		frames.push(frame);
		if (frame.type === "answer" && frame.id) waiting.get(frame.id)?.(frame);
		if (frame.type === "ask") ws.send(JSON.stringify({ type: "reply", id: frame.id, envelope: { ok: true, value: answer(frame.name!), notes: [] } }));
	});
	await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
	ws.send(JSON.stringify({ type: "hello", token, protocol: PROTOCOL_VERSION }));
	const call = (name: string, args: unknown) =>
		new Promise<Frame>((ok) => {
			const id = `c${frames.length}-${name}`;
			waiting.set(id, ok);
			ws.send(JSON.stringify({ type: "call", id, name, args }));
		});
	return { ws, frames, call, close: () => ws.close() };
}

async function post(url: string, token: string, name: string, args: unknown) {
	const res = await fetch(`${url}${callPath(name)}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
	return (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string; message: string } };
}

test("a host's chat.list answers a person's call through the HTTP door, and is unavailable once it goes", async () => {
	const server = await testServer({ features: [peopleFeature()] });
	const doors = await server.listen(4651);
	try {
		const before = await post(doors.url, doors.token, "chat.list", { agent: "a1" });
		assert.equal(before.error?.code, "unavailable", "no host yet");
		const host = await fakeHost(doors.url, doors.token, () => []);
		const offered = await host.call("agent.host", { kinds: ["claude"], calls: ["chat.list"] });
		assert.equal(offered.envelope?.ok, true, JSON.stringify(offered.envelope));
		const answered = await post(doors.url, doors.token, "chat.list", { agent: "a1" });
		assert.deepEqual(answered, { ok: true, value: [], notes: [] });
		assert.ok(host.frames.some((f) => f.type === "ask" && f.name === "chat.list"), "the host got the request");
		host.close();
		await new Promise((ok) => setTimeout(ok, 100));
		const after = await post(doors.url, doors.token, "chat.list", { agent: "a1" });
		assert.equal(after.error?.code, "unavailable", "the offer went with the socket");
	} finally {
		await doors.close();
		await server.close();
	}
});

test("a host may offer only the harness's own calls", async () => {
	const server = await testServer({ features: [peopleFeature()] });
	const doors = await server.listen(4652);
	try {
		const host = await fakeHost(doors.url, doors.token, () => null);
		const odd = await host.call("agent.host", { kinds: [], calls: ["item.list"] });
		assert.equal(odd.envelope?.ok, false);
		host.close();
		const http = await post(doors.url, doors.token, "agent.host", { kinds: [], calls: ["chat.list"] });
		assert.equal(http.error?.code, "invalid", "an offer needs the socket");
	} finally {
		await doors.close();
		await server.close();
	}
});

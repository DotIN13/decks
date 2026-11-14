import { test } from "node:test";
import assert from "node:assert/strict";
import { Refused } from "../../protocol/index.ts";
import { clientFor, host, type Heard } from "../../clients/sdk/index.ts";
import { features } from "../../server/main.ts";
import { callers, testServer } from "../../server/kernel/testing.ts";

// One door for the page: a harness call made at the server's HTTP door is
// relayed to the host that offered it, through Keel's relay and Roster's
// offer, and answered by the SDK's host(). With no host, unavailable.

const entries = [{ id: "e1", kind: "user", at: 1, text: "hello" }];

test("chat.list at the HTTP door is answered by the host that offered it", async () => {
	const server = await testServer({ features: features() });
	const doors = await server.listen(4602);
	const personToken = server.token(callers.person);
	const page = clientFor(doors.url, personToken);
	try {
		await assert.rejects(page.call("chat.list", { agent: "a1" }), { code: "unavailable" });
		const seen: string[] = [];
		const harness = await host({
			url: doors.url,
			token: personToken,
			kinds: ["claude"],
			answers: {
				"chat.list": (args, caller) => {
					seen.push(`${caller.kind}:${String(args.agent)}`);
					return entries;
				},
				"chat.get": () => {
					throw new Refused("not_found", "No entry called zz.", "chat.list");
				},
			},
		});
		assert.deepEqual((await page.call("chat.list", { agent: "a1" })).value, entries);
		assert.deepEqual(seen, ["person:a1"]);
		await assert.rejects(page.call("chat.get", { agent: "a1", item: "zz" }), { code: "not_found", message: "No entry called zz.", hint: "chat.list" });
		await assert.rejects(page.call("account.list", {}), { code: "unavailable" });

		const heard: Heard[] = [];
		const stream = page.events((event) => heard.push(event), { events: ["chat.added"] });
		await new Promise((resolve) => setTimeout(resolve, 150));
		harness.tell("chat.added", { ids: ["a1"], by: "a1", rev: 1, item: entries[0] });
		await new Promise((resolve) => setTimeout(resolve, 150));
		stream.stop();
		assert.equal(heard[0]?.name, "chat.added");

		harness.close();
		await harness.closed;
		await new Promise((resolve) => setTimeout(resolve, 50));
		await assert.rejects(page.call("chat.list", { agent: "a1" }), { code: "unavailable" });
	} finally {
		await doors.close();
		await server.close();
	}
});

test("agent.create reaches the host that offers the kind, as agent.requested", async () => {
	const server = await testServer({ features: features() });
	const doors = await server.listen(4601);
	const personToken = server.token(callers.person);
	try {
		const started: string[] = [];
		const harness = await host({ url: doors.url, token: personToken, kinds: ["claude"], start: (_spec, agent) => void started.push(agent) });
		const made = (await clientFor(doors.url, personToken).call("agent.create", { kind: "claude", name: "Moth" })).value as { id: string };
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.deepEqual(started, [made.id]);
		harness.close();
	} finally {
		await doors.close();
		await server.close();
	}
});

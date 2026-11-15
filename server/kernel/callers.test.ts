import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "./testing.ts";

// A token stands for the caller it was issued to, as that caller is now,
// until it is revoked.

test("a token issued to a caller resolves to it until revoked, and describe gives its current name", async () => {
	const server = await testServer();
	const token = server.token(callers.agent("ann", "plans"));
	assert.equal(server.callers.resolve(token)?.id, "ann");
	server.callers.describe("agent", (id) => (id === "ann" ? { kind: "agent", id, name: "Ann Renamed" } : undefined));
	assert.equal(server.callers.resolve(token)?.name, "Ann Renamed");
	const person = server.token({ kind: "person", id: "term-1", name: "terminal" });
	server.callers.describe("person", (_id, issued) => ({ ...issued, canvas: "on-screen" }));
	assert.deepEqual(server.callers.resolve(person), { kind: "person", id: "term-1", name: "terminal", canvas: "on-screen" });
	server.callers.revoke("ann");
	assert.equal(server.callers.resolve(token), undefined);
	await server.close();
});

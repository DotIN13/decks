import { test } from "node:test";
import assert from "node:assert/strict";
import * as wire from "./wire.ts";

// Where a call, the socket and the lock file are.

test("the wire: one path per call, the socket and login beside them", () => {
	assert.equal(wire.callPath("item.move"), "/api/v1/item.move");
	assert.equal(wire.SOCKET_PATH, "/api/v1/socket");
	assert.equal(wire.LOCK_FILE, ".decks/server.json");
});

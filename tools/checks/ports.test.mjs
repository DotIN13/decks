// A slot's ports may still be closing when the slot is taken: the runner waits for them, and names a holder that never lets go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { canListen, portsFree } from "./ports.mjs";

const hold = (port) => new Promise((done) => { const s = createServer(); s.listen(port, "127.0.0.1", () => done(s)); });
const PORT = 4619;

test("a port released while waiting is waited for, not refused", async () => {
	const held = await hold(PORT);
	assert.equal(await canListen(PORT), false);
	setTimeout(() => held.close(), 400);
	const t = Date.now();
	await portsFree([PORT], { ms: 5000 });
	assert.ok(Date.now() - t >= 300, "it waited for the release");
	assert.equal(await canListen(PORT), true);
});

test("a port never released is refused after the wait, naming its holder", async () => {
	const held = await hold(PORT);
	await assert.rejects(portsFree([PORT], { ms: 300 }), /port 4619 is in use after 0 s: 4619 by pid \d+/);
	held.close();
});

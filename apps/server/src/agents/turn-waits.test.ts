import assert from "node:assert/strict";
import { test } from "node:test";
import { TurnWaits } from "./turn-waits.ts";

/** An agent as a wait reads it: busy or idle, how much is queued, its last words. */
function agent() {
	const self = { state: "idle" as "idle" | "thinking", queued: 0, reply: "" };
	return { self, now: () => ({ ...self }) };
}

test("a wait right after work is handed over waits for that turn, not the one before", async () => {
	const waits = new TurnWaits();
	const { self, now } = agent();
	waits.wentIdle(); // an earlier turn ended
	waits.asked(); // new work arrives; the turn has not started yet
	const waiting = waits.wait(now, 10_000);
	self.state = "thinking";
	setTimeout(() => {
		self.state = "idle";
		self.reply = "done";
		waits.wentIdle();
	}, 50);
	const answer = await waiting;
	assert.equal(answer.timedOut, false);
	assert.equal(answer.reply, "done");
});

test("work already done answers at once, and queued work keeps it waiting", async () => {
	const waits = new TurnWaits();
	const { self, now } = agent();
	waits.asked();
	waits.wentIdle();
	assert.equal((await waits.wait(now, 5_000)).timedOut, false, "idle after it was asked: done");
	self.queued = 1;
	assert.equal((await waits.wait(now, 300)).timedOut, true, "something queued: not done");
});

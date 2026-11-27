import assert from "node:assert/strict";
import { test } from "node:test";
import { Translator } from "../../agents/translator.ts";
import { ClaudeRecovery } from "./recovery.ts";

/*
 * The order of the four things that can follow a Claude turn, and that at most one restart
 * comes of them. The phrases are the ones `stale-session.ts` and `transient.ts` match.
 */

function recovery(other = true) {
	const notices: string[] = [];
	const translator = new Translator("A", () => {});
	const recovery = new ClaudeRecovery({ translator, notice: (_level, text) => void notices.push(text) }, () => other);
	const turn = (asked: string, replied: string) => {
		translator.user(asked);
		translator.startAssistant();
		translator.delta(replied);
		translator.endAssistant();
	};
	return { recovery, notices, turn, translator };
}

test("an ordinary turn asks for nothing, and an account move or a sign-in mid-turn asks for one restart", async () => {
	const { recovery: plain, turn } = recovery();
	turn("hello", "Hi.");
	assert.equal(plain.afterTurn("Hi."), undefined);

	const { recovery: both } = recovery();
	both.accountMovedMidTurn();
	const signedIn = both.signInMidTurn();
	assert.deepEqual(both.afterTurn("Hi."), { kind: "resume" });
	// Asked for once: the next turn owes nothing.
	assert.equal(both.afterTurn("Hi."), undefined);
	both.restarted();
	await signedIn;
});

test("moving back to the account the process started on owes no restart", () => {
	const { recovery: back } = recovery(false);
	back.accountMovedMidTurn();
	assert.equal(back.afterTurn("Hi."), undefined);
});

test("a stale session starts fresh and covers a pending sign-in, so only one restart comes of it", () => {
	const { recovery: one, translator, notices } = recovery();
	const said = "No conversation found with session ID: 1234";
	// Said as the turn's failure, with nothing done in the turn.
	translator.user("make the board");
	one.signInMidTurn();
	const action = one.afterTurn(said);
	assert.deepEqual(action, { kind: "fresh", ask: "make the board" });
	assert.match(notices.at(-1)!, /starts a fresh one and asks again/);
	// Asked once; a second stale answer is a sentence for the person.
	translator.user("make the board");
	assert.equal(one.afterTurn(said), undefined);
	assert.match(notices.at(-1)!, /cannot be asked again/);
});

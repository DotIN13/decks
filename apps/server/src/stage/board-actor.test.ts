import assert from "node:assert/strict";
import { test } from "node:test";
import { boardActor, type BoardConversation } from "./board-actor.ts";

/**
 * The actor a board is when it runs its own code.
 *
 * Two decisions are worth a test each, and both are about *not* inheriting something:
 *
 * - the id is the conversation's, so a board's `show` moves the canvas the person is
 *   looking at rather than being deferred against a conversation nobody will open;
 * - the identity is the board's, so `stage.me.setName` cannot rename a colleague.
 */

function conversation(over: Partial<BoardConversation> = {}) {
	const calls: string[] = [];
	const api: BoardConversation = {
		id: "agent-1",
		context: () => ["boards/plan.html"],
		setContext: (paths) => void calls.push(`setContext:${paths.join(",")}`),
		inPlay: () => ["boards/plan.html"],
		setInPlay: (paths) => void calls.push(`setInPlay:${paths.join(",")}`),
		positions: () => ({ "boards/plan.html": { x: 10, y: 20 } }),
		setPosition: (path, x, y) => void calls.push(`setPosition:${path}:${x},${y}`),
		camera: () => ({ x: 1, y: 2, zoom: 1 }),
		queue: () => [],
		agents: () => [],
		send: (fromId, target, spec) => {
			calls.push(`send:${fromId}->${target}:${spec.task}`);
			return { queued: true, position: 1 };
		},
		recordRevision: (path) => {
			calls.push(`recordRevision:${path}`);
			return "sha1";
		},
		boardPathOf: (file) => (file === "/deck/boards/plan.html" ? "boards/plan.html" : undefined),
		...over,
	};
	return { api, calls };
}

test("the board's id is the conversation's, so its canvas verbs land on screen", () => {
	const { api } = conversation();
	assert.equal(boardActor({ path: "boards/plan.html", conversation: api }).id, "agent-1");
});

test("the identity is the board's, and renaming it does not touch anybody", () => {
	const { api, calls } = conversation();
	const actor = boardActor({ path: "boards/round-20.html", conversation: api });

	assert.equal(actor.identity().name, "board round-20.html");
	actor.rename("Round 20 picker");
	assert.equal(actor.identity().name, "Round 20 picker");
	assert.deepEqual(calls, [], "nothing the conversation owns was written");
});

test("what is about the conversation is delegated to it", () => {
	const { api, calls } = conversation();
	const actor = boardActor({ path: "boards/plan.html", conversation: api });

	assert.deepEqual(actor.context(), ["boards/plan.html"]);
	assert.deepEqual(actor.inPlay(), ["boards/plan.html"]);
	assert.deepEqual(actor.positions?.(), { "boards/plan.html": { x: 10, y: 20 } });
	assert.deepEqual(actor.camera(), { x: 1, y: 2, zoom: 1 });

	actor.setContext(["boards/a.html"]);
	actor.setInPlay(["boards/b.html"]);
	actor.setPosition?.("boards/a.html", 3, 4);
	assert.deepEqual(calls, ["setContext:boards/a.html", "setInPlay:boards/b.html", "setPosition:boards/a.html:3,4"]);
});

test("work handed over is sent by the conversation, because a board has no inbox", () => {
	const { api, calls } = conversation();
	const actor = boardActor({ path: "boards/plan.html", conversation: api });

	assert.deepEqual(actor.send("Kestrel", { task: "Promote it", boards: ["boards/plan.html"] }), { queued: true, position: 1 });
	assert.deepEqual(calls, ["send:agent-1->Kestrel:Promote it"]);
});

test("a write is recorded through the board service", () => {
	const { api, calls } = conversation();
	const actor = boardActor({ path: "boards/plan.html", conversation: api });

	assert.equal(actor.recordRevision("boards/plan.html"), "sha1");
	assert.equal(actor.boardPathOf("/deck/boards/plan.html"), "boards/plan.html");
	assert.deepEqual(calls, ["recordRevision:boards/plan.html"]);
});

test("a board cannot create an agent, and the refusal names what to do instead", () => {
	const { api } = conversation();
	const actor = boardActor({ path: "boards/plan.html", conversation: api });

	assert.throws(() => actor.spawn({ task: "do it" }), /stage\.send/);
});

test("a board has no row of its own to tag or to place in a workspace", () => {
	const { api, calls } = conversation();
	const actor = boardActor({ path: "boards/plan.html", conversation: api });

	assert.deepEqual(actor.setTags(["anything"]), []);
	assert.equal(actor.setWorkspace("decks"), null);
	assert.deepEqual(calls, []);
});

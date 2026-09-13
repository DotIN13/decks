import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { OpencodeManager, type OpencodeChild, type OpencodeServerSpec } from "./manager.ts";

/**
 * One `opencode serve` shared by every opencode agent.
 *
 * Tested against a fake child process rather than the real binary: the manager's contract
 * with opencode is two lines out of its stdout and an exit event, both of which a fake
 * can produce deterministically — and the counting, the memoised start and the death
 * broadcast are the parts that can be wrong, not the process under them.
 */

/** A fake opencode child: announces its URL, remembers it was killed, can be died. */
function fakeChild(opts: { url?: string; announce?: boolean } = {}) {
	const { url = "http://127.0.0.1:18341", announce = true } = opts;
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill(): boolean;
		killed: boolean;
	};
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.killed = false;
	child.kill = () => {
		child.killed = true;
		return true;
	};
	// The manager attaches its readers right after `spawn` returns, so the announcement
	// is made on the next tick rather than synchronously.
	if (announce) queueMicrotask(() => child.stdout.emit("data", Buffer.from(`opencode server listening on ${url}\n`)));
	return child;
}

interface Spawned {
	argv: string[];
	env: NodeJS.ProcessEnv;
	cwd: string;
	child: ReturnType<typeof fakeChild>;
}

/** A manager that hands every spawn to a scriptable function, recording what it got. */
function managerWith(spawn: (argv: string[], env: NodeJS.ProcessEnv, cwd: string) => OpencodeChild) {
	const spawned: Spawned[] = [];
	const manager = new OpencodeManager({
		spawn: (argv, env, cwd) => {
			const child = spawn(argv, env, cwd) as Spawned["child"];
			spawned.push({ argv, env, cwd, child });
			return child;
		},
	});
	return { manager, spawned };
}

const spec: OpencodeServerSpec = {
	cwd: "/tmp/a-deck",
	stageUrl: "http://127.0.0.1:4333/api/stage/eval",
	config: { instructions: ["/tmp/a-deck/.decks-agent.md"] },
};

test("two agents starting at once share one server", async () => {
	// The whole point of the memoised start: the second acquire must wait on the first
	// spawn rather than racing it, so there is exactly one process for two agents.
	const { manager, spawned } = managerWith(() => fakeChild());
	const first = manager.acquire(spec);
	const second = manager.acquire(spec);
	const [a, b] = await Promise.all([first, second]);
	assert.equal(spawned.length, 1);
	assert.equal(a.url, b.url);
	assert.equal(a.token, b.token);
	a.release();
	b.release();
});

test("the spawn env carries the token the handle reports", async () => {
	const { manager, spawned } = managerWith(() => fakeChild());
	const handle = await manager.acquire(spec);
	assert.equal(spawned[0]!.env.DECKS_STAGE_TOKEN, handle.token);
	assert.equal(spawned[0]!.env.DECKS_STAGE_URL, spec.stageUrl);
	assert.equal(spawned[0]!.env.OPENCODE_CONFIG_CONTENT, JSON.stringify(spec.config));
	assert.equal(spawned[0]!.cwd, spec.cwd);
	handle.release();
});

test("the server stops only when every claim is released", async () => {
	const { manager, spawned } = managerWith(() => fakeChild());
	const a = await manager.acquire(spec);
	const b = await manager.acquire(spec);
	a.release();
	assert.equal(spawned[0]!.child.killed, false, "one agent gone, one still holding");
	b.release();
	assert.equal(spawned[0]!.child.killed, true, "the last one out stops the server");
});

test("a death is announced to every agent holding the server, not just one", async () => {
	const { manager, spawned } = managerWith(() => fakeChild());
	await manager.acquire(spec);
	await manager.acquire(spec);
	const heard: string[] = [];
	const off1 = manager.onExit(() => heard.push("ada"));
	manager.onExit(() => heard.push("bo"));
	spawned[0]!.child.emit("exit", 1);
	assert.deepEqual(heard.sort(), ["ada", "bo"]);
	off1();
});

test("after a death the next acquire raises a fresh server with a fresh token", async () => {
	const { manager, spawned } = managerWith(() => fakeChild());
	const first = await manager.acquire(spec);
	spawned[0]!.child.emit("exit", 1);
	const second = await manager.acquire(spec);
	assert.equal(spawned.length, 2);
	assert.notEqual(second.token, first.token, "a dead server's token must not validate against its successor");
	second.release();
});

test("a dead epoch's release cannot stop the server that came after it", async () => {
	// A claim is bound to the server it was made against. The refcount resets on death;
	// without the binding, an old agent's late release would decrement a count that now
	// belongs to a different server and kill a live one.
	const { manager, spawned } = managerWith(() => fakeChild());
	const first = await manager.acquire(spec);
	spawned[0]!.child.emit("exit", 1);
	const second = await manager.acquire(spec);
	first.release(); // a stray release from the dead epoch — and twice, because it is
	first.release(); // safe, not just often called once
	assert.equal(spawned[1]!.child.killed, false);
	second.release();
	assert.equal(spawned[1]!.child.killed, true);
});

test("a failed start is rejected and the next acquire tries again", async () => {
	let attempts = 0;
	const { manager, spawned } = managerWith(() => {
		attempts += 1;
		if (attempts === 1) {
			// Dies before announcing itself: the startup failure the acquire rejects with.
			const child = fakeChild({ announce: false });
			queueMicrotask(() => child.emit("exit", 1));
			return child;
		}
		return fakeChild();
	});
	await assert.rejects(manager.acquire(spec), /opencode exited with 1/);
	assert.equal(spawned.length, 1);
	const handle = await manager.acquire(spec);
	assert.equal(spawned.length, 2, "the memo must be cleared by the failure");
	assert.ok(handle.url.startsWith("http://"));
	handle.release();
});
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { Opencode2Manager, type Opencode2Child } from "./manager.ts";

/**
 * One OpenCode 2 server shared by every OpenCode 2 agent, against a fake child process.
 *
 * The part worth the most here is the environment: OpenCode 2 started in opencode 1's folders
 * migrates opencode 1's database in place, so the folders it is given are asserted, not assumed.
 */
function fakeChild(line = "server listening on http://127.0.0.1:41713\n") {
	const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill(): boolean; killed: boolean };
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.killed = false;
	child.kill = () => (child.killed = true);
	queueMicrotask(() => child.stdout.emit("data", Buffer.from(line)));
	return child;
}

function managerWith(home = "/home/someone") {
	const spawned: Array<{ argv: string[]; env: NodeJS.ProcessEnv; cwd: string; child: ReturnType<typeof fakeChild> }> = [];
	const manager = new Opencode2Manager({
		env: { HOME: home, PATH: "/usr/bin" },
		spawn: (argv, env, cwd) => {
			const child = fakeChild();
			spawned.push({ argv, env, cwd, child });
			return child as unknown as Opencode2Child;
		},
	});
	return { manager, spawned };
}

const SPEC = { cwd: "/deck", stageUrl: "http://127.0.0.1:4329/api/stage/eval", config: { plugins: ["/runtime/opencode2/plugin"], skills: ["/runtime/skills"] } };

test("the server is started in its own folders, never opencode 1's", async () => {
	const { manager, spawned } = managerWith("/home/someone");
	await manager.acquire(SPEC);
	const env = spawned[0]!.env;
	assert.equal(env.XDG_DATA_HOME, "/home/someone/.local/share/opencode2");
	assert.equal(env.XDG_STATE_HOME, "/home/someone/.local/state/opencode2");
	assert.equal(env.XDG_CACHE_HOME, "/home/someone/.cache/opencode2");
	assert.equal(env.OPENCODE_CONFIG_DIR, "/home/someone/.config/opencode2");
	for (const value of [env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME, env.OPENCODE_CONFIG_DIR]) {
		assert.ok(!/\/opencode$/.test(value!), `${value} is not one of opencode 1's folders`);
	}
});

test("the URL is read from OpenCode 2's own line, and the secret is its password and the tools' token", async () => {
	const { manager, spawned } = managerWith();
	const handle = await manager.acquire(SPEC);
	assert.equal(handle.url, "http://127.0.0.1:41713");
	const { argv, env, cwd } = spawned[0]!;
	assert.deepEqual(argv.slice(1), ["serve", "--hostname=127.0.0.1", "--port=0"]);
	assert.equal(cwd, "/deck");
	assert.equal(env.OPENCODE_PASSWORD, handle.secret);
	assert.equal(env.DECKS_STAGE_TOKEN, handle.secret);
	assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT!), SPEC.config);
});

test("agents share one server, and the last one out stops it", async () => {
	const { manager, spawned } = managerWith();
	const [a, b] = await Promise.all([manager.acquire(SPEC), manager.acquire(SPEC)]);
	assert.equal(spawned.length, 1, "two agents starting at once share one spawn");
	assert.equal(a.secret, b.secret);
	a.release();
	assert.equal(spawned[0]!.child.killed, false);
	b.release();
	assert.equal(spawned[0]!.child.killed, true);
});

test("a server that dies tells every agent, and the next one gets a new secret", async () => {
	const { manager, spawned } = managerWith();
	const first = await manager.acquire(SPEC);
	let told = 0;
	manager.onExit(() => (told += 1));
	spawned[0]!.child.emit("exit", 1);
	assert.equal(told, 1);
	const second = await manager.acquire(SPEC);
	assert.equal(spawned.length, 2);
	assert.notEqual(second.secret, first.secret);
	first.release();
	assert.equal(spawned[1]!.child.killed, false, "a claim on the dead server cannot stop the new one");
});

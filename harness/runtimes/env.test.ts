// What every agent's shell is given, whatever its kind: the decks command, the server, its own
// token, the install folder, and an SDK a plain node script connects with as the agent.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fakeServer } from "@decks/sdk/testing";
import { DECKS_BIN, decksEnv } from "./env.ts";

test("an agent's shell gets DECKS_URL, its token, DECKS_AGENT, DECKS_APP_DIR and the decks command first on PATH", () => {
	const env = decksEnv("http://127.0.0.1:1", "a1", "tok", "/usr/bin");
	assert.equal(env.DECKS_URL, "http://127.0.0.1:1");
	assert.equal(env.DECKS_TOKEN, "tok");
	assert.equal(env.DECKS_AGENT, "a1");
	assert.ok(env.DECKS_APP_DIR && existsSync(join(env.DECKS_APP_DIR, "node_modules")), "the install folder, where Playwright is");
	assert.equal(env.PATH!.split(delimiter)[0], DECKS_BIN);
	assert.ok(existsSync(join(DECKS_BIN, "decks")));
});

test("a plain node script imports DECKS_SDK and calls as the agent", async () => {
	const fake = await fakeServer(4678, { "agent.me": () => ({ id: "a1", name: "Ada", tags: [] }) });
	try {
		const env = { ...process.env, ...decksEnv(fake.url, "a1", fake.token) };
		const script = "const { decks } = await import(process.env.DECKS_SDK); console.log((await decks.agent.me()).name)";
		const out = await new Promise<string>((done, fail) => {
			import("node:child_process").then(({ execFile }) => execFile(process.execPath, ["--input-type=module", "-e", script], { env }, (error, stdout) => (error ? fail(error) : done(stdout))));
		});
		assert.equal(out.trim(), "Ada");
		assert.deepEqual(fake.calls.at(-1), { name: "agent.me", args: {}, token: fake.token });
	} finally {
		await fake.close();
	}
});

test("the decks command runs as the agent", () => {
	const help = execFileSync(join(DECKS_BIN, "decks"), ["--help"], { env: { ...process.env, ...decksEnv("http://127.0.0.1:1", "a1", "tok") }, encoding: "utf8" });
	assert.match(help, /decks/);
});

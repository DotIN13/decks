import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claimAddress, launchdService, readAddress } from "./address.ts";

const home = () => mkdtempSync(join(tmpdir(), "decks-address-"));

test("a server claims the address file, and leaves how to start it when it stops", () => {
	const dir = home();
	const env = { DECKS_HOME: dir, DECKS_PORT: "4999", DECKS_STUDIO_KEY: "dsk_secret", DECKS_AGENT: "someone", DECKS_TOKEN: "t" };
	const claim = claimAddress("http://127.0.0.1:4999", "/data", env);
	assert.equal(claim.held, true);
	const written = readAddress(env);
	assert.equal(written?.url, "http://127.0.0.1:4999");
	assert.equal(written?.pid, process.pid);
	// The server's own settings are remembered; a secret and a caller's variables are not.
	assert.deepEqual(written?.start.env, { DECKS_HOME: dir, DECKS_PORT: "4999" });
	claim.stop();
	const after = readAddress(env);
	assert.equal(after?.pid, undefined);
	assert.ok(after?.stopped);
	assert.equal(after?.start.command, process.execPath);
	rmSync(dir, { recursive: true, force: true });
});

test("a second server leaves a live server's file alone, and takes over a dead one's", async () => {
	const dir = home();
	const env = { DECKS_HOME: dir };
	// Another live process holds the file.
	const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
	const { writeFileSync } = await import("node:fs");
	writeFileSync(join(dir, "server.json"), JSON.stringify({ url: "http://127.0.0.1:1", pid: other.pid, dataDir: "/a", started: 1, start: { command: "x", args: [], cwd: "/", env: {} } }));
	assert.equal(claimAddress("http://127.0.0.1:2", "/b", env).held, false);
	assert.equal(readAddress(env)?.url, "http://127.0.0.1:1");
	other.kill("SIGKILL");
	await new Promise((done) => other.once("exit", done));
	assert.equal(claimAddress("http://127.0.0.1:2", "/b", env).held, true);
	assert.equal(readAddress(env)?.url, "http://127.0.0.1:2");
	// And never when told not to.
	assert.equal(claimAddress("http://127.0.0.1:3", "/c", { ...env, DECKS_ADDRESS: "0" }).held, false);
	rmSync(dir, { recursive: true, force: true });
});

test("only a process launchd started names its job", () => {
	assert.equal(launchdService({ XPC_SERVICE_NAME: "com.example.decks" }, 1), "com.example.decks");
	assert.equal(launchdService({ XPC_SERVICE_NAME: "com.example.decks" }, 4242), undefined);
	assert.equal(launchdService({ XPC_SERVICE_NAME: "application.com.apple.Terminal.1" }, 1), undefined);
	assert.equal(launchdService({ XPC_SERVICE_NAME: "0" }, 1), undefined);
	assert.equal(launchdService({}, 1), undefined);
});

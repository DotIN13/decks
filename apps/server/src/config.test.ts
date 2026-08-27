import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { DECK_DIR, expandUser, loadConfig } from "./config.ts";

/** `loadConfig` reads the environment, so each case states the whole of it. */
function withEnv(env: Record<string, string | undefined>, run: () => void): void {
	const saved = { ...process.env };
	for (const key of ["DECKS_DATA_DIR", "DECKS_HOST", "DECKS_PORT"]) delete process.env[key];
	Object.assign(process.env, env);
	try {
		run();
	} finally {
		process.env = saved;
	}
}

test("with nothing set, the data directory is ~/.decks and the deck is inside it", () => {
	withEnv({}, () => {
		const config = loadConfig([]);
		assert.equal(config.dataDir, join(homedir(), ".decks"));
		assert.equal(config.deck, join(homedir(), ".decks", DECK_DIR));
		assert.equal(config.host, "127.0.0.1");
		assert.equal(config.port, 4329);
	});
});

test("DECKS_DATA_DIR moves everything at once", () => {
	withEnv({ DECKS_DATA_DIR: "/tmp/decks-data" }, () => {
		const config = loadConfig([]);
		assert.equal(config.dataDir, "/tmp/decks-data");
		assert.equal(config.deck, "/tmp/decks-data/decks");
	});
});

test("~ is expanded, wherever it comes from", () => {
	assert.equal(expandUser("~"), homedir());
	assert.equal(expandUser("~/work"), join(homedir(), "work"));
	assert.equal(expandUser("/absolute"), "/absolute");
	withEnv({ DECKS_DATA_DIR: "~/work/decks" }, () => {
		assert.equal(loadConfig([]).dataDir, join(homedir(), "work", "decks"));
	});
});

test("a positional argument names a data directory, and wins", () => {
	withEnv({ DECKS_DATA_DIR: "/tmp/from-env" }, () => {
		assert.equal(loadConfig(["/tmp/from-argv"]).dataDir, "/tmp/from-argv");
		// Flags are not paths.
		assert.equal(loadConfig(["--verbose"]).dataDir, "/tmp/from-env");
	});
});

test("a relative data directory is relative to where you are standing", () => {
	withEnv({}, () => {
		assert.equal(loadConfig(["data"]).dataDir, resolve(process.cwd(), "data"));
	});
});

test("host and port stay separate knobs", () => {
	withEnv({ DECKS_HOST: "0.0.0.0", DECKS_PORT: "5000" }, () => {
		const config = loadConfig([]);
		assert.equal(config.host, "0.0.0.0");
		assert.equal(config.port, 5000);
	});
});

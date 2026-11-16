import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tempFolder } from "./disk.ts";
import { folderRunner } from "./run.ts";
import { testServer } from "./testing.ts";

// A feature starts a program in a deck folder: the first candidate that
// exists, "{out}" a scratch folder whose outputs come back, killed at the
// timeout, missing when none is installed. testServer takes a fake.

test("a program runs in a deck folder, and its outputs come back from {out}", async () => {
	const deck = await tempFolder("keel-run");
	await mkdir(join(deck.folder, "docs"));
	const run = folderRunner(deck.folder);
	const done = await run({ command: ["no-such-program-xyz", "sh"], args: ["-c", "pwd; printf data > {out}/a.txt"], cwd: "docs" as never, timeoutMs: 5000, outputs: ["a.txt", "b.txt"] });
	assert.equal(done.code, 0);
	assert.match(done.out, /docs\n$/);
	assert.deepEqual(Object.keys(done.files), ["a.txt"]);
	assert.equal(new TextDecoder().decode(done.files["a.txt"]), "data");
	assert.equal((await run({ command: ["no-such-program-xyz"], args: [], cwd: "", timeoutMs: 1000 })).missing, true);
	assert.equal((await run({ command: ["sh"], args: ["-c", "sleep 5"], cwd: "", timeoutMs: 100 })).signal, "SIGKILL");
	await assert.rejects(run({ command: ["sh"], args: [], cwd: "nowhere" as never, timeoutMs: 100 }), { code: "not_found" });
	await deck.remove();
});

test("the kernel runs nothing in memory, and testServer takes a fake runner", async () => {
	const plain = await testServer();
	assert.equal(plain.kernel.run, undefined);
	await plain.close();
	const faked = await testServer({ run: async () => ({ code: 0, out: "ok", files: {} }) });
	assert.equal((await faked.kernel.run!({ command: ["git"], args: [], cwd: "", timeoutMs: 1 })).out, "ok");
	await faked.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FolderStore, tempFolder } from "./disk.ts";

// A folder store names its files by one rule, so no key of any length or
// script makes a name the disk refuses, every key comes back from keys(), and
// what a store wrote under the old names (every part percent-encoded) reads.

const enc = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);
const LONG = `${"史蒂夫的强化学习笔记".repeat(7)}・${"ゆっくり考える".repeat(5)}🎂🧪${"x".repeat(20)}`;

test("a key of over 300 bytes in Chinese, Japanese and emoji writes, reads, lists and goes", async () => {
	assert.ok(new TextEncoder().encode(LONG).length > 300);
	const folder = await tempFolder("keel-store");
	try {
		const store = new FolderStore(folder.folder);
		const keys = [`claims/canvases/${LONG}/cards/${LONG}/index.html`, "seen/canvases/plan/cards/a/index.html", "odd/.hidden/50%/a:b\\c", `blob/${LONG}`];
		for (const key of keys) await store.put(key, enc(key));
		for (const key of keys) assert.equal(text(await store.get(key)), key);
		assert.deepEqual(await store.keys(), [...keys].sort());
		assert.deepEqual(await store.keys("claims/"), [keys[0]]);
		for (const name of await readdir(join(folder.folder, "claims", "canvases"))) assert.ok(new TextEncoder().encode(name).length <= 255, name);
		await store.delete(keys[0]!);
		assert.equal(await store.get(keys[0]!), undefined);
		assert.deepEqual(await store.keys("claims/"), []);
	} finally {
		await folder.remove();
	}
});

test("what a store wrote under the old names still reads, lists once, and moves on a write", async () => {
	const folder = await tempFolder("keel-store-old");
	try {
		const key = "seen/canvases/写作/cards/封面/index.html";
		const old = join(folder.folder, ...key.split("/").map((part) => encodeURIComponent(part)));
		await mkdir(join(old, ".."), { recursive: true });
		await writeFile(old, "old");
		const store = new FolderStore(folder.folder);
		assert.equal(text(await store.get(key)), "old");
		assert.deepEqual(await store.keys(), [key]);
		await store.put(key, enc("new"));
		assert.equal(text(await store.get(key)), "new");
		assert.deepEqual(await store.keys(), [key]);
	} finally {
		await folder.remove();
	}
});

import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { callers, testServer } from "../kernel/testing.ts";
import { features } from "../main.ts";
import { outsideFolder } from "./source.ts";

// Rules 14 to 17: an app whose source lives in a folder outside the deck.

type App = { name: string; status: string; source?: { path: string; repo?: string } };
const ann = callers.agent("ann", "work");

/** What each test opened: closed after it whatever it did, so a failed assertion fails and does not hang. */
const open = new Set<() => Promise<void>>();
afterEach(async () => {
	for (const close of [...open]) await close();
});

async function start() {
	const scratch = mkdtempSync(join(tmpdir(), "depot-outside-"));
	const s = await testServer({ features: features({ appRun: join(scratch, "run") }), deck: new MemoryDeck({ "canvases/work/canvas.pen": '{"version":"2.14","children":[]}' }) });
	const door = await s.listen(0);
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		open.delete(close);
		await door.close();
		await s.close();
		rmSync(scratch, { recursive: true, force: true });
	};
	open.add(close);
	return { s, scratch, door, page: (path: string) => fetch(`${door.url}${path}?pass=${door.token}`), close };
}

test("rule 14: the person makes an app in a folder outside the deck; the deck keeps only its record", async () => {
	const t = await start();
	const folder = join(t.scratch, "trip");
	const refused = await t.s.call("app.create", { name: "trip", source: { path: folder } }, ann);
	assert.equal(refused.ok ? "" : refused.error.code, "refused", "an agent may not name a folder");
	const made = await t.s.value<App>("app.create", { name: "trip", title: "Trip", source: { path: folder } }, "person");
	assert.deepEqual([made.status, made.source?.path], ["running", folder]);
	assert.ok(existsSync(join(folder, "index.html")) && existsSync(join(folder, ".git")), "the starter and its repository are in the folder");
	const listed = await t.s.value<{ path: string }[]>("file.list", { path: "apps/trip" });
	assert.deepEqual(listed.map((one) => one.path), ["apps/trip/app.json"]);
	assert.match(await (await t.page("/app/trip/")).text(), /<title>Trip<\/title>/);
	await t.close();
});

test("rule 15: a folder is absolute, not a home, a system folder or under a hidden one", () => {
	assert.equal(outsideFolder("/Users/me/code/trip/", "/Users/me"), "/Users/me/code/trip");
	for (const bad of ["code/trip", "/", "/Users/me", "/Users", "/usr/local/x", "/etc", "/Users/me/.config/x"]) assert.throws(() => outsideFolder(bad, "/Users/me"), bad);
});

test("rules 16 and 17: app.move takes an in-deck app out; a folder that is gone makes it missing", async () => {
	const t = await start();
	await t.s.value("app.create", { name: "notes", title: "Notes" }, ann);
	const folder = join(t.scratch, "notes");
	assert.equal((await t.s.call("app.move", { name: "notes", to: folder }, ann)).ok, false);
	const moved = await t.s.value<App>("app.move", { name: "notes", to: folder }, "person");
	assert.equal(moved.source?.path, folder);
	assert.match(readFileSync(join(folder, "index.html"), "utf8"), /Notes/);
	const left = await t.s.value<{ path: string }[]>("file.list", { path: "apps/notes" });
	assert.deepEqual(left.map((one) => one.path), ["apps/notes/app.json"]);
	rmSync(folder, { recursive: true, force: true });
	assert.equal((await t.s.value<App>("app.get", { name: "notes" })).status, "missing");
	assert.equal((await t.s.value<App>("app.build", { name: "notes" }, ann)).status, "missing", "a build of a missing app says so");
	await t.close();
});

test("rule 16: a missing app is taken again by app.clone with to, which only the person may name", async () => {
	const t = await start();
	const origin = join(t.scratch, "origin");
	await t.s.value("app.create", { name: "far", title: "Far", source: { path: origin, repo: "https://example.invalid/far.git" } }, "person");
	rmSync(origin, { recursive: true, force: true });
	assert.equal((await t.s.value<App>("app.get", { name: "far" })).status, "missing");
	const args = { url: "file:///nowhere", name: "far", to: join(t.scratch, "again") };
	const byAgent = await t.s.call("app.clone", args, ann);
	assert.equal(byAgent.ok ? "" : byAgent.error.code, "refused");
	const byPerson = await t.s.call("app.clone", args, "person");
	assert.equal(byPerson.ok ? "" : byPerson.error.code, "invalid", "it reaches the clone, which takes only https and git addresses, rather than refusing a name that is taken");
	await t.close();
});

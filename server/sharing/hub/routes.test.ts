import assert from "node:assert/strict";
import { test } from "node:test";
import type { PenEdit } from "@decks/pen";
import { memoryStudio } from "../testing.ts";

// The /sync/v1 routes on a memory hub: who may read and write is the store's role.

const studio = () => {
	const s = memoryStudio();
	s.keys.set("ada-key", { user: { id: "ada", name: "Ada" }, harness: { id: "h-ada", name: "mini" } });
	s.keys.set("bob-key", { user: { id: "bob", name: "Bob" }, harness: { id: "h-bob", name: "laptop" } });
	s.keys.set("page", { user: { id: "ada", name: "Ada" } });
	const call = async (key: string, method: string, path: string, body?: unknown) => {
		const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` }, ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }) };
		const res = await s.transport.fetch(new Request(`${s.url}${path}`, init));
		const got: any = res.headers.get("content-type")?.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer());
		return { status: res.status, body: got };
	};
	return { ...s, call };
};
const note = (id: string): PenEdit => ({ op: "insert", id, parent: null, after: null, props: { type: "note", content: id }, list: false });

test("only a harness's key gets in", async () => {
	const s = studio();
	assert.equal((await s.call("nobody", "GET", "/sync/v1/hello")).status, 401);
	assert.equal((await s.call("page", "GET", "/sync/v1/hello")).status, 401);
	assert.equal((await s.call("ada-key", "GET", "/sync/v1/hello")).body.harness.id, "h-ada");
});

test("a canvas made twice by one owner is one canvas, and a name that is not a plain folder name is refused", async () => {
	const s = studio();
	const one = await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "plan" });
	const two = await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "plan" });
	assert.equal(one.status, 201);
	assert.equal(two.body.existed, true);
	assert.equal(two.body.canvas.id, one.body.canvas.id);
	assert.equal((await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "has space" })).status, 400);
	assert.equal((await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "../x" })).status, 400);
});

test("a viewer reads, and may not write edits or files; a stranger sees nothing", async () => {
	const s = studio();
	const id = (await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "plan" })).body.canvas.id;
	s.hub.share(id, "bob", "view");
	assert.equal((await s.call("bob-key", "GET", `/sync/v1/canvases/${id}`)).status, 200);
	assert.equal((await s.call("bob-key", "POST", `/sync/v1/canvases/${id}/edits`, { base: 1, edits: [note("n")] })).status, 403);
	assert.equal((await s.call("bob-key", "PUT", `/sync/v1/canvases/${id}/files?path=files/a.txt`, new Uint8Array([1]))).status, 403);
	s.hub.share(id, "bob", "edit");
	assert.equal((await s.call("bob-key", "POST", `/sync/v1/canvases/${id}/edits`, { base: 1, edits: [note("n")] })).status, 200);
	s.keys.set("eve-key", { user: { id: "eve", name: "Eve" }, harness: { id: "h-eve", name: "x" } });
	assert.equal((await s.call("eve-key", "GET", `/sync/v1/canvases/${id}`)).status, 404);
});

test("edits come back as changes since a revision, or tooOld when the log no longer reaches", async () => {
	const s = studio();
	const id = (await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "plan" })).body.canvas.id;
	const pushed = await s.call("ada-key", "POST", `/sync/v1/canvases/${id}/edits`, { base: 1, edits: [note("n1")] });
	assert.equal(pushed.body.rev, 2);
	const again = await s.call("ada-key", "POST", `/sync/v1/canvases/${id}/edits`, { base: 1, edits: [note("n1")] });
	assert.equal(again.body.rev, 2, "an insert already there makes no revision");
	const since = await s.call("ada-key", "GET", `/sync/v1/canvases/${id}/changes?since=1`);
	assert.equal(since.body.changes.length, 1);
	assert.equal((await s.call("ada-key", "GET", `/sync/v1/canvases/${id}/changes?since=0`)).body.tooOld, true);
});

test("a file outside a canvas's bundle, or a secret, is refused; a stale write is kept but not current; bytes only for those who may see them", async () => {
	const s = studio();
	const id = (await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "plan" })).body.canvas.id;
	const put = (path: string, bytes: number[], base?: number) => s.call("ada-key", "PUT", `/sync/v1/canvases/${id}/files?path=${path}${base ? `&base=${base}` : ""}`, new Uint8Array(bytes));
	assert.equal((await put("canvas.pen", [1])).status, 400);
	assert.equal((await put("files/.env", [1])).status, 400);
	assert.equal((await put("files/id_rsa", [1])).status, 400);
	const first = (await put("files/a.txt", [1])).body;
	assert.equal(first.current, true);
	await put("files/a.txt", [2], 1);
	assert.equal((await put("files/a.txt", [3], 1)).body.current, false);
	assert.equal((await s.call("ada-key", "GET", `/sync/v1/blobs/${first.hash}`)).status, 200);
	assert.equal((await s.call("bob-key", "GET", `/sync/v1/blobs/${first.hash}`)).status, 404);
});

test("edits to a canvas one may not see answer 404, as the file routes do; a viewer's answer 403", async () => {
	const s = studio();
	const made = await s.call("ada-key", "POST", "/sync/v1/canvases", { name: "plan" });
	const id = made.body.canvas.id;
	const stranger = await s.call("bob-key", "POST", `/sync/v1/canvases/${id}/edits`, { base: 0, edits: [note("n1")] });
	assert.deepEqual([stranger.status, stranger.body.error], [404, "No such canvas."]);
	assert.equal((await s.call("bob-key", "GET", `/sync/v1/canvases/${id}/files`)).status, 404, "the same as a file route");
	s.hub.share(id, "bob", "view");
	assert.equal((await s.call("bob-key", "POST", `/sync/v1/canvases/${id}/edits`, { base: 0, edits: [note("n1")] })).status, 403);
	assert.equal((await s.call("ada-key", "POST", `/sync/v1/canvases/${id}/edits`, { base: 0, edits: [note("n1")] })).status, 200);
});

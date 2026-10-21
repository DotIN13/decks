import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { realPathOf } from "../deck/roots.ts";
import { createHttpApp } from "../http.ts";
import { copyPlan, relinkDrawing, relinked } from "./copy-shared.ts";

/**
 * What a friend's canvas lets you do, by the share's role: to edit, a file dropped on it goes into
 * its own folder (which syncs back to its owner); to view, nothing changes it, and your own copy
 * (`canvas.copyShared`) is the way to.
 */

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

function sharedCanvas(deck: string, role: "edit" | "view") {
	const folder = join(deck, "shared", "canvases", "ada", "fetcher");
	mkdirSync(join(folder, "boards"), { recursive: true });
	mkdirSync(join(folder, "assets"), { recursive: true });
	mkdirSync(join(folder, "files"), { recursive: true });
	writeFileSync(join(folder, "canvas.json"), JSON.stringify({ title: "Fetcher", studio: "c1", shared: { owner: "u1", ownerName: "Ada", role, studio: "c1" }, boards: [] }));
	writeFileSync(join(folder, "assets", "logo.png"), PNG);
	writeFileSync(join(folder, "files", "own.png"), PNG);
	writeFileSync(
		join(folder, "boards", "plan.html"),
		`<!doctype html><html><head><title>Plan</title><meta name="board" content='{"w":400,"h":300}' /><link rel="stylesheet" href="../lib/board.css" /></head><body><img src="../assets/logo.png" /><img src="../files/own.png" /></body></html>`,
	);
	writeFileSync(
		join(folder, "canvas.pen"),
		JSON.stringify({
			version: "2.8",
			children: [
				{ type: "browser", id: "plan", name: "Plan", url: "boards/plan.html", x: 0, y: 0, width: 400, height: 300, metadata: { type: "decks.board", path: "boards/plan.html" } },
				{ type: "rectangle", id: "pic", x: 500, y: 0, width: 100, height: 100, fill: { type: "image", url: "assets/logo.png", mode: "fill" } },
			],
		}),
	);
	return folder;
}

async function open(role: "edit" | "view") {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-shared-rights-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "canvases", "plan"), { recursive: true });
	writeFileSync(join(deck, "canvases", "plan", "canvas.pen"), JSON.stringify({ version: "2.8", children: [] }));
	const folder = sharedCanvas(deck, role);
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const person = { authorization: `Bearer ${app.tokens.issue({ kind: "person" }).token}` };
	const upload = async (query: string) => {
		const res = await fetch(`${origin}/api/upload?${query}`, { method: "POST", headers: { ...person, "content-type": "application/octet-stream" }, body: PNG });
		return { status: res.status, text: await res.text() };
	};
	const verb = async (name: string, args: unknown[]) => {
		const res = await fetch(`${origin}/api/v1/${name}`, { method: "POST", headers: { ...person, "content-type": "application/json" }, body: JSON.stringify({ args }) });
		return (await res.json()) as { ok: boolean; value?: any; error?: string };
	};
	return {
		deck,
		folder,
		upload,
		verb,
		cleanup: () => {
			server.close();
			app.dispose();
			rmSync(dataDir, { recursive: true, force: true });
		},
	};
}

test("a file dropped on a friend's canvas you may edit goes into its own files/, never your assets/", async () => {
	const { deck, folder, upload, cleanup } = await open("edit");
	try {
		const put = await upload(`name=photo.png&canvas=${encodeURIComponent("shared/ada/fetcher")}`);
		assert.equal(put.status, 200, put.text);
		const said = JSON.parse(put.text) as { path: string; ref?: string };
		assert.equal(said.path, "shared/canvases/ada/fetcher/files/photo.png");
		assert.equal(said.ref, "files/photo.png");
		assert.ok(existsSync(join(folder, "files", "photo.png")));
		assert.ok(!existsSync(join(deck, "assets", "photo.png")), "nothing lands in this deck's own assets/");
		// One of your own canvases the same way; with no canvas, the deck's assets/ as before.
		assert.equal(JSON.parse((await upload("name=a.png&canvas=plan")).text).path, "canvases/plan/files/a.png");
		assert.equal(JSON.parse((await upload("name=b.png")).text).path, "assets/b.png");
		assert.equal((await upload("name=c.png&canvas=nowhere")).status, 404);
	} finally {
		cleanup();
	}
});

test("a friend's canvas shared with you to view refuses a drop, an edit, a board and a rename, each saying how to make a copy", async () => {
	const { folder, upload, verb, cleanup } = await open("view");
	try {
		const put = await upload(`name=photo.png&canvas=${encodeURIComponent("shared/ada/fetcher")}`);
		assert.equal(put.status, 403);
		assert.match(put.text, /shared with you to view, by Ada.*make your own copy/);
		assert.ok(!existsSync(join(folder, "files", "photo.png")));
		const insert = await verb("canvas.insert", [{ type: "note", content: "mine" }, { canvas: "shared/ada/fetcher" }]);
		assert.equal(insert.ok, false);
		assert.match(insert.error ?? "", /shared with you to view.*copy-shared/);
		const board = await verb("board.create", [{ title: "Mine", canvas: "shared/ada/fetcher" }]);
		assert.equal(board.ok, false);
		assert.match(board.error ?? "", /shared with you to view/);
		const rename = await verb("canvas.rename", ["Mine now", { canvas: "shared/ada/fetcher" }]);
		assert.equal(rename.ok, false);
		assert.match(rename.error ?? "", /shared with you to view/);
	} finally {
		cleanup();
	}
});

test("a copy of a friend's canvas is a canvas of yours, standing alone, with their deck files in its files/ and every link to them re-pointed", async () => {
	const { deck, folder, verb, cleanup } = await open("view");
	try {
		const made = await verb("canvas.copyShared", [{ canvas: "shared/ada/fetcher" }]);
		assert.equal(made.ok, true, made.error);
		assert.equal(made.value.title, "Copy of Fetcher");
		assert.equal(made.value.shared, undefined);
		const copy = join(deck, "canvases", made.value.name);
		assert.ok(existsSync(join(copy, "files", "logo.png")), "the owner's assets/ copy is in files/");
		assert.ok(existsSync(join(copy, "files", "own.png")));
		const html = readFileSync(join(copy, "boards", "plan.html"), "utf8");
		assert.match(html, /src="\.\.\/files\/logo\.png"/);
		assert.match(html, /src="\.\.\/files\/own\.png"/);
		assert.match(html, /href="\.\.\/lib\/board\.css"/);
		const pen = readFileSync(join(copy, "canvas.pen"), "utf8");
		assert.match(pen, /"url": "files\/logo\.png"/);
		assert.match(pen, /"path": "boards\/plan\.html"/);
		const meta = JSON.parse(readFileSync(join(copy, "canvas.json"), "utf8")) as Record<string, any>;
		assert.equal(meta.shared, undefined);
		assert.equal(meta.studio, undefined);
		assert.equal(meta.madeFrom.canvas, "shared/ada/fetcher");
		// Yours to change, and theirs untouched.
		const insert = await verb("canvas.insert", [{ type: "note", content: "mine" }, { canvas: made.value.name }]);
		assert.equal(insert.ok, true, insert.error);
		assert.doesNotMatch(readFileSync(join(folder, "canvas.pen"), "utf8"), /mine/);
		// A canvas of your own is not a friend's to copy.
		assert.equal((await verb("canvas.copyShared", [{ canvas: "plan" }])).ok, false);
	} finally {
		cleanup();
	}
});

test("the copy's plan puts mirrored deck files in files/ without taking a place the canvas's own file has", () => {
	const plan = copyPlan(["boards/a.html", "files/x.png", "assets/x.png", "assets/y.png", "docs/n.md", "canvas.pen"]);
	assert.equal(plan.get("files/x.png"), "files/x.png");
	assert.equal(plan.get("assets/x.png"), "files/assets/x.png");
	assert.equal(plan.get("assets/y.png"), "files/y.png");
	assert.equal(plan.get("docs/n.md"), "files/docs/n.md");
	assert.equal(plan.has("canvas.pen"), false);
	assert.equal(relinked(`<img src="../assets/y.png"><a href="../docs/n.md">n</a>`, "boards/a.html", "boards/a.html", plan), `<img src="../files/y.png"><a href="../files/docs/n.md">n</a>`);
	assert.deepEqual(relinkDrawing({ fill: { url: "assets/y.png" }, other: "https://x/assets/y.png" }, plan), { fill: { url: "files/y.png" }, other: "https://x/assets/y.png" });
});

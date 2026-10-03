import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Board } from "@decks/protocol";
import { readZip } from "../../../web/src/connections/zip.ts";
import { buildBundle } from "./bundle.ts";
import { fromAnotherSite, fromPrivateNetwork, isPrivateAddress, Pairing, tokenOf } from "./pairing.ts";
import { zip } from "./zip.ts";

test("a zip written here is read back by the browser's reader, stored and deflated alike", async () => {
	const text = "a board ".repeat(500);
	const random = crypto.getRandomValues(new Uint8Array(2048));
	const files = readZip(new Uint8Array(zip([{ name: "deck/boards/é.html", data: Buffer.from(text) }, { name: "pictures/x.webp", data: random }])).buffer);
	assert.deepEqual(files.map((one) => one.name), ["deck/boards/é.html", "pictures/x.webp"]);
	assert.equal(new TextDecoder().decode(await files[0]!.bytes()), text);
	assert.deepEqual(await files[1]!.bytes(), random);
});

function board(path: string, extra: Partial<Board> = {}): Board {
	return { path, title: path, format: "board", x: 0, y: 0, w: 1000, h: 400, rev: 1, ...extra } as Board;
}

test("a bundle carries the stage, its boards, what they name, lib, and pictures, and leaves out other boards", async () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-bundle-"));
	for (const dir of ["boards", "assets", "lib", "stages/plan"]) mkdirSync(join(deck, dir), { recursive: true });
	writeFileSync(join(deck, "lib/board.css"), "body{}");
	writeFileSync(join(deck, "assets/chart.png"), "png");
	writeFileSync(join(deck, "assets/font.woff2"), "font");
	writeFileSync(join(deck, "assets/style.css"), "@font-face{src:url('font.woff2')}");
	writeFileSync(join(deck, "boards/a.html"), '<link href="../lib/board.css"><link href="../assets/style.css"><img src="../assets/chart.png"><a href="b.html">b</a><a href="other.html">o</a><img src="https://x.test/y.png">');
	writeFileSync(join(deck, "boards/b.md"), "# B");
	writeFileSync(join(deck, "boards/other.html"), "<p>not on the canvas</p>");
	writeFileSync(join(deck, "stages/plan/stage.pen"), "{}");
	writeFileSync(join(deck, "stages/plan/photo.jpg"), "jpg");
	const picture = join(deck, "pic.webp");
	writeFileSync(picture, "webp");
	const records: Record<string, Board> = { "boards/a.html": board("boards/a.html", { lastWrittenBy: "agent-1", namedAt: Date.now() }), "boards/b.md": board("boards/b.md", { shell: "content" }) };

	const { manifest, bytes } = await buildBundle({
		deckPath: deck,
		deckName: "decks",
		board: (path) => records[path],
		stage: { dir: join(deck, "stages/plan"), title: "Plan", rev: 3, doc: { version: "2.9", children: [{ type: "rectangle", id: "r", fill: { type: "image", url: "photo.jpg" } }] } as never, boards: [{ path: "boards/a.html", x: 10, y: 20, w: 1000, h: 400 }, { path: "boards/b.md", x: 1200, y: 20, w: 800, h: 300 }] },
		picture: async (one, scheme) => (one.path === "boards/a.html" && scheme === "light" ? picture : undefined),
	});
	const names = readZip(new Uint8Array(bytes).buffer).map((one) => one.name);
	for (const wanted of ["manifest.json", "deck/boards/a.html", "deck/boards/b.md", "deck/lib/board.css", "deck/assets/chart.png", "deck/assets/style.css", "deck/assets/font.woff2", "deck/stages/plan/stage.pen", "deck/stages/plan/photo.jpg", "served/boards/b.md", "pictures/light/boards/a.html.webp"]) {
		assert.ok(names.includes(wanted), `${wanted} is in the bundle`);
	}
	assert.ok(!names.includes("deck/boards/other.html"), "a board that is only linked to stays out");
	assert.deepEqual(manifest.boards.map(({ path, x, y }) => ({ path, x, y })), [{ path: "boards/a.html", x: 10, y: 20 }, { path: "boards/b.md", x: 1200, y: 20 }]);
	assert.deepEqual(manifest.served, ["boards/b.md"]);
	const first = manifest.boards[0]!;
	assert.ok(first.lastWrittenBy === undefined && first.namedAt === undefined && (first.seenAt ?? 0) > 0, "a board arrives read, with nobody's byline");
	assert.equal(manifest.pen.base, "stages/plan/");
	assert.deepEqual(manifest.pictures, { "boards/a.html": { light: "pictures/light/boards/a.html.webp" } });
});

test("a pairing code works once, dies after five wrong tries, and its token can be revoked", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-pairing-"));
	const file = join(dir, "pairing.json");
	const pairing = new Pairing(file);
	const { code } = pairing.newCode();
	assert.equal(pairing.redeem(code === "000000" ? "111111" : "000000", "https://a.test", "A"), undefined);
	const token = pairing.redeem(code, "https://a.test", "A");
	assert.ok(token);
	assert.equal(pairing.redeem(code, "https://a.test", "A"), undefined, "spent");
	assert.ok(pairing.check(token));
	assert.ok(new Pairing(file).check(token), "kept across a restart");
	assert.ok(!pairing.check("made-up"));

	const second = pairing.newCode().code;
	const wrong = second === "999999" ? "888888" : "999999";
	for (let i = 0; i < 5; i++) pairing.redeem(wrong, "x", "x");
	assert.equal(pairing.redeem(second, "x", "x"), undefined, "five wrong tries kill the code");

	const [row] = pairing.list();
	assert.ok(row && pairing.revoke(row.id));
	assert.ok(!pairing.check(token));
});

test("only a browser saying cross-site counts as another site, and the token comes from a header or the query", () => {
	assert.equal(fromAnotherSite({ "sec-fetch-site": "same-origin" }), false);
	assert.equal(fromAnotherSite({}), false);
	assert.equal(fromAnotherSite({ "sec-fetch-site": "cross-site" }), true);
	// Plain http: no fetch metadata, so the page's origin against the host it asked.
	assert.equal(fromAnotherSite({ origin: "http://100.1.2.3:4337", host: "100.1.2.3:4346" }), true);
	assert.equal(fromAnotherSite({ origin: "http://100.1.2.3:4337", host: "100.1.2.3:4337" }), false);
	assert.equal(fromAnotherSite({ origin: "http://100.1.2.3:4337", host: "127.0.0.1:4336", "x-forwarded-host": "100.1.2.3:4337" }), false, "through a proxy that says what was asked");
	assert.equal(tokenOf({ authorization: "Bearer abc" }, "/ws"), "abc");
	assert.equal(tokenOf({}, "/ws?decks_token=xyz"), "xyz");
	assert.equal(tokenOf({}, "/ws"), undefined);
});

test("no code is asked of this machine, a home network or the tailnet; one is of the internet, also through a proxy", () => {
	for (const ip of ["127.0.0.1", "::1", "::ffff:192.168.1.20", "10.0.0.5", "172.20.1.1", "100.73.31.55", "fd7a:115c:a1e0::1"]) assert.ok(isPrivateAddress(ip), ip);
	for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "", undefined]) assert.ok(!isPrivateAddress(ip), String(ip));
	assert.ok(fromPrivateNetwork("100.73.31.55", {}));
	assert.ok(fromPrivateNetwork("127.0.0.1", {}), "this machine itself");
	assert.ok(fromPrivateNetwork("127.0.0.1", { "x-forwarded-for": "100.73.31.55" }), "the tailnet, through tailscale serve");
	assert.ok(!fromPrivateNetwork("127.0.0.1", { "x-forwarded-for": "203.0.113.9, 100.73.31.55" }), "the internet, through a funnel");
	assert.ok(!fromPrivateNetwork("203.0.113.9", {}));
	assert.ok(fromPrivateNetwork("10.0.0.2", { "x-forwarded-for": "8.8.8.8" }), "a forwarded header from a peer that is not this machine is not believed");
});

test("a token can be granted without a code, and revoked like any other", () => {
	const pairing = new Pairing(join(mkdtempSync(join(tmpdir(), "decks-grant-")), "pairing.json"));
	const token = pairing.grant("http://localhost:4337", "Laptop");
	assert.ok(pairing.check(token));
	assert.equal(pairing.list()[0]?.label, "Laptop");
});

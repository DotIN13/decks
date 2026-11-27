import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { App } from "../app.ts";
import { runVerb } from "../calls/run.ts";
import { createHttpApp } from "../connections/http.ts";
import { realPathOf } from "../deck/roots.ts";
import { Addresses } from "./addresses.ts";
import { studioAddress, StudioLogin, type SignedIn } from "./login.ts";

/*
 * The harness signs in to Studio itself, the way Claude Code signs in: it keeps a secret and opens
 * Studio with its hash, Studio shows the person a code, the code reaches the harness (Studio's button
 * on this machine, or pasted), and the harness trades it, with the secret, for its key. No page
 * hands it one.
 */

const KEY = "dsk_abcdefghijklmnopqrstuvwxyz012345";
const ACCOUNT = { name: "Ada", email: "ada@example.com" };

/**
 * A stand-in for Studio's side of it (the decks-studio repository's connect routes): it hands a key only
 * for a code it showed, and only to the secret whose hash the code was made for.
 */
async function fakeStudio() {
	const grants = new Map<string, string>();
	const asked: { path: string; body: Record<string, unknown> }[] = [];
	const signedOut: string[] = [];
	const server: Server = createServer((req, res) => {
		let text = "";
		req.on("data", (chunk) => (text += chunk));
		req.on("end", () => {
			const body = (text ? JSON.parse(text) : {}) as Record<string, string>;
			asked.push({ path: req.url ?? "", body });
			const say = (status: number, value: unknown) => {
				res.writeHead(status, { "Content-Type": "application/json" });
				res.end(JSON.stringify(value));
			};
			if (req.url === "/sync/v1/harness" && req.method === "DELETE") {
				signedOut.push(String(req.headers.authorization));
				return say(200, {});
			}
			if (req.url === "/api/connect/exchange") {
				const challenge = grants.get(body.code ?? "");
				if (!challenge || createHash("sha256").update(body.verifier ?? "").digest("base64url") !== challenge) return say(400, { error: "That code is wrong, has run out or was used already." });
				grants.delete(body.code!);
				return say(201, { key: KEY, harness: { id: "h1", name: "Mini" }, account: ACCOUNT });
			}
			say(404, { error: "no such route" });
		});
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return {
		base,
		asked,
		signedOut,
		/** The person, signed in to Studio, whose page shows the code for a challenge. */
		grant: (challenge: string) => {
			const code = `ACDE-FGH${grants.size + 3}`;
			grants.set(code, challenge);
			return code;
		},
		close: () => server.close(),
	};
}

const until = async (ready: () => boolean, ms = 4000) => {
	const end = Date.now() + ms;
	while (!ready() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
	assert.ok(ready(), "in time");
};

test("Studio's address is an http or https origin, the usual one unless said, and a tab is sent back only to this machine", () => {
	assert.equal(studioAddress(undefined, {}), "https://studio.decks.app");
	assert.equal(studioAddress("", { DECKS_STUDIO_URL: "http://127.0.0.1:4800/x" }), "http://127.0.0.1:4800");
	assert.equal(studioAddress(" https://studio.example.com/connect?x=1 ", {}), "https://studio.example.com");
	assert.throws(() => studioAddress("studio.example.com", {}), /http or https/);
	assert.throws(() => studioAddress("ftp://studio.example.com", {}), /http or https/);
	const login = new StudioLogin({ name: () => "Mac mini", signedIn: () => {}, changed: () => {} });
	const sentBack = (back: string | undefined) => new URL(login.start("https://studio.example.com", back).url).searchParams.has("redirect");
	try {
		for (const here of ["http://127.0.0.1:4329", "http://localhost:4329", "http://[::1]:4329"]) assert.ok(sentBack(here), here);
		for (const away of ["https://mac.tail1.ts.net:8443", "http://192.168.1.4:4329", "https://127.0.0.1:4329", "http://127.0.0.1", "", undefined, "nope"]) assert.ok(!sentBack(away), String(away));
	} finally {
		login.stop();
	}
});

test("on this machine: the address to open carries only the secret's hash and where to come back, and the tab coming back is traded once, for the sign-in this harness started", async () => {
	const studio = await fakeStudio();
	const got: SignedIn[] = [];
	const login = new StudioLogin({ name: () => "Mac mini", signedIn: (one) => got.push(one), changed: () => {} });
	try {
		const started = login.start(studio.base, "http://127.0.0.1:4329");
		assert.ok(started.expires > Date.now() + 500_000);
		assert.equal(started.studio, studio.base);
		const open = new URL(started.url);
		assert.equal(open.origin + open.pathname, `${studio.base}/connect`);
		assert.equal(open.searchParams.get("redirect"), "http://127.0.0.1:4329/api/studio/callback");
		assert.equal(open.searchParams.get("name"), "Mac mini");
		const challenge = open.searchParams.get("challenge")!;
		const state = open.searchParams.get("state")!;
		assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
		assert.ok(state.length >= 16);
		assert.deepEqual(login.showing(), { open: started });
		// A tab that comes back with a state this harness did not make is turned away, and spends nothing.
		await assert.rejects(login.finish(studio.grant(challenge), "not-mine"), /did not start that sign-in/);
		await assert.rejects(login.finish(studio.grant(challenge), ""), /did not start that sign-in/);
		const code = studio.grant(challenge);
		const done = await login.finish(code, state);
		assert.deepEqual(done, { url: studio.base, key: KEY, account: ACCOUNT });
		assert.deepEqual(got, [done]);
		assert.deepEqual(login.showing(), {}, "nothing left under way");
		// What went to Studio: the code and the secret whose hash it was sent first, and nothing else.
		const trade = studio.asked.at(-1)!;
		assert.equal(trade.path, "/api/connect/exchange");
		assert.deepEqual(Object.keys(trade.body).sort(), ["code", "verifier"]);
		assert.equal(createHash("sha256").update(String(trade.body.verifier)).digest("base64url"), challenge);
		// Once: the same tab again finds no sign-in under way.
		await assert.rejects(login.finish(code, state), /No sign-in to Studio is under way/);
	} finally {
		login.stop();
		studio.close();
	}
});

test("from anywhere else: the address says nowhere to come back, the code is pasted, a wrong one can be tried again, and giving up forgets it", async () => {
	const studio = await fakeStudio();
	const got: SignedIn[] = [];
	let changes = 0;
	const login = new StudioLogin({ name: () => "Mac mini", signedIn: (one) => got.push(one), changed: () => changes++ });
	try {
		// A tab on another device, or a terminal: no tab can be sent back to this harness.
		for (const back of ["https://mac.tail1.ts.net:8443", undefined]) {
			const open = new URL(login.start(studio.base, back).url);
			assert.equal(open.searchParams.get("redirect"), null);
			assert.equal(open.searchParams.get("state"), null);
			assert.match(open.searchParams.get("challenge")!, /^[A-Za-z0-9_-]{43}$/);
		}
		assert.ok(changes >= 2, "Settings is told a sign-in is under way");
		const challenge = new URL(login.showing().open!.url).searchParams.get("challenge")!;
		await assert.rejects(login.finish("  "), /Paste the code/);
		// Mistyped: Studio's own words, and the sign-in stays open for the right one.
		await assert.rejects(login.finish("AAAA-AAAA"), /wrong, has run out or was used/);
		assert.ok(login.showing().open);
		const done = await login.finish(` ${studio.grant(challenge)} `);
		assert.deepEqual(done, { url: studio.base, key: KEY, account: ACCOUNT });
		assert.deepEqual(got, [done]);
		assert.deepEqual(login.showing(), {});
		// With none under way a pasted code is turned away without asking Studio.
		const asks = studio.asked.length;
		await assert.rejects(login.finish("ACDE-FGH9"), /No sign-in to Studio is under way/);
		assert.equal(studio.asked.length, asks);
		// Giving up forgets it; a Studio that is not there is said plainly.
		login.start(studio.base);
		login.cancel();
		assert.deepEqual(login.showing(), {});
		login.start("http://127.0.0.1:9");
		await assert.rejects(login.finish("ACDE-FGH9"), /was not reached/);
	} finally {
		login.stop();
		studio.close();
	}
});

test("where the harness can be reached: the origins its tabs loaded from, newest first and kept across a restart, its own loopback last", () => {
	const deck = realPathOf(mkdtempSync(join(tmpdir(), "decks-addresses-")));
	try {
		const first = new Addresses(deck, "http://127.0.0.1:4329");
		assert.deepEqual(first.list(), ["http://127.0.0.1:4329"]);
		assert.equal(first.seen("http://127.0.0.1:4329/"), false, "its own loopback is not news");
		assert.equal(first.seen("http://localhost:4329"), false);
		assert.equal(first.seen("not an address"), false);
		assert.equal(first.seen("https://mac.tail1.ts.net:8443/some/page?x=1"), true);
		assert.equal(first.seen("https://mac.tail1.ts.net:8443"), false, "the same again is not news");
		assert.equal(first.seen("http://192.168.1.4:4329"), true);
		assert.deepEqual(first.list(), ["http://192.168.1.4:4329", "https://mac.tail1.ts.net:8443", "http://127.0.0.1:4329"]);
		assert.equal(first.seen("https://mac.tail1.ts.net:8443"), true, "seen again, it is the newest");
		// A restart: the same folder, read by a new run.
		const second = new Addresses(deck, "http://127.0.0.1:4329");
		assert.deepEqual(second.list(), ["https://mac.tail1.ts.net:8443", "http://192.168.1.4:4329", "http://127.0.0.1:4329"]);
		for (let i = 0; i < 8; i++) second.seen(`https://host${i}.tail1.ts.net`);
		assert.equal(second.list().length, 6, "a handful, and its own");
		assert.deepEqual(new Addresses(deck, undefined).list().length, 5, "with no address of its own, only what it remembers");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("in the harness: Sign in to Studio answers an address to open; Studio's button brings the tab back on this machine, and from another device or a terminal the code is pasted", async () => {
	const studio = await fakeStudio();
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-studio-login-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "cards"), { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const person = (verb: string, args: unknown[]) => runVerb(app, { kind: "person" }, {}, verb, args);
	const file = join(deck, ".decks", "studio.json");
	try {
		// An agent cannot: only the person signs the harness in.
		assert.equal((await runVerb(app, { kind: "agent", id: app.agents.focused().id }, {}, "harness.studioSignIn", [{ studio: studio.base, back: base }])).status, 403);
		const started = await person("harness.studioSignIn", [{ studio: studio.base, back: base }]);
		assert.ok(started.answer.ok, JSON.stringify(started.answer));
		const open = new URL((started.answer as { value: { url: string } }).value.url);
		assert.equal(open.searchParams.get("redirect"), `${base}/api/studio/callback`);
		assert.equal((app.pairingMessage() as { studioSignIn?: { open?: { url: string } } }).studioSignIn?.open?.url, open.href, "Settings shows a sign-in under way");
		// The tab comes back with no token of this harness's: let in by the state alone.
		const wrong = await fetch(`${base}/api/studio/callback?state=nope&code=x`);
		assert.equal(wrong.status, 400);
		assert.match(await wrong.text(), /did not start that sign-in/);
		const code = studio.grant(open.searchParams.get("challenge")!);
		assert.ok(!existsSync(file));
		const back = await fetch(`${base}/api/studio/callback?state=${open.searchParams.get("state")}&code=${code}`);
		assert.equal(back.status, 200);
		assert.match(await back.text(), /Signed in to Decks Studio[\s\S]*ada@example\.com/);
		assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { url: studio.base, key: KEY, account: ACCOUNT });
		const shown = app.pairingMessage() as { studio?: { url: string; account?: { email: string } }; studioSignIn?: unknown; studioAt?: string };
		assert.deepEqual(shown.studio, { url: studio.base, account: ACCOUNT });
		assert.equal(shown.studioSignIn, undefined);
		assert.ok(shown.studioAt, "Settings is told which Studio a sign-in would go to");

		// Signed out, then in again from a tab on another device: nothing can come back here, so the code is pasted into Settings.
		assert.ok((await person("harness.unpair", [])).answer.ok);
		assert.ok(!existsSync(file));
		await until(() => studio.signedOut.length === 1);
		assert.deepEqual(studio.signedOut, [`Bearer ${KEY}`], "Studio is told, with the key, so it forgets this harness");
		const away = await person("harness.studioSignIn", [{ studio: studio.base, back: "https://mac.tail1.ts.net:8443" }]);
		const far = new URL((away.answer as { value: { url: string } }).value.url);
		assert.equal(far.searchParams.get("redirect"), null);
		assert.equal((await person("harness.studioCode", ["AAAA-AAAA"])).answer.ok, false, "a wrong code is refused, in Studio's words");
		assert.equal((await runVerb(app, { kind: "agent", id: app.agents.focused().id }, {}, "harness.studioCode", [studio.grant(far.searchParams.get("challenge")!)])).status, 403, "not an agent's to paste");
		assert.ok((await person("harness.studioCode", [studio.grant(far.searchParams.get("challenge")!)])).answer.ok);
		assert.equal(JSON.parse(readFileSync(file, "utf8")).key, KEY);
		assert.equal((app.pairingMessage() as { studioSignIn?: unknown }).studioSignIn, undefined);

		// From a terminal: the verbs the decks command runs. An address, then the code it showed.
		await person("harness.unpair", []);
		const term = await runVerb(app, { kind: "person" }, {}, "studio.login", [studio.base]);
		assert.ok(term.answer.ok, JSON.stringify(term.answer));
		const there = new URL((term.answer as { value: { url: string } }).value.url);
		assert.equal(there.origin + there.pathname, `${studio.base}/connect`);
		assert.equal(there.searchParams.get("redirect"), null);
		assert.match(term.answer.notes.join(" "), /Studio shows a code there/);
		const status = await runVerb(app, { kind: "person" }, {}, "studio.status", []);
		assert.deepEqual((status.answer as { value: unknown }).value, { connected: false, signingIn: there.href });
		assert.equal((await runVerb(app, { kind: "agent", id: app.agents.focused().id }, {}, "studio.login", [studio.base])).answer.ok, false, "not an agent's to call");
		assert.equal((await runVerb(app, { kind: "agent", id: app.agents.focused().id }, {}, "studio.code", ["ACDE-FGH3"])).answer.ok, false, "nor to finish");
		const done = await runVerb(app, { kind: "person" }, {}, "studio.code", [studio.grant(there.searchParams.get("challenge")!)]);
		assert.deepEqual((done.answer as { value: unknown }).value, { connected: true, url: studio.base, account: ACCOUNT.email });
		assert.deepEqual(((await runVerb(app, { kind: "person" }, {}, "studio.status", [])).answer as { value: unknown }).value, { connected: true, url: studio.base, account: ACCOUNT.email });
	} finally {
		server.close();
		app.dispose();
		studio.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});

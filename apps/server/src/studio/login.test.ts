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
import { isLoopbackOrigin, studioAddress, StudioLogin, type SignedIn } from "./login.ts";

/*
 * The harness signs in to Studio itself: it keeps a secret and sends its hash, the person says the
 * harness is theirs on Studio (a redirect on this machine, or its short code typed), and the harness
 * trades what it holds, with the secret, for its key. No page hands it one.
 */

const KEY = "dsk_abcdefghijklmnopqrstuvwxyz012345";
const ACCOUNT = { name: "Ada", email: "ada@example.com" };

/**
 * A stand-in for Studio's side of it (the decks-studio repository's connect routes): it hands a key only
 * for a code or a device it gave, and only to the secret whose hash came first.
 */
async function fakeStudio() {
	const devices = new Map<string, { challenge: string; typed: boolean }>();
	const grants = new Map<string, string>();
	const asked: { path: string; body: Record<string, unknown> }[] = [];
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
			const proves = (challenge: string | undefined) => !!challenge && createHash("sha256").update(body.verifier ?? "").digest("base64url") === challenge;
			if (req.url === "/api/connect/device") {
				const device = `dev-${devices.size + 1}`;
				devices.set(device, { challenge: body.challenge!, typed: false });
				return say(200, { device, code: "ACDE-FGHJ", verify: `${base}/connect`, expires: 600, interval: 0.25 });
			}
			if (req.url === "/api/connect/exchange") {
				if (body.code) {
					const challenge = grants.get(body.code);
					grants.delete(body.code);
					return proves(challenge) ? say(201, { key: KEY, harness: { id: "h1", name: "Mini" }, account: ACCOUNT }) : say(400, { error: "This sign-in has run out or was used already." });
				}
				const one = devices.get(body.device ?? "");
				if (!one || !proves(one.challenge)) return say(400, { error: "This sign-in has run out or was used already." });
				if (!one.typed) return say(202, { waiting: true });
				devices.delete(body.device!);
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
		/** The person, signed in to Studio, whose page asks for a redirect's code for a challenge. */
		grant: (challenge: string) => {
			const code = `code-${grants.size + 1}`;
			grants.set(code, challenge);
			return code;
		},
		/** The person types the short code. */
		type: () => devices.forEach((one) => (one.typed = true)),
		forget: () => devices.clear(),
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
	for (const here of ["http://127.0.0.1:4329", "http://localhost:4329", "http://[::1]:4329"]) assert.ok(isLoopbackOrigin(here), here);
	for (const away of ["https://mac.tail1.ts.net:8443", "http://192.168.1.4:4329", "https://127.0.0.1:4329", "http://127.0.0.1", "", undefined, "nope"]) assert.ok(!isLoopbackOrigin(away), String(away));
});

test("by a redirect: the address to open carries only the secret's hash, and the tab coming back is traded once, for the sign-in this harness started", async () => {
	const studio = await fakeStudio();
	const got: SignedIn[] = [];
	const login = new StudioLogin({ name: () => "Mac mini", signedIn: (one) => got.push(one), changed: () => {} });
	try {
		assert.throws(() => login.start(studio.base, "https://mac.tail1.ts.net:8443"), /only to this machine/);
		const { url } = login.start(studio.base, "http://127.0.0.1:4329");
		const open = new URL(url);
		assert.equal(open.origin + open.pathname, `${studio.base}/connect`);
		assert.equal(open.searchParams.get("redirect"), "http://127.0.0.1:4329/api/studio/callback");
		assert.equal(open.searchParams.get("name"), "Mac mini");
		const challenge = open.searchParams.get("challenge")!;
		const state = open.searchParams.get("state")!;
		assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
		assert.ok(state.length >= 16);
		// A tab that comes back with a state this harness did not make is turned away, and spends nothing.
		await assert.rejects(login.finish("not-mine", studio.grant(challenge)), /did not start that sign-in/);
		const code = studio.grant(challenge);
		const done = await login.finish(state, code);
		assert.deepEqual(done, { url: studio.base, key: KEY, account: ACCOUNT });
		assert.deepEqual(got, [done]);
		// What went to Studio: the code and the secret whose hash it was sent first, and nothing else.
		const trade = studio.asked.at(-1)!;
		assert.equal(trade.path, "/api/connect/exchange");
		assert.deepEqual(Object.keys(trade.body).sort(), ["code", "verifier"]);
		assert.equal(createHash("sha256").update(String(trade.body.verifier)).digest("base64url"), challenge);
		// Once: the same tab again is turned away.
		await assert.rejects(login.finish(state, code), /did not start that sign-in/);
		// Studio saying no is said as Studio said it.
		const again = new URL(login.start(studio.base, "http://localhost:4329").url);
		await assert.rejects(login.finish(again.searchParams.get("state")!, "a-code-studio-never-gave"), /run out or was used/);
	} finally {
		login.stop();
		studio.close();
	}
});

test("by a short code: the harness shows it, asks until it is typed on Studio, and then has its key; a code Studio forgets ends the sign-in and says so", async () => {
	const studio = await fakeStudio();
	const got: SignedIn[] = [];
	let changes = 0;
	const login = new StudioLogin({ name: () => "Mac mini", signedIn: (one) => got.push(one), changed: () => changes++ });
	try {
		const shown = await login.code(studio.base);
		assert.equal(shown.code, "ACDE-FGHJ");
		assert.equal(shown.verify, `${studio.base}/connect`);
		assert.ok(shown.expires > Date.now() + 500_000);
		assert.deepEqual(login.showing(), { code: shown });
		assert.equal(studio.asked[0]!.body.name, "Mac mini");
		// Asked a few times with nobody typing: still waiting, no key.
		await until(() => studio.asked.filter((one) => one.path === "/api/connect/exchange").length >= 2);
		assert.equal(got.length, 0);
		studio.type();
		await until(() => got.length === 1);
		assert.deepEqual(got[0], { url: studio.base, key: KEY, account: ACCOUNT });
		assert.deepEqual(login.showing(), {}, "nothing left on show");

		// Another, which Studio forgets (it ran out there): the harness stops asking and says why.
		await login.code(studio.base);
		const before = changes;
		studio.forget();
		await until(() => login.showing().failed !== undefined);
		assert.match(login.showing().failed!, /run out or was used/);
		assert.equal(login.showing().code, undefined);
		assert.ok(changes > before, "Settings is told");
		// Starting again clears the old failure; giving up clears the code.
		await login.code(studio.base);
		assert.equal(login.showing().failed, undefined);
		login.cancel();
		assert.deepEqual(login.showing(), {});
		// A Studio that is not there is said plainly.
		await assert.rejects(login.code("http://127.0.0.1:9"), /was not reached/);
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

test("in the harness: Sign in to Studio from a tab on this machine answers an address to open, the tab coming back signs it in, and from another device it is a short code", async () => {
	const studio = await fakeStudio();
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-studio-login-")));
	const deck = join(dataDir, "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
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

		// Signed out, then in again from a tab on another device: no redirect can come back here, so a short code.
		assert.ok((await person("harness.unpair", [])).answer.ok);
		assert.ok(!existsSync(file));
		const away = await person("harness.studioSignIn", [{ studio: studio.base, back: "https://mac.tail1.ts.net:8443" }]);
		const code2 = (away.answer as { value: { shown: { code: string; verify: string } } }).value.shown;
		assert.equal(code2.code, "ACDE-FGHJ");
		assert.deepEqual((app.pairingMessage() as { studioSignIn?: { code?: { code: string } } }).studioSignIn?.code?.code, "ACDE-FGHJ", "Settings shows the code");
		studio.type();
		await until(() => existsSync(file));
		assert.equal(JSON.parse(readFileSync(file, "utf8")).key, KEY);
		assert.equal((app.pairingMessage() as { studioSignIn?: unknown }).studioSignIn, undefined);

		// From a terminal: the same short code, by the verb the decks command runs.
		await person("harness.unpair", []);
		const term = await runVerb(app, { kind: "person" }, {}, "studio.login", [studio.base]);
		assert.ok(term.answer.ok, JSON.stringify(term.answer));
		assert.equal((term.answer as { value: { code: string } }).value.code, "ACDE-FGHJ");
		assert.match(term.answer.notes.join(" "), /type ACDE-FGHJ/);
		const status = await runVerb(app, { kind: "person" }, {}, "studio.status", []);
		assert.deepEqual((status.answer as { value: unknown }).value, { connected: false, code: "ACDE-FGHJ", verify: `${studio.base}/connect` });
		assert.equal((await runVerb(app, { kind: "agent", id: app.agents.focused().id }, {}, "studio.login", [studio.base])).answer.ok, false, "not an agent's to call");
	} finally {
		server.close();
		app.dispose();
		studio.close();
		rmSync(dataDir, { recursive: true, force: true });
	}
});

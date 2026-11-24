import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { test } from "node:test";
import { App } from "../app.ts";
import { createHttpApp } from "../connections/http.ts";
import { realPathOf } from "../deck/roots.ts";
import { DeviceLogins, LoginThrottle, loginCookie, PasswordStore, passwordMaySend } from "./password.ts";

/*
 * A password locks a Decks served where anyone can reach it: the page that hands out access asks a
 * browser to log in first, a forwarded port needs the login too, and a terminal elsewhere is let in
 * from a logged-in browser. With no password set, nothing changes.
 */

test("the password is kept as a slow hash in a file only this user reads, and a short one is refused", () => {
	const file = join(mkdtempSync(join(tmpdir(), "decks-pw-")), "password.json");
	const store = new PasswordStore(file);
	assert.equal(store.isSet, false);
	assert.throws(() => store.set("short"), /at least 10/);
	store.set("correct horse battery");
	assert.ok(store.check("correct horse battery"));
	assert.ok(!store.check("correct horse batterY"));
	assert.ok(!readFileSync(file, "utf8").includes("horse"));
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.ok(new PasswordStore(file).check("correct horse battery"), "read back after a restart");
	store.set(null);
	assert.equal(new PasswordStore(file).isSet, false);
});

test("wrong tries from one address slow it down after five, and a right one starts its count again", () => {
	const throttle = new LoginThrottle();
	const t = 1_000_000;
	for (let i = 0; i < 4; i++) throttle.wrong("1.2.3.4", t);
	assert.equal(throttle.wait("1.2.3.4", t), 0);
	throttle.wrong("1.2.3.4", t);
	assert.equal(throttle.wait("1.2.3.4", t), 30);
	throttle.wrong("1.2.3.4", t);
	assert.equal(throttle.wait("1.2.3.4", t), 60, "doubling");
	assert.equal(throttle.wait("5.6.7.8", t), 0, "another address is not held");
	throttle.right("1.2.3.4");
	assert.equal(throttle.wait("1.2.3.4", t), 0);
});

test("a password is sent only over HTTPS, or straight from this Mac or the tailnet", () => {
	assert.ok(passwordMaySend("127.0.0.1", false, {}));
	assert.ok(passwordMaySend("100.101.1.2", false, {}), "the tailnet");
	assert.ok(!passwordMaySend("203.0.113.9", false, {}), "a public address over plain HTTP");
	assert.ok(!passwordMaySend("127.0.0.1", false, { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "http" }, { DECKS_TRUST_PROXY: "1" }), "through a proxy over plain HTTP");
	assert.ok(passwordMaySend("127.0.0.1", false, { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" }, { DECKS_TRUST_PROXY: "1" }), "Caddy over HTTPS");
	assert.ok(!passwordMaySend("127.0.0.1", false, { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" }, {}), "a proxy not trusted is not believed");
	assert.match(loginCookie("t", true), /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
});

test("a terminal waiting for the person is let in once, by its code, and its code runs out", () => {
	const logins = new DeviceLogins();
	const t = 1_000_000;
	const started = logins.start("decks login on mini", t);
	assert.match(started.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
	assert.deepEqual(logins.poll(started.id, t), { waiting: true });
	assert.equal(logins.find(started.code.toLowerCase(), t)?.label, "decks login on mini");
	assert.equal(logins.approve(started.code, () => "dk_h_x", t)?.label, "decks login on mini");
	assert.equal(logins.approve(started.code, () => "dk_h_y", t), undefined, "once");
	assert.deepEqual(logins.poll(started.id, t), { token: "dk_h_x" });
	assert.equal(logins.poll(started.id, t), undefined, "and only once");
	const late = logins.start("late", t);
	assert.equal(logins.find(late.code, t + 11 * 60_000), undefined);
});

async function harness(password?: string, on = password !== undefined) {
	const dataDir = realPathOf(mkdtempSync(join(tmpdir(), "decks-login-")));
	const deck = join(dataDir, "decks");
	mkdirSync(deck, { recursive: true });
	const app = App.open({ host: "127.0.0.1", port: 0, dataDir, deck, backend: "pi" });
	app.passwordLogin = on;
	if (password) app.password.set(password);
	const server = createHttpApp(app).listen(0, "127.0.0.1");
	await new Promise((done) => server.once("listening", done));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { app, origin, close: () => (server.close(), app.dispose()) };
}

const tab = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" };

/** A tab opening a page: by node:http, since fetch sets the sec-fetch headers itself and a page is given its token only on a navigation. */
function open(url: string, cookie?: string): Promise<{ status: number; location?: string; text: string }> {
	return new Promise((done, fail) => {
		const asked = request(url, { headers: { ...tab, ...(cookie ? { cookie } : {}) } }, (response) => {
			let text = "";
			response.setEncoding("utf8");
			response.on("data", (chunk: string) => (text += chunk));
			response.on("end", () => done({ status: response.statusCode ?? 0, location: response.headers.location, text }));
		});
		asked.on("error", fail);
		asked.end();
	});
}
const json = { "content-type": "application/json" };

test("with no password set, a tab is given its token as before, and there is nothing to log in to", async () => {
	const { origin, close } = await harness();
	try {
		const page = await open(`${origin}/`);
		assert.equal(page.status, 200);
		assert.match(page.text, /decks-session/);
		assert.deepEqual(await (await fetch(`${origin}/api/login/state`)).json(), { enabled: false, password: false, loggedIn: false });
		assert.equal((await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "anything at all" }) })).status, 404);
	} finally {
		close();
	}
});

test("a password on disk asks for nothing while DECKS_PASSWORD_LOGIN is off, and the login on with no password yet hands out nothing", async () => {
	const off = await harness("correct horse battery", false);
	try {
		const page = await open(`${off.origin}/`);
		assert.equal(page.status, 200, "off: the page opens as it always has");
		assert.match(page.text, /decks-session/);
		assert.equal((await fetch(`${off.origin}/node/5173/`)).status !== 401, true, "off: forwarded ports as before");
		assert.equal(off.app.codes.required, false, "off: pairing as before");
		assert.equal((await fetch(`${off.origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse battery" }) })).status, 404);
	} finally {
		off.close();
	}
	const bare = await harness(undefined, true);
	try {
		assert.equal((await open(`${bare.origin}/`)).status, 302, "on with no password: sent to /login, never given a token");
		assert.deepEqual(await (await fetch(`${bare.origin}/api/login/state`)).json(), { enabled: true, password: false, loggedIn: false });
		assert.equal((await fetch(`${bare.origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "anything at all" }) })).status, 409);
	} finally {
		bare.close();
	}
});

test("with a password, the page sends a browser to log in, the login's cookie gets the page, and logging out takes it back", async () => {
	const { app, origin, close } = await harness("correct horse battery");
	try {
		const away = await open(`${origin}/canvas/plan`);
		assert.equal(away.status, 302);
		assert.equal(away.location, "/login?next=%2Fcanvas%2Fplan");
		const wrong = await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "not it at all" }) });
		assert.equal(wrong.status, 403);
		assert.equal(wrong.headers.get("set-cookie"), null);
		const right = await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse battery" }) });
		assert.equal(right.status, 200);
		const cookie = right.headers.get("set-cookie")!.split(";")[0]!;
		assert.match(cookie, /^decks_login=dk_h_/);
		assert.deepEqual(await (await fetch(`${origin}/api/login/state`, { headers: { cookie } })).json(), { enabled: true, password: true, loggedIn: true });
		const page = await open(`${origin}/`, cookie);
		assert.equal(page.status, 200);
		assert.match(page.text, /decks-session/);
		assert.equal((await fetch(`${origin}/api/logout`, { method: "POST", headers: { cookie } })).status, 200);
		assert.equal((await open(`${origin}/`, cookie)).status, 302, "the cookie no longer opens the page");
		assert.equal(app.codes.required, true, "and nothing pairs without a code while a password is set");
	} finally {
		close();
	}
});

test("another site cannot log in with the person's browser, and five wrong tries hold an address", async () => {
	const { origin, close } = await harness("correct horse battery");
	try {
		const cross = await fetch(`${origin}/api/login/password`, { method: "POST", headers: { ...json, origin: "https://evil.test", "sec-fetch-site": "cross-site" }, body: JSON.stringify({ password: "correct horse battery" }) });
		assert.equal(cross.status, 403);
		for (let i = 0; i < 4; i++) assert.equal((await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: `guess number ${i}` }) })).status, 403);
		const fifth = await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "guess number 5" }) });
		assert.equal(fifth.status, 429);
		assert.equal(((await fifth.json()) as { retryAfter: number }).retryAfter, 30);
		const held = await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse battery" }) });
		assert.equal(held.status, 429, "even the right one waits");
	} finally {
		close();
	}
});

test("a forwarded port needs the login, and a terminal elsewhere is let in from a logged-in browser", async () => {
	const { app, origin, close } = await harness("correct horse battery");
	try {
		assert.equal((await fetch(`${origin}/node/5173/`)).status, 401);
		const started = (await (await fetch(`${origin}/api/login/device`, { method: "POST", headers: json, body: JSON.stringify({ label: "decks login on mini" }) })).json()) as { id: string; code: string; url: string };
		assert.equal(started.url, `/login?approve=${started.code}`);
		assert.deepEqual(await (await fetch(`${origin}/api/login/device/poll`, { method: "POST", headers: json, body: JSON.stringify({ id: started.id }) })).json(), { waiting: true });
		assert.equal((await fetch(`${origin}/api/login/device/approve`, { method: "POST", headers: json, body: JSON.stringify({ code: started.code }) })).status, 401, "not logged in");
		const login = await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "correct horse battery" }) });
		const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
		assert.equal(((await (await fetch(`${origin}/api/login/device?code=${started.code}`)).json()) as { label: string }).label, "decks login on mini");
		assert.equal((await fetch(`${origin}/api/login/device/approve`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ code: started.code }) })).status, 200);
		const got = (await (await fetch(`${origin}/api/login/device/poll`, { method: "POST", headers: json, body: JSON.stringify({ id: started.id }) })).json()) as { token: string };
		assert.match(got.token, /^dk_h_/);
		assert.equal((await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${got.token}` } }).then((r) => r.json()) as { kind: string }).kind, "person");
		assert.equal(app.tokens.verify(got.token).ok, true);
	} finally {
		close();
	}
});

test("the password is set on this Mac without the old one, changed elsewhere only with it, and signing out everywhere ends every login", async () => {
	const { app, origin, close } = await harness(undefined, true);
	try {
		const machine = app.tokens.issue({ kind: "person" }, { label: "decks login on this machine" });
		app.cliTokenId = machine.id;
		const set = await fetch(`${origin}/api/password`, { method: "POST", headers: { ...json, authorization: `Bearer ${machine.token}` }, body: JSON.stringify({ password: "correct horse battery" }) });
		assert.equal(set.status, 200);
		assert.ok(app.password.isSet);
		const person = app.tokens.issue({ kind: "person" }, { label: "Decks tab" });
		const bad = await fetch(`${origin}/api/password`, { method: "POST", headers: { ...json, authorization: `Bearer ${person.token}` }, body: JSON.stringify({ current: "nope nope nope", password: "a new one, long enough" }) });
		assert.equal(bad.status, 403);
		const good = await fetch(`${origin}/api/password`, { method: "POST", headers: { ...json, authorization: `Bearer ${person.token}` }, body: JSON.stringify({ current: "correct horse battery", password: "a new one, long enough" }) });
		assert.equal(good.status, 200);
		assert.ok(app.password.check("a new one, long enough"));
		const removed = await fetch(`${origin}/api/password`, { method: "POST", headers: { ...json, authorization: `Bearer ${person.token}` }, body: JSON.stringify({ current: "a new one, long enough", password: null }) });
		assert.equal(removed.status, 403, "taken away only on the Mac");
		const login = await fetch(`${origin}/api/login/password`, { method: "POST", headers: json, body: JSON.stringify({ password: "a new one, long enough" }) });
		const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
		const out = (await (await fetch(`${origin}/api/login/everywhere`, { method: "POST", headers: { authorization: `Bearer ${person.token}` } })).json()) as { revoked: number };
		assert.ok(out.revoked >= 2);
		assert.equal(app.tokens.verify(person.token).ok, false);
		assert.deepEqual(await (await fetch(`${origin}/api/login/state`, { headers: { cookie } })).json(), { enabled: true, password: true, loggedIn: false });
		assert.equal(app.tokens.verify(machine.token).ok, true, "this Mac's own token stays");
	} finally {
		close();
	}
});

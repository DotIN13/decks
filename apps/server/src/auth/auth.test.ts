import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bearerOf, fromAnotherSite, harnessReads, isDoor, isPublic, queryTokenOf, socketPrincipal, verifyOn } from "./guard.ts";
import { fromPrivateNetwork, isPrivateAddress, isTopNavigation, PairCodes, pairWithoutCode, withSession } from "./issue.ts";
import { Passes } from "./passes.ts";
import { TOKEN_IDLE_MS, TokenStore, tokenDays } from "./tokens.ts";

const DAY = 86_400_000;

function store(name = "tokens.json", options: { days?: number; now?: number } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "decks-auth-"));
	return { dir, file: join(dir, ".decks", name), tokens: new TokenStore(join(dir, ".decks", name), options) };
}

test("a harness token is one kind whoever its subject, is kept only as its hash, in a file only this user reads", () => {
	const { file, tokens } = store();
	const person = tokens.issue({ kind: "person" }, { label: "decks login" });
	const site = tokens.issue({ kind: "site", origin: "https://studio.test", label: "Decks Studio" });
	assert.match(person.token, /^dk_h_[\w-]{43}$/);
	assert.match(site.token, /^dk_h_/);
	assert.match(tokens.issue({ kind: "agent", id: "a1" }).token, /^dk_h_/);
	assert.throws(() => tokens.issue({ kind: "app", name: "notes" }), /holds a pass/);
	assert.throws(() => tokens.issue({ kind: "board", path: "boards/a.html" } as never), "a board has no token any more");
	const text = readFileSync(file, "utf8");
	assert.ok(!text.includes(person.token) && !text.includes(site.token), "no token in the clear");
	assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("verify answers the principal a token was given for, and why it refuses one", () => {
	const { tokens } = store();
	const person = tokens.issue({ kind: "person" });
	const agent = tokens.issue({ kind: "agent", id: "a1" });
	const seen = tokens.verify(person.token);
	assert.ok(seen.ok);
	assert.deepEqual(seen.principal, { kind: "person" });
	assert.equal(seen.id, person.id);
	const as = tokens.verify(agent.token);
	assert.ok(as.ok && as.principal.kind === "agent" && as.principal.id === "a1");
	assert.deepEqual(tokens.verify(undefined), { ok: false, reason: "missing" });
	assert.deepEqual(tokens.verify("dk_p_made-up"), { ok: false, reason: "unknown" });
});

test("a site's token works only from its own site or from a caller that sends no Origin", () => {
	const { tokens } = store();
	const { token } = tokens.issue({ kind: "site", origin: "https://studio.test", label: "Studio" });
	assert.ok(tokens.verify(token, { origin: "https://studio.test" }).ok);
	assert.ok(tokens.verify(token).ok, "a program");
	assert.deepEqual(tokens.verify(token, { origin: "https://evil.test" }), { ok: false, reason: "elsewhere" });
});

test("tokens slide: every one lasts a day unused but the decks command's in a terminal, which lasts thirty, and an agent's lasts as long as its agent", () => {
	const t0 = Date.now();
	const { file, tokens } = store("tokens.json", { days: 30, now: t0 });
	const terminal = tokens.issue({ kind: "person" }, { label: "decks login", terminal: true, now: t0 });
	const left = tokens.issue({ kind: "person" }, { label: "decks login", terminal: true, now: t0 });
	const tab = tokens.issue({ kind: "person" }, { label: "Decks tab", now: t0 });
	const site = tokens.issue({ kind: "site", label: "Studio", origin: "https://studio.test" }, { now: t0 });
	const file2 = tokens.issue({ kind: "person" }, { label: "decks login on this machine", now: t0 });
	const agent = tokens.issue({ kind: "agent", id: "a1" }, { now: t0 });
	assert.ok(tokens.verify(terminal.token, { now: t0 + 20 * DAY }).ok, "a terminal's, used on day 20");
	assert.ok(tokens.verify(terminal.token, { now: t0 + 45 * DAY }).ok, "45 days in, 25 since it was last used");
	assert.deepEqual(tokens.verify(left.token, { now: t0 + 31 * DAY }), { ok: false, reason: "expired" });
	assert.deepEqual(tokens.verify(left.token, { now: t0 }), { ok: false, reason: "unknown" }, "and forgotten");
	assert.equal(TOKEN_IDLE_MS, DAY);
	for (const [name, one] of [["a tab's", tab], ["a site's", site], ["the file decks login reads", file2]] as const) {
		assert.ok(tokens.verify(one.token, { now: t0 + 23 * 3_600_000, origin: "https://studio.test" }).ok, `${name}, used within the day`);
		assert.ok(!tokens.verify(one.token, { now: t0 + 23 * 3_600_000 + DAY + 1, origin: "https://studio.test" }).ok, `${name} left a day`);
	}
	assert.ok(tokens.verify(agent.token, { now: t0 + 400 * DAY }).ok, "an agent's lives as long as its agent");
	assert.equal(tokenDays({}), 30);
	assert.equal(tokenDays({ DECKS_TOKEN_DAYS: "7" }), 7);
	assert.equal(tokenDays({ DECKS_TOKEN_DAYS: "nonsense" }), 30);
	// What is written down outlives the process; an agent's token is not written down.
	const again = new TokenStore(file, { days: 30, now: t0 + 45 * DAY });
	assert.ok(again.verify(terminal.token, { now: t0 + 45 * DAY }).ok);
	assert.deepEqual(again.verify(agent.token), { ok: false, reason: "unknown" }, "an agent's token ends with the harness");
});

test("tokens of the kinds from before are read as harness tokens with their subject, and nobody is signed out by the change", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-old-kinds-"));
	const file = join(dir, ".decks", "tokens.json");
	mkdirSync(join(dir, ".decks"), { recursive: true });
	const t0 = Date.now();
	const row = (token: string, principal: object, label: string, last: number, idle: number) => {
		const hash = createHash("sha256").update(token).digest("hex");
		return { id: hash.slice(0, 10), hash, principal, label, at: last, last, idle };
	};
	// As the store wrote them before: a terminal's and a site's for 30 days, a tab's for a day, no version.
	writeFileSync(
		file,
		JSON.stringify({
			migrated: true,
			tokens: [
				row("dk_p_terminal", { kind: "person" }, "laptop", t0 - 20 * DAY, 30 * DAY),
				row("dk_s_studio", { kind: "site", label: "Decks Studio", origin: "https://studio.test" }, "Decks Studio", t0 - 10 * DAY, 30 * DAY),
				row("dk_p_tab", { kind: "person" }, "Decks tab", t0 - 3_600_000, DAY),
				row("dk_p_gone", { kind: "person" }, "Decks tab", t0 - 2 * DAY, DAY),
			],
		}),
	);
	const tokens = new TokenStore(file, { days: 30, now: t0 });
	const terminal = tokens.verify("dk_p_terminal", { now: t0 });
	assert.deepEqual(terminal.ok && terminal.principal, { kind: "person" }, "a terminal's, the person");
	const studio = tokens.verify("dk_s_studio", { origin: "https://studio.test", now: t0 });
	assert.deepEqual(studio.ok && studio.principal, { kind: "site", label: "Decks Studio", origin: "https://studio.test" }, "a site's, still that site");
	assert.deepEqual(tokens.verify("dk_s_studio", { origin: "https://evil.test", now: t0 }), { ok: false, reason: "elsewhere" }, "and bound to it");
	assert.ok(tokens.verify("dk_p_tab", { now: t0 }).ok, "a tab's");
	assert.ok(!tokens.verify("dk_p_gone", { now: t0 }).ok, "one already run out stays out");
	// The new lives, from the change: the site's a day (it had 20 of its 30 left), the terminal's 30.
	const later = new TokenStore(file, { days: 30, now: t0 + 2 * DAY });
	assert.ok(!later.verify("dk_s_studio", { origin: "https://studio.test", now: t0 + 2 * DAY }).ok, "a site's lasts a day unused now");
	assert.ok(later.verify("dk_p_terminal", { now: t0 + 2 * DAY }).ok, "a terminal's lasts thirty");
	assert.equal(JSON.parse(readFileSync(file, "utf8")).v, 2, "given the new lives once");
});

test("revoke takes one token back by id, revokeWhere every token of a principal", () => {
	const { tokens } = store();
	const one = tokens.issue({ kind: "agent", id: "a1" });
	const two = tokens.issue({ kind: "agent", id: "a1" });
	const other = tokens.issue({ kind: "agent", id: "a2" });
	const site = tokens.issue({ kind: "site", label: "S" });
	assert.equal(tokens.revokeWhere((principal) => principal.kind === "agent" && principal.id === "a1"), 2);
	assert.ok(!tokens.verify(one.token).ok && !tokens.verify(two.token).ok);
	assert.ok(tokens.verify(other.token).ok);
	assert.ok(tokens.revoke(site.id));
	assert.ok(!tokens.verify(site.token).ok);
	assert.ok(!tokens.revoke(site.id), "gone already");
});

test("a board's token from before is dropped: nothing asks for one any more", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-boards-gone-"));
	const file = join(dir, ".decks", "tokens.json");
	mkdirSync(join(dir, ".decks"), { recursive: true });
	const now = Date.now();
	const hash = createHash("sha256").update("dk_b_old").digest("hex");
	writeFileSync(file, JSON.stringify({ v: 2, tokens: [{ id: hash.slice(0, 10), hash, principal: { kind: "board", path: "boards/a.html" }, at: now, last: now, idle: DAY }] }));
	assert.deepEqual(new TokenStore(file).verify("dk_b_old"), { ok: false, reason: "unknown" });
});

test("a code works once, dies after five wrong tries, and is asked for when Settings says so", () => {
	const { tokens } = store();
	const codes = new PairCodes(tokens);
	const { code } = codes.newCode();
	assert.equal(codes.redeem(code === "000000" ? "111111" : "000000"), false);
	assert.equal(codes.redeem(code), true);
	assert.equal(codes.redeem(code), false, "spent");
	const second = codes.newCode().code;
	const wrong = second === "999999" ? "888888" : "999999";
	for (let i = 0; i < 5; i++) codes.redeem(wrong);
	assert.equal(codes.redeem(second), false, "five wrong tries kill the code");
	assert.equal(codes.required, false);
	codes.setRequired(true);
	assert.equal(codes.required, true);
	assert.equal(new PairCodes(tokens, { required: true }).forced, true);
});

test("only a browser saying cross-site counts as another site; a bearer header carries the token, and a socket's address", () => {
	assert.equal(fromAnotherSite({ "sec-fetch-site": "same-origin" }), false);
	assert.equal(fromAnotherSite({}), false);
	assert.equal(fromAnotherSite({ "sec-fetch-site": "cross-site" }), true);
	assert.equal(fromAnotherSite({ origin: "http://100.1.2.3:4337", host: "100.1.2.3:4346" }), true);
	assert.equal(fromAnotherSite({ origin: "http://100.1.2.3:4337", host: "100.1.2.3:4337" }), false);
	assert.equal(fromAnotherSite({ origin: "http://100.1.2.3:4337", host: "127.0.0.1:4336", "x-forwarded-host": "100.1.2.3:4337" }), false, "through a proxy that says what was asked");
	assert.equal(bearerOf({ authorization: "Bearer abc" }), "abc");
	assert.equal(bearerOf({ authorization: "Basic abc" }), undefined);
	assert.equal(queryTokenOf("/ws?decks_token=xyz"), "xyz");
	assert.equal(queryTokenOf("/ws"), undefined);
});

test("no code is asked of this machine, a home network or the tailnet; one is of the internet, also through a proxy", () => {
	for (const ip of ["127.0.0.1", "::1", "::ffff:192.168.1.20", "10.0.0.5", "172.20.1.1", "100.73.31.55", "fd7a:115c:a1e0::1"]) assert.ok(isPrivateAddress(ip), ip);
	for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "", undefined]) assert.ok(!isPrivateAddress(ip), String(ip));
	assert.ok(fromPrivateNetwork("100.73.31.55", {}));
	assert.ok(fromPrivateNetwork("127.0.0.1", { "x-forwarded-for": "100.73.31.55" }), "the tailnet, through tailscale serve");
	assert.ok(!fromPrivateNetwork("127.0.0.1", { "x-forwarded-for": "203.0.113.9, 100.73.31.55" }), "the internet, through a funnel");
	assert.ok(!fromPrivateNetwork("203.0.113.9", {}));
});

test("pairing without a code: a web page must be on this machine, on the harness's own address or listed; no Origin keeps the private-network rule", () => {
	assert.ok(!pairWithoutCode("127.0.0.1", { origin: "https://evil.test" }));
	assert.ok(!pairWithoutCode("127.0.0.1", { origin: "null" }));
	assert.ok(pairWithoutCode("127.0.0.1", { origin: "http://127.0.0.1:5173" }));
	assert.ok(pairWithoutCode("100.73.31.55", { origin: "https://mac.tail1.ts.net", host: "mac.tail1.ts.net:8443" }));
	assert.ok(pairWithoutCode("127.0.0.1", { origin: "https://studio.test" }, { DECKS_STUDIO_ORIGINS: "https://studio.test" }));
	assert.ok(pairWithoutCode("192.168.1.20", {}), "the iOS app on the home network");
	assert.ok(!pairWithoutCode("203.0.113.9", {}), "the internet still needs a code");
});

test("the gate's open list: the doors and the Decks page and its files; no command, no file or picture of the deck", () => {
	for (const path of ["/api/hello", "/api/pair", "/api/login", "/api/web/relay"]) assert.ok(isDoor(path), path);
	for (const path of ["/api/studio/connect", "/api/v1/now", "/api/tokens", "/api/passes", "/api/tickets", "/api/harness", "/api/person-key"]) assert.ok(!isDoor(path), path);
	assert.ok(isPublic("GET", "/"));
	assert.ok(isPublic("GET", "/assets/index-abc.js"));
	assert.ok(isPublic("GET", "/api/lib/board.css"));
	assert.ok(isPublic("GET", "/api/sdk/decks.mjs"));
	assert.ok(!isPublic("POST", "/"));
	assert.ok(!isPublic("GET", "/api/deck"));
	assert.ok(!isPublic("GET", "/api/v1/events"));
	for (const path of ["/api/board/boards/a.html", "/api/thumb/boards/a.html", "/api/f/x.png", "/api/avatar/a1", "/api/stage-thumb/plan", "/c/abc123/api/board/boards/a.html"]) assert.ok(!isPublic("GET", path), path);
	// What the harness's own Chromium reads, on its own pass: reads alone.
	assert.ok(harnessReads("GET", "/api/board/boards/a.html"));
	assert.ok(harnessReads("GET", "/api/stage-pen/x"));
	assert.ok(!harnessReads("POST", "/api/board/boards/a.html"));
	assert.ok(!harnessReads("GET", "/api/agents/a1/history"));
	assert.ok(!harnessReads("GET", "/api/harness"));
});

test("a person's, an agent's or an app's token from another site's page is refused; a site's is not", () => {
	const { tokens } = store();
	const gate = { tokens };
	const person = tokens.issue({ kind: "person" }).token;
	const agent = tokens.issue({ kind: "agent", id: "a1" }).token;
	const site = tokens.issue({ kind: "site", origin: "https://studio.test", label: "Studio" }).token;
	const cross = { "sec-fetch-site": "cross-site", origin: "https://studio.test" };
	assert.deepEqual(verifyOn(gate, person, cross), { ok: false, reason: "kind" });
	assert.deepEqual(verifyOn(gate, agent, cross), { ok: false, reason: "kind" });
	assert.ok(verifyOn(gate, site, cross).ok);
	assert.ok(verifyOn(gate, person, { "sec-fetch-site": "same-origin" }).ok);
});

test("the socket takes the person's token or a site's, from its address or a header, and nothing else", () => {
	const { tokens } = store();
	const gate = { tokens };
	const person = tokens.issue({ kind: "person" }).token;
	const agent = tokens.issue({ kind: "agent", id: "a1" }).token;
	const request = (url: string, headers: Record<string, string> = {}) => ({ url, headers }) as unknown as import("node:http").IncomingMessage;
	assert.deepEqual(socketPrincipal(gate, request(`/ws?decks_token=${person}`)), { kind: "person" });
	assert.deepEqual(socketPrincipal(gate, request("/ws", { authorization: `Bearer ${person}` })), { kind: "person" });
	assert.equal(socketPrincipal(gate, request("/ws")), undefined, "no token, from this machine or not");
	assert.equal(socketPrincipal(gate, request(`/ws?decks_token=${agent}`)), undefined, "an agent has the verbs, not the person's socket");
	assert.equal(socketPrincipal(gate, request("/ws?decks_key=anything")), undefined, "the old person key is nothing");
});

test("a pass is good only while the token it was made with is", () => {
	const { tokens } = store();
	const site = tokens.issue({ kind: "site", label: "Studio" });
	const passes = new Passes({ live: (id) => tokens.live(id), role: () => "edit" });
	const { pass } = passes.canvas("main", "edit", site.id);
	assert.ok(passes.openCanvas(pass));
	const tab = passes.appTab("notes", site.id).pass;
	assert.ok(passes.openApp(tab));
	tokens.revoke(site.id);
	assert.equal(passes.openCanvas(pass), undefined);
	assert.equal(passes.openApp(tab), undefined);
});

test("only a tab of its own is a top-level navigation, and the page is given its token in a tag", () => {
	assert.ok(isTopNavigation({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }));
	assert.ok(!isTopNavigation({ "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }));
	assert.ok(!isTopNavigation({ "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }));
	assert.ok(!isTopNavigation({}));
	assert.equal(withSession("<html><head><title>x</title></head></html>", "dk_p_t"), '<html><head><meta name="decks-session" content="dk_p_t"><title>x</title></head></html>');
});

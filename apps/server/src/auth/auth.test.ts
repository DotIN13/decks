import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bearerOf, fromAnotherSite, isDoor, isPageRead, isPublic, queryTokenOf, socketPrincipal, verifyOn } from "./guard.ts";
import { fromPrivateNetwork, isPrivateAddress, isTopNavigation, PairCodes, pairWithoutCode, withSession } from "./issue.ts";
import { Tickets } from "./tickets.ts";
import { BOARD_IDLE_MS, TAB_IDLE_MS, TokenStore, tokenDays } from "./tokens.ts";

const DAY = 86_400_000;

function store(name = "tokens.json", options: { days?: number; now?: number } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "decks-auth-"));
	return { dir, file: join(dir, ".decks", name), tokens: new TokenStore(join(dir, ".decks", name), options) };
}

test("a token says its kind in its prefix, is kept only as its hash, in a file only this user reads", () => {
	const { file, tokens } = store();
	const person = tokens.issue({ kind: "person" }, { label: "decks login" });
	const site = tokens.issue({ kind: "site", origin: "https://studio.test", label: "Decks Studio" });
	assert.match(person.token, /^dk_p_[\w-]{43}$/);
	assert.match(site.token, /^dk_s_/);
	assert.match(tokens.issue({ kind: "agent", id: "a1" }).token, /^dk_a_/);
	assert.match(tokens.issue({ kind: "app", name: "notes" }).token, /^dk_x_/);
	assert.match(tokens.issue({ kind: "board", path: "boards/a.html" }).token, /^dk_b_/);
	const text = readFileSync(file, "utf8");
	assert.ok(!text.includes(person.token) && !text.includes(site.token), "no token in the clear");
	assert.equal(statSync(file).mode & 0o777, 0o600);
	assert.throws(() => tokens.issue({ kind: "page", path: "/api/board/boards/a.html" }));
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

test("tokens slide: a person's and a site's last their days unused, a tab's and a board's a day, an agent's until taken back", () => {
	const t0 = Date.now();
	const { file, tokens } = store("tokens.json", { days: 30, now: t0 });
	const kept = tokens.issue({ kind: "site", label: "A" }, { now: t0 });
	const left = tokens.issue({ kind: "site", label: "B" }, { now: t0 });
	const tab = tokens.issue({ kind: "person" }, { idle: TAB_IDLE_MS, now: t0 });
	const board = tokens.issue({ kind: "board", path: "boards/a.html" }, { now: t0 });
	const agent = tokens.issue({ kind: "agent", id: "a1" }, { now: t0 });
	assert.ok(tokens.verify(kept.token, { now: t0 + 20 * DAY }).ok, "used on day 20");
	assert.ok(tokens.verify(kept.token, { now: t0 + 45 * DAY }).ok, "45 days in, 25 since it was last used");
	assert.deepEqual(tokens.verify(left.token, { now: t0 + 31 * DAY }), { ok: false, reason: "expired" });
	assert.deepEqual(tokens.verify(left.token, { now: t0 }), { ok: false, reason: "unknown" }, "and forgotten");
	assert.equal(TAB_IDLE_MS, DAY);
	assert.equal(BOARD_IDLE_MS, DAY);
	assert.ok(tokens.verify(tab.token, { now: t0 + 23 * 3_600_000 }).ok);
	assert.ok(!tokens.verify(tab.token, { now: t0 + 23 * 3_600_000 + DAY + 1 }).ok, "a tab's token left a day");
	assert.ok(tokens.verify(board.token, { now: t0 + 23 * 3_600_000 }).ok);
	assert.ok(!tokens.verify(board.token, { now: t0 + 23 * 3_600_000 + DAY + 1 }).ok);
	assert.ok(tokens.verify(agent.token, { now: t0 + 400 * DAY }).ok, "an agent's lives as long as its agent");
	assert.equal(tokenDays({}), 30);
	assert.equal(tokenDays({ DECKS_TOKEN_DAYS: "7" }), 7);
	assert.equal(tokenDays({ DECKS_TOKEN_DAYS: "nonsense" }), 30);
	// What is written down outlives the process; an agent's token is not written down.
	const again = new TokenStore(file, { days: 30, now: t0 + 45 * DAY });
	assert.ok(again.verify(kept.token, { now: t0 + 45 * DAY }).ok);
	assert.deepEqual(again.verify(agent.token), { ok: false, reason: "unknown" }, "an agent's token ends with the harness");
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

test("the pairing tokens from before become site tokens with the same id and site, and the old file is read once", () => {
	const dir = mkdtempSync(join(tmpdir(), "decks-migrate-"));
	const decks = join(dir, ".decks");
	const now = Date.now();
	// A token "studio-token" as the old store kept it: its sha256, an id from it, the site it was given to.
	const hash = createHash("sha256").update("studio-token").digest("hex");
	const stale = createHash("sha256").update("stale").digest("hex");
	mkdirSync(decks, { recursive: true });
	writeFileSync(
		join(decks, "pairing.json"),
		JSON.stringify({
			requireCode: true,
			tokens: [
				{ id: hash.slice(0, 10), hash, label: "Decks Studio", origin: "https://studio.test", at: now - DAY, last: now - DAY },
				{ id: stale.slice(0, 10), hash: stale, label: "Old", origin: "", at: now - 400 * DAY, last: now - 400 * DAY },
			],
		}),
	);
	const tokens = new TokenStore(join(decks, "tokens.json"));
	const seen = tokens.verify("studio-token", { origin: "https://studio.test" });
	assert.ok(seen.ok);
	assert.deepEqual(seen.principal, { kind: "site", label: "Decks Studio", origin: "https://studio.test" });
	assert.equal(seen.id, hash.slice(0, 10));
	assert.deepEqual(tokens.verify("studio-token", { origin: "https://evil.test" }), { ok: false, reason: "elsewhere" }, "still bound to its site");
	assert.ok(!tokens.verify("stale").ok, "one unused past its days is not brought over");
	assert.ok(tokens.requireCode, "the code asked for in Settings is still asked for");
	assert.equal(tokens.paired().length, 1);
	assert.ok(existsSync(join(decks, "pairing.json")), "the old file is left where it was");
	// Taken back after the move, it stays taken back: the old file is not read again.
	tokens.revoke(hash.slice(0, 10));
	assert.ok(!new TokenStore(join(decks, "tokens.json")).verify("studio-token").ok);
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

test("the gate's open list: the doors, the Decks page and its files, and for now the pages a frame loads; no command", () => {
	for (const path of ["/api/hello", "/api/pair", "/api/studio/connect", "/api/login", "/api/web/relay"]) assert.ok(isDoor(path), path);
	for (const path of ["/api/v1/now", "/api/tokens", "/api/tickets", "/api/harness", "/api/person-key"]) assert.ok(!isDoor(path), path);
	assert.ok(isPublic("GET", "/"));
	assert.ok(isPublic("GET", "/assets/index-abc.js"));
	assert.ok(isPublic("GET", "/api/lib/board.css"));
	assert.ok(isPublic("GET", "/api/sdk/decks.mjs"));
	assert.ok(!isPublic("POST", "/"));
	assert.ok(!isPublic("GET", "/api/deck"));
	assert.ok(!isPublic("GET", "/api/v1/events"));
	assert.ok(isPageRead("GET", "/api/board/boards/a.html"));
	assert.ok(isPageRead("GET", "/c/abc123/api/board/boards/a.html"));
	assert.ok(isPageRead("GET", "/api/thumb/boards/a.html"));
	assert.ok(isPageRead("GET", "/api/apps/notes/seen"));
	assert.ok(!isPageRead("POST", "/api/board/boards/a.html"));
	assert.ok(!isPageRead("GET", "/api/agents/a1/history"));
	assert.ok(!isPageRead("GET", "/api/harness"));
	assert.ok(!isPageRead("GET", "/api/stage-pen/x"), "shot.html reads a stage with a ticket");
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

test("a ticket is good only while the token it was made with is", () => {
	const { tokens } = store();
	const site = tokens.issue({ kind: "site", label: "Studio" });
	const tickets = new Tickets((id) => tokens.live(id));
	const ticket = tickets.make("/api/board/boards/a.html", site.id);
	assert.ok(tickets.admits(ticket, "/api/board/boards/a.html"));
	tokens.revoke(site.id);
	assert.ok(!tickets.admits(ticket, "/api/board/boards/a.html"));
});

test("only a tab of its own is a top-level navigation, and the page is given its token in a tag", () => {
	assert.ok(isTopNavigation({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }));
	assert.ok(!isTopNavigation({ "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }));
	assert.ok(!isTopNavigation({ "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }));
	assert.ok(!isTopNavigation({}));
	assert.equal(withSession("<html><head><title>x</title></head></html>", "dk_p_t"), '<html><head><meta name="decks-session" content="dk_p_t"><title>x</title></head></html>');
});

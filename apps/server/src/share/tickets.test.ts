import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pairing } from "./pairing.ts";
import { covers, TICKET_MS, ticketPath, Tickets } from "./tickets.ts";

/** A pairing store in a fresh folder, a token in it, and tickets that ask it whether the token still works. */
function setUp() {
	const dir = mkdtempSync(join(tmpdir(), "decks-tickets-"));
	const pairing = new Pairing(join(dir, "pairing.json"));
	const token = pairing.grant("https://studio.test", "Decks Studio");
	const id = pairing.idOf(token)!;
	const tickets = new Tickets((one) => pairing.live(one));
	return { pairing, token, id, tickets, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a ticket admits the one board page it was made for, and no other path", () => {
	const { id, tickets, cleanup } = setUp();
	try {
		const ticket = tickets.make("/api/board/boards/a.html", id);
		assert.ok(tickets.admits(ticket, "/api/board/boards/a.html"));
		assert.ok(!tickets.admits(ticket, "/api/board/boards/b.html"), "another board");
		assert.ok(!tickets.admits(ticket, "/api/board/boards/a.html/x"), "a path under it");
		assert.ok(!tickets.admits(ticket, "/api/v1/agent.list"), "the API");
		assert.ok(!tickets.admits(undefined, "/api/board/boards/a.html"), "no ticket");
	} finally {
		cleanup();
	}
});

test("an app's ticket admits everything inside that app, and nothing in another", () => {
	const { id, tickets, cleanup } = setUp();
	try {
		const ticket = tickets.make("/app/todo/", id);
		assert.ok(tickets.admits(ticket, "/app/todo/"));
		assert.ok(tickets.admits(ticket, "/app/todo"), "the bare name, which is redirected with its ticket");
		assert.ok(tickets.admits(ticket, "/app/todo/index.html"));
		assert.ok(!tickets.admits(ticket, "/app/todo2/"), "an app whose name starts the same");
		assert.ok(!tickets.admits(ticket, "/app/other/"));
	} finally {
		cleanup();
	}
});

test("a ticket runs out after five minutes", () => {
	const { id, tickets, cleanup } = setUp();
	try {
		const now = Date.now();
		const ticket = tickets.make("/api/board/boards/a.html", id, now);
		assert.ok(tickets.admits(ticket, "/api/board/boards/a.html", now + TICKET_MS - 1));
		assert.ok(!tickets.admits(ticket, "/api/board/boards/a.html", now + TICKET_MS));
	} finally {
		cleanup();
	}
});

test("a ticket that was changed, or made by another server, is refused", () => {
	const { id, tickets, cleanup } = setUp();
	try {
		const ticket = tickets.make("/api/board/boards/a.html", id);
		const [payload, mac] = ticket.split(".") as [string, string];
		// The same mac on a payload for another path.
		const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), p: "/api/board/boards/b.html" })).toString("base64url");
		assert.ok(!tickets.admits(`${other}.${mac}`, "/api/board/boards/b.html"), "a payload for another path");
		const longer = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), e: Date.now() + 86_400_000 })).toString("base64url");
		assert.ok(!tickets.admits(`${longer}.${mac}`, "/api/board/boards/a.html"), "a later expiry");
		assert.ok(!tickets.admits(`${payload}.${mac.slice(0, -2)}AA`, "/api/board/boards/a.html"), "a changed mac");
		assert.ok(!tickets.admits(`${payload}.`, "/api/board/boards/a.html"), "no mac");
		assert.ok(!tickets.admits("nonsense", "/api/board/boards/a.html"));
		const elsewhere = new Tickets(() => true);
		assert.ok(!elsewhere.admits(ticket, "/api/board/boards/a.html"), "another server's secret");
	} finally {
		cleanup();
	}
});

test("revoking the token a ticket was made with ends the ticket", () => {
	const { pairing, id, tickets, cleanup } = setUp();
	try {
		const ticket = tickets.make("/api/board/boards/a.html", id);
		assert.ok(tickets.admits(ticket, "/api/board/boards/a.html"));
		pairing.revoke(id);
		assert.ok(!tickets.admits(ticket, "/api/board/boards/a.html"));
	} finally {
		cleanup();
	}
});

test("tickets are only for board pages, files and apps, named by their request path or the board's deck path", () => {
	assert.equal(ticketPath("boards/a.html"), "/api/board/boards/a.html");
	assert.equal(ticketPath("/api/board/boards/my board.html"), "/api/board/boards/my board.html");
	assert.equal(ticketPath("/app/todo"), "/app/todo/");
	assert.equal(ticketPath("/app/todo/api/items"), "/app/todo/");
	assert.equal(ticketPath("/api/f/Users/me/decks/exports/a.png"), "/api/f/Users/me/decks/exports/a.png");
	assert.equal(ticketPath("/api/v1/agent.list"), undefined);
	assert.equal(ticketPath("/api/board/boards/../x.html"), undefined);
	assert.equal(ticketPath("/api/board/boards/a.html?x=1"), undefined);
	assert.ok(covers("/api/board/boards/a.html", "/api/board/boards/a.html"));
});

test("a token is refused from a page on a site other than the one it was given to", () => {
	const { pairing, token, cleanup } = setUp();
	try {
		assert.equal(pairing.verdict(token, "https://studio.test"), "paired");
		assert.equal(pairing.verdict(token, undefined), "paired", "a program, which sends no Origin");
		assert.equal(pairing.verdict(token, "https://evil.test"), "elsewhere");
		assert.equal(pairing.verdict(token, "null"), "elsewhere", "a sandboxed page");
		assert.equal(pairing.verdict("not-a-token", "https://studio.test"), "unpaired");
		const anywhere = pairing.grant("", "A program");
		assert.equal(pairing.verdict(anywhere, "https://evil.test"), "paired", "a token given with no site recorded keeps working as before");
	} finally {
		cleanup();
	}
});

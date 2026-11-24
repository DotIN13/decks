import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLAUDE_PATH_ENV } from "./available.ts";
import { ClaudeLogin } from "./login.ts";

/*
 * Signing in to Claude is the harness's, driven by the page's modal: the link from the CLI's own
 * `auth login`, the code written to its stdin, its exit code the answer, and the account remembered
 * under the identity `auth status` reports. A stand-in `claude` plays the CLI: it prints a link,
 * takes "good" as the code (writing a credentials file) and refuses anything else as the CLI does.
 */
function fakeClaude(): string {
	const dir = mkdtempSync(join(tmpdir(), "decks-fake-claude-"));
	const bin = join(dir, "claude");
	writeFileSync(
		bin,
		`#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const home = process.env.CLAUDE_CONFIG_DIR;
const args = process.argv.slice(2).join(" ");
if (args === "auth status") {
	const signed = fs.existsSync(path.join(home, "creds"));
	console.log(JSON.stringify(signed ? { loggedIn: true, email: "ada@example.com", subscriptionType: "max" } : { loggedIn: false }));
	process.exit(0);
}
if (args.startsWith("auth login")) {
	console.log("Opening browser to sign in…");
	console.log("https://claude.ai/oauth/authorize?code=true&client_id=x" + (args.includes("--console") ? "&console=1" : ""));
	process.stdout.write("Paste code here if prompted > ");
	process.stdin.once("data", (d) => {
		if (String(d).trim() === "good") { fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, "creds"), "x"); process.exit(0); }
		console.error("Login failed: Request failed with status code 400");
		process.exit(1);
	});
}
`,
	);
	chmodSync(bin, 0o755);
	return bin;
}

function accounts() {
	const root = mkdtempSync(join(tmpdir(), "decks-accounts-"));
	const remembered: { id: string; email?: string; kind: string }[] = [];
	let n = 0;
	return {
		remembered,
		begin: () => {
			const id = `a${++n}`;
			const configDir = join(root, id);
			mkdirSync(configDir, { recursive: true });
			return { id, configDir };
		},
		remember: (account: { id: string; email?: string; kind: "subscription" | "api" }) => (remembered.push(account), { ...(account.email ? { email: account.email } : {}) }),
	};
}

test("a sign-in answers the CLI's link, a wrong code is Claude's own refusal, and the right one remembers the account and says so", async () => {
	const before = process.env[CLAUDE_PATH_ENV];
	process.env[CLAUDE_PATH_ENV] = fakeClaude();
	const list = accounts();
	let landed = 0;
	const login = new ClaudeLogin(list, () => landed++, () => {});
	try {
		const first = await login.start("api");
		assert.match(first.url, /^https:\/\/claude\.ai\/oauth\/authorize\?.*console=1$/);
		await assert.rejects(login.finish("bad"), /Login failed: Request failed with status code 400/);
		assert.equal(landed, 0);
		await assert.rejects(login.finish("good"), /No sign-in is under way/, "a refused sign-in is over");
		await login.start("subscription");
		assert.deepEqual(await login.finish("good"), { email: "ada@example.com" });
		assert.equal(landed, 1, "every Claude agent is told, to read its models anew");
		assert.deepEqual(list.remembered.map((a) => [a.email, a.kind]), [["ada@example.com", "subscription"]]);
	} finally {
		login.cancel();
		if (before === undefined) delete process.env[CLAUDE_PATH_ENV];
		else process.env[CLAUDE_PATH_ENV] = before;
	}
});

test("a sign-in can be stopped, and one started stops the one before", async () => {
	const before = process.env[CLAUDE_PATH_ENV];
	process.env[CLAUDE_PATH_ENV] = fakeClaude();
	const login = new ClaudeLogin(accounts(), () => {}, () => {});
	try {
		await login.start("subscription");
		login.cancel();
		await assert.rejects(login.finish("good"), /No sign-in is under way/);
		await login.start("subscription");
		await login.start("api");
		assert.ok(existsSync(process.env[CLAUDE_PATH_ENV]!));
	} finally {
		login.cancel();
		if (before === undefined) delete process.env[CLAUDE_PATH_ENV];
		else process.env[CLAUDE_PATH_ENV] = before;
	}
});

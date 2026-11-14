import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientFor } from "../sdk/index.ts";
import { fakeServer, type Fake } from "../sdk/testing/fake-server.ts";
import { attach, detach } from "./index.ts";

// decks attach writes what the tool needs and decks detach leaves the folder
// exactly as it was, files that were already there included.

let fake: Fake;
const agent = { id: "a7", name: "Wren", color: "#3b6fd8", tags: [], token: "agent-token", canvas: "wren" };
before(async () => {
	fake = await fakeServer(4608, { "agent.attach": (args) => ({ ...agent, kind: args.kind }), "agent.delete": () => ({ deleted: "a7" }) });
});
after(() => fake.close());

/** Every file under a folder with its text, to compare before and after. */
function snapshot(dir: string, base = dir): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) Object.assign(out, snapshot(full, base), { [`${full.slice(base.length)}/`]: "" });
		else out[full.slice(base.length)] = readFileSync(full, "utf8");
	}
	return out;
}

test("attach --tool claude writes the command, the skill and the hook; detach removes them all", async () => {
	const dir = mkdtempSync(`${tmpdir()}/decks-attach-`);
	try {
		writeFileSync(join(dir, "notes.md"), "mine\n");
		const before = snapshot(dir);
		const client = clientFor(fake.url, fake.token);
		const said = await attach(["--tool", "claude", "--as", "Wren", "--dir", dir], client);
		assert.match(said, /Wren is attached here as a claude agent/);
		assert.deepEqual(fake.calls.at(-1)?.args, { kind: "claude", name: "Wren" });
		const settings = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
		assert.equal(settings.env.DECKS_TOKEN, "agent-token");
		assert.equal(settings.hooks.UserPromptSubmit[0].hooks[0].command, ".claude/decks agent news");
		assert.match(readFileSync(join(dir, ".claude/skills/decks/SKILL.md"), "utf8"), /^---\nname: decks/);
		const help = execFileSync(join(dir, ".claude/decks"), ["help", "item", "move"], { encoding: "utf8" });
		assert.match(help, /^decks item move/);
		await assert.rejects(attach(["--dir", dir], client), /already attached/);
		assert.match(await detach(["--dir", dir], client), /agent removed/);
		assert.deepEqual(snapshot(dir), before);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("a settings file already there is merged, and restored word for word on detach", async () => {
	const dir = mkdtempSync(`${tmpdir()}/decks-attach-`);
	try {
		mkdirSync(join(dir, ".claude"));
		const mine = '{ "permissions": { "allow": ["Bash(ls)"] } }\n';
		writeFileSync(join(dir, ".claude/settings.local.json"), mine);
		const before = snapshot(dir);
		const client = clientFor(fake.url, fake.token);
		await attach(["--dir", dir], client);
		const merged = JSON.parse(readFileSync(join(dir, ".claude/settings.local.json"), "utf8"));
		assert.deepEqual(merged.permissions, { allow: ["Bash(ls)"] });
		await detach(["--dir", dir], client);
		assert.deepEqual(snapshot(dir), before);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("codex and opencode get their own files, and detach clears them too", async () => {
	for (const tool of ["codex", "opencode"]) {
		const dir = mkdtempSync(`${tmpdir()}/decks-attach-`);
		try {
			const client = clientFor(fake.url, fake.token);
			await attach(["--tool", tool, "--dir", dir], client);
			assert.ok(readdirSync(dir, { recursive: true }).some((f) => String(f).endsWith("SKILL.md")), tool);
			await detach(["--dir", dir], client);
			assert.deepEqual(readdirSync(dir), [], tool);
		} finally {
			rmSync(dir, { recursive: true });
		}
	}
});

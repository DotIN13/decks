// opencode agents share one server: each session's token is a file the harness writes, and the
// Google Docs tools and the decks command read it. A call reaches the server as that agent.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeServer } from "@decks/sdk/testing";
import { gdocs, sessionToken } from "../../prompts/shims/decks-call.ts";
import { opencodeConfigDir, opencode2PluginDir } from "../../prompts/paths.ts";
import { sessionTokenFiles } from "../shared/session-tokens.ts";

test("opencode's tool folder holds gdocs_read and gdocs_edit, and OpenCode 2's plugin registers them", () => {
	assert.ok(existsSync(join(opencodeConfigDir(), "tools", "gdocs_read.ts")));
	assert.ok(existsSync(join(opencodeConfigDir(), "tools", "gdocs_edit.ts")));
	const plugin = readFileSync(join(opencode2PluginDir(), "server.ts"), "utf8");
	assert.match(plugin, /gdocs-tools\.json/, "OpenCode 2 registers the same words");
	assert.match(plugin, /callGdocs\(spec\.name, input, context\.sessionID\)/, "and calls through the shared helper, as the session's agent");
	assert.match(plugin, /sessionToken\(session\)/, "and gives a command its agent's token");
});

test("a session's token is written for its agent alone, and a Google Docs call goes as that agent", async () => {
	const dir = join(mkdtempSync(join(tmpdir(), "helm-")), "sessions");
	const fake = await fakeServer(4675, { "google.read": (args) => ({ doc: String(args.doc), text: "Hello" }) });
	const was = { url: process.env.DECKS_URL, dir: process.env.DECKS_OPENCODE_SESSIONS };
	try {
		const tokens = sessionTokenFiles(fake.token, dir);
		tokens.registerSession("ses_1", "a1");
		assert.equal(statSync(join(dir, "ses_1")).mode & 0o777, 0o600, "readable by this user alone");
		assert.equal(sessionToken("ses_1", dir), fake.token);
		assert.equal(sessionToken("../escape", dir), undefined);
		Object.assign(process.env, { DECKS_URL: fake.url, DECKS_OPENCODE_SESSIONS: dir });
		assert.match(await gdocs("gdocs_read", { doc: "doc-1" }, "ses_1"), /Google Doc doc-1/);
		assert.deepEqual(fake.calls.at(-1), { name: "google.read", args: { doc: "doc-1" }, token: fake.token });
		tokens.unregisterSession("ses_1");
		await assert.rejects(gdocs("gdocs_read", { doc: "doc-1" }, "ses_1"), /not started by the Decks harness/);
	} finally {
		process.env.DECKS_URL = was.url ?? "";
		process.env.DECKS_OPENCODE_SESSIONS = was.dir ?? "";
		await fake.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

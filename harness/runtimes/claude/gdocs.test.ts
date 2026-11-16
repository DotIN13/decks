// A Claude agent's Google Docs tools: named on its in-process MCP server, and a call reaches the server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeServer } from "@decks/sdk/testing";
import { gdocsCaller } from "../shared/gdocs.ts";
import { decksMcpServer, gdocsToolNames } from "./tools.ts";

test("Claude gets gdocs_read and gdocs_edit, pre-approved, and an edit reaches the server as google.edit", async () => {
	assert.deepEqual(gdocsToolNames(), ["mcp__decks__gdocs_read", "mcp__decks__gdocs_edit"]);
	const fake = await fakeServer(4674, { "google.edit": (args) => ({ doc: String(args.doc), text: "after" }) });
	try {
		const call = gdocsCaller({ url: fake.url, token: fake.token });
		assert.equal(decksMcpServer(call).name, "decks");
		const out = await call("gdocs_edit", { doc: "doc-1", old: "before", new: "after" });
		assert.equal(out.isError, false, out.text);
		assert.deepEqual(fake.calls.at(-1), { name: "google.edit", args: { doc: "doc-1", old: "before", new: "after" }, token: fake.token });
		const refused = await gdocsCaller({ url: fake.url, token: "nobody" })("gdocs_read", { doc: "doc-1" });
		assert.equal(refused.isError, true, "a refusal reads as a failed tool call");
	} finally {
		await fake.close();
	}
});

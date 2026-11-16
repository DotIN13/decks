// A Pi agent's Google Docs tools: registered on its session, and a call reaches the server as google.read.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeServer } from "@decks/sdk/testing";
import { gdocsCaller } from "../shared/gdocs.ts";
import { decksTools } from "./extension.ts";

test("Pi gets gdocs_read and gdocs_edit, and a read reaches the server as google.read with the agent's token", async () => {
	const fake = await fakeServer(4673, { "google.read": (args) => ({ doc: String(args.doc), title: "Plan", text: "Hello" }) });
	try {
		const tools = new Map<string, { execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }> }> }>();
		const pi = { registerTool: (tool: { name: string; execute: never }) => tools.set(tool.name, tool), on: () => {} };
		(decksTools({ gdocs: gdocsCaller({ url: fake.url, token: fake.token }) }) as unknown as { factory: (pi: never) => void }).factory(pi as never);
		assert.ok(tools.has("gdocs_read") && tools.has("gdocs_edit"), [...tools.keys()].join(", "));
		const out = await tools.get("gdocs_read")!.execute("call-1", { doc: "doc-1" });
		assert.match(out.content[0]!.text, /# Plan \(Google Doc doc-1\)\n\nHello/);
		assert.deepEqual(fake.calls.at(-1), { name: "google.read", args: { doc: "doc-1" }, token: fake.token });
	} finally {
		await fake.close();
	}
});

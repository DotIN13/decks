import assert from "node:assert/strict";
import { test } from "node:test";
import { identityReminder, specOf } from "./identity.ts";
import { brief, newsLines } from "./tools.ts";

test("a spec keeps what agent.requested gave and refuses a kind this harness does not run", () => {
	assert.deepEqual(specOf({ id: "a1", name: "Ada", kind: "pi", token: "t", canvas: "plan", adopted: true }, "a1"), { id: "a1", name: "Ada", kind: "pi", canvas: "plan", token: "t" });
	assert.throws(() => specOf({ kind: "codex" }, "x"), /does not run codex/);
});

test("the reminder lasts until the agent has said who it is", () => {
	assert.match(identityReminder({ name: "Agent 3", tags: [] })!, /--name/);
	assert.match(identityReminder({ name: "Ada", avatar: "<svg/>", workspace: "w", tags: [] })!, /tags are empty/);
	assert.equal(identityReminder({ name: "Ada", avatar: "<svg/>", workspace: "w", tags: ["x"] }), undefined);
});

test("news groups what others changed, and says nothing when nothing did", () => {
	assert.equal(newsLines({ changes: [] }), undefined);
	const text = newsLines({ changes: [{ canvas: "plan", ids: ["n1"], by: "person", event: "item.changed" }, { canvas: "plan", ids: ["n2"], by: "person", event: "item.changed" }] })!;
	assert.match(text, /item\.changed on plan by person \(2 times\): n1, n2/);
});

test("a hand-off says who it is from and names its cards", () => {
	const text = brief("Ada", "Check the numbers.", ["canvases/a/cards/x/index.html"], true);
	assert.match(text, /^Ada sent you this, to act on now:/);
	assert.match(text, /- canvases\/a\/cards\/x\/index\.html/);
});

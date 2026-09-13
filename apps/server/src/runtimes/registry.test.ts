import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_KINDS } from "@decks/protocol";
import { RUNTIMES, runtimeList, runtimeOf } from "./registry.ts";

/**
 * The registry, and the two ways it can silently disagree with the protocol.
 *
 * This test exists because the seam it guards is the one that used to be *four* tables in
 * `agents/session.ts` — a class, a capability set and a command list per runtime, plus the
 * union in `packages/protocol`. Four places to add a runtime, and nothing that noticed one
 * being missed: a kind with no `CAPABILITIES` entry was a lookup that returned `undefined`
 * and a row drawn without a mode control.
 *
 * A descriptor per runtime makes that a compile error, and what is left for a test is the
 * part the compiler cannot see — that a descriptor's `kind` field is the key it is filed
 * under, and that an unavailable runtime always explains itself.
 */

test("every kind in the protocol has a descriptor, and no others", () => {
	assert.deepEqual(Object.keys(RUNTIMES).sort(), [...AGENT_KINDS].sort());
});

test("a descriptor's kind matches the key it is filed under", () => {
	// A copy-paste that matters: `claude: { kind: "pi", … }` compiles, and sends every
	// Claude agent to Pi's backend through a table that looks right.
	for (const kind of AGENT_KINDS) assert.equal(runtimeOf(kind).kind, kind, kind);
});

test("a runtime is named for people as well as for the protocol", () => {
	for (const kind of AGENT_KINDS) {
		const runtime = runtimeOf(kind);
		assert.ok(runtime.label.length > 0, `${kind} has no label`);
	}
	// Three of the four are named differently from their id, and the exception is real:
	// opencode's product name is lower case, so `label` matching `kind` there is the
	// correct answer rather than a missing one. The menu reads "New Claude Code agent"
	// where it used to read "New claude agent".
	assert.equal(runtimeOf("claude").label, "Claude Code");
	assert.equal(runtimeOf("pi").label, "Pi");
	assert.equal(runtimeOf("antigravity").label, "Antigravity");
});

test("an unavailable runtime always says why, and an available one does not", () => {
	for (const info of runtimeList()) {
		if (info.available) assert.equal(info.reason, undefined, `${info.kind} is available but explains a failure`);
		else assert.ok((info.reason ?? "").length > 10, `${info.kind} is unavailable without a sentence to act on`);
	}
});

test("the list is in the protocol's order, one row per kind", () => {
	assert.deepEqual(
		runtimeList().map((info) => info.kind),
		[...AGENT_KINDS],
	);
});

test("asking twice gives the same answer", () => {
	// The greeting calls this on every connect, and `availability()` is a PATH lookup:
	// stable answers are what make a disabled row honest rather than a coin toss.
	assert.deepEqual(runtimeList(), runtimeList());
});

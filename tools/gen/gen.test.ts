import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CALLS, EVENTS } from "../../protocol/index.ts";
import { stale, write, GENERATORS } from "./index.ts";
import { ROOT } from "./paths.ts";
import { oldNames, problemsIn } from "./table.ts";

// The generators write what the protocol declares, the check mode sees a
// stale file, the outputs compile, and the table check names a broken row.

const scratch = () => mkdtempSync(`${tmpdir()}/decks-gen-`);

test("check mode passes after a write, and names a missing or changed file", () => {
	const dir = scratch();
	try {
		assert.ok(stale(dir).every((line) => line.includes("missing")));
		write(dir);
		assert.deepEqual(stale(dir), []);
		writeFileSync(`${dir}/reference.md`, "old");
		assert.deepEqual(stale(dir), ["reference.md is out of date (reference)"]);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("every call is in the SDK's types, and every agent's server call in the MCP list", () => {
	const files = { ...GENERATORS.sdk!(), ...GENERATORS.mcp!() };
	for (const call of CALLS) assert.ok(files["sdk/types.ts"]!.includes(JSON.stringify(call.name)), call.name);
	for (const event of EVENTS) assert.ok(files["sdk/types.ts"]!.includes(JSON.stringify(event.name)), event.name);
	const tools = JSON.parse(files["mcp/tools.json"]!) as { name: string }[];
	const wanted = CALLS.filter((c) => c.side === "server" && c.who.includes("agent")).map((c) => c.name);
	assert.deepEqual(tools.map((t) => t.name), wanted);
});

test("the SDK's types compile, and the Swift files pass swiftc -typecheck", () => {
	const dir = scratch();
	try {
		write(dir);
		execFileSync(`${ROOT}/node_modules/.bin/tsc`, ["--noEmit", "--strict", "--target", "es2023", "--module", "nodenext", `${dir}/sdk/types.ts`]);
		const swift = spawnSync("swiftc", ["-typecheck", "Shapes.swift", "Calls.swift", "Events.swift"], { cwd: `${dir}/swift`, encoding: "utf8" });
		if (swift.error) return console.log("swiftc is not here; Swift not checked");
		assert.equal(swift.status, 0, swift.stderr);
	} finally {
		rmSync(dir, { recursive: true });
	}
});

test("the table check passes calls.md, and names a row taken out", async () => {
	const text = readFileSync(`${ROOT}/docs/rewrite/calls.md`, "utf8");
	const old = await oldNames();
	assert.deepEqual(problemsIn(text, old), []);
	const broken = text.split("\n").filter((line) => !line.startsWith("| `canvas.read`")).join("\n");
	assert.deepEqual(problemsIn(broken, old), ["agents canvas.read appears 0 times, not once.", "item.list is declared but not in the table."]);
});

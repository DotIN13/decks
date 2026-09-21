import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runtimeDir } from "@decks/runtime";
import { Deck } from "../deck/loader.ts";
import { StageService } from "./service.ts";
import { createStageTool } from "./tool.ts";

/**
 * The two copies of the stage API agree.
 *
 * The contract an agent reads is `runtime/stage.d.ts`; the object it runs against is
 * built by `apps/server/src/stage/tool.ts`. Nothing in the repo compared them — a
 * method added to one and not the other was a compile error in one workspace and a
 * promise nobody kept in the other. This test reads the declaration's method names
 * and asserts each exists on a built tool, so the next addition to either side has
 * to land in both.
 *
 * It cannot check signatures — types are gone at run time — and it does not try to.
 * A name in both places is the failure that was silent before, and a signature
 * mismatch is a compile error already.
 */
test("every method in runtime/stage.d.ts exists on the built stage tool", () => {
	const path = join(runtimeDir(), "stage.d.ts");
	const source = readFileSync(path, "utf8");
	const { methods, nested } = stageMethods(source);
	assert.ok(methods.length > 10, `expected the Stage interface to declare methods, found ${methods.length}`);

	const tool = builtStageTool();
	const stage = tool.stage as unknown as Record<string, unknown>;
	const missing = methods.filter((name) => typeof stage[name] !== "function");
	assert.deepEqual(missing, [], `declared in stage.d.ts but missing on the built stage object: ${missing.join(", ")}`);

	// The nested members are the other half of the same promise: `me.setTags` must
	// exist where `me` is, and `web.read` where `web` is.
	const missingNested = nested.filter(([owner, name]) => {
		const object = stage[owner] as Record<string, unknown> | undefined;
		return typeof object?.[name] !== "function";
	});
	assert.deepEqual(missingNested, [], `declared under a nested object in stage.d.ts but missing on the built stage object: ${missingNested.map(([owner, name]) => `${owner}.${name}`).join(", ")}`);
});

/**
 * The names of the Stage interface's methods, and its nested objects' members.
 *
 * The interface is declaration-only, so every member is a signature: a line at the
 * interface's depth that starts with a name and an open paren. Anchored to exactly
 * one tab (the interface's own members) and two tabs (the members of `me` and `web`),
 * so a call inside a doc comment or a parameter block — always deeper — cannot
 * masquerade as a method. The nested members are returned as `[owner, name]` pairs,
 * since `me.setName` is not a method of the stage object itself.
 */
function stageMethods(source: string): { methods: string[]; nested: Array<[string, string]> } {
	const start = source.indexOf("export interface Stage {");
	assert.ok(start >= 0, "runtime/stage.d.ts must declare the Stage interface");
	let depth = 0;
	let end = start;
	for (let index = start; index < source.length; index++) {
		if (source[index] === "{") depth += 1;
		else if (source[index] === "}") {
			depth -= 1;
			if (depth === 0) {
				end = index;
				break;
			}
		}
	}
	const body = source.slice(start, end + 1);
	const methods: string[] = [];
	const nested: Array<[string, string]> = [];
	for (const match of body.matchAll(/^\t(\w+)\s*\(/gm)) methods.push(match[1]!);
	// Which nested object a two-tab member belongs to — the nearest one-tab owner above it.
	let owner = "";
	for (const line of body.split("\n")) {
		const own = /^\t(\w+):\s*{/.exec(line);
		if (own) owner = own[1]!;
		const member = /^\t\t(\w+)\s*\(/.exec(line);
		if (member && owner) nested.push([owner!, member[1]!]);
	}
	return { methods: [...new Set(methods)], nested };
}

/** A stage tool with just enough wiring to exist — the same fixture `tool.test.ts` builds. */
function builtStageTool() {
	const root = mkdtempSync(join(tmpdir(), "decks-decl-"));
	try {
		mkdirSync(join(root, "boards"), { recursive: true });
		writeFileSync(join(root, "boards", "plan.html"), `<!doctype html><title>plan</title><body class="board"></body>`);
		const deck = Deck.open(root);
		const service = new StageService(deck, {
			newMirror: () => "boards/mirrors/x.html",
			newBoard: (options) => `boards/${(options.title ?? "x").toLowerCase().replace(/\W+/g, "-")}.html`,
			writeBoard: (path, html) => {
				writeFileSync(join(root, path), html);
				return deck.refresh(path)!;
			},
			extent: () => undefined,
			awaitExtent: async () => undefined,
			call: async () => ({ ok: true }),
			connected: () => true,
			place: () => undefined,
			broadcast: () => {},
			camera: () => ({ x: 0, y: 0, zoom: 1 }),
			agents: () => [],
		});
		return createStageTool({
			stage: service,
			port: 4329,
			agent: {
				id: "a1",
				identity: () => ({ name: "Ada", color: "#000" }),
				context: () => [],
				setContext: () => {},
				inPlay: () => [],
				setInPlay: () => {},
				rename: () => {},
				setAvatar: () => {},
				setTags: (tags) => tags as string[],
				setWorkspace: () => null,
				agents: () => [],
				camera: () => ({ x: 0, y: 0, zoom: 1 }),
				send: () => ({ queued: true, position: 1 }),
				queue: () => [],
				recordRevision: () => undefined,
				boardPathOf: () => undefined,
			},
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
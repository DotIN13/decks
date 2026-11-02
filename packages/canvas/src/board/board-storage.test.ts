import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHARED_SANDBOX as BOARD_SANDBOX } from "./board-storage.ts";
import { attachBoardStorage, boardStorageKey, storageHash, storageKeeper, type BoardItems } from "./board-storage.ts";

/** The page around a board keeping its storage: per canvas and board, from that frame's window alone. */

function memory() {
	const map = new Map<string, string>();
	return { map, store: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) } };
}

function page() {
	const listeners = new Set<(event: MessageEvent) => void>();
	const view = { addEventListener: (_t: string, l: (event: MessageEvent) => void) => listeners.add(l), removeEventListener: (_t: string, l: (event: MessageEvent) => void) => listeners.delete(l) };
	const frame = () => {
		const posted: Array<{ message: Record<string, unknown>; origin: string }> = [];
		const contentWindow = { postMessage: (message: Record<string, unknown>, origin: string) => posted.push({ message, origin }) };
		const element = { ownerDocument: { defaultView: view, baseURI: "http://127.0.0.1:4830/" }, contentWindow, getAttribute: (name: string) => (name === "src" ? "/api/t/a.b/board/shared/canvases/ada/plan/boards/a.html" : name === "sandbox" ? BOARD_SANDBOX : null) };
		return { element: element as unknown as HTMLIFrameElement, window: contentWindow, posted };
	};
	const say = (source: unknown, data: unknown, origin = "null") => {
		for (const listener of [...listeners]) listener({ source, data, origin } as MessageEvent);
	};
	return { view, frame, say, listening: () => listeners.size };
}

describe("board storage", () => {
	it("keeps what a board writes, under its own canvas and board, and answers it when it asks", () => {
		const m = memory();
		const keeper = storageKeeper(m.store, "decks.board-storage:");
		const p = page();
		const a = p.frame();
		const key = boardStorageKey("here", "launch", "boards/a.html");
		p.say(a.window, { decks: "storage.set", key: "count", value: "1" });
		attachBoardStorage(a.element, () => key, keeper, p.view as unknown as Window);
		p.say(a.window, { decks: "storage.set", key: "count", value: "2" });
		p.say(a.window, { decks: "storage.set", key: "name", value: "ü" });
		p.say(a.window, { decks: "storage.remove", key: "name" });
		assert.deepEqual(keeper.read(key), { count: "2" });
		assert.deepEqual(keeper.read(boardStorageKey("here", "other", "boards/a.html")), {}, "the same board on another canvas keeps its own");
		p.say(a.window, { decks: "storage.hello" });
		assert.deepEqual(a.posted, [{ message: { decks: "storage.snapshot", items: { count: "2" } }, origin: "*" }]);
		p.say(a.window, { decks: "storage.clear" });
		assert.equal(m.map.size, 0, "a board that keeps nothing leaves nothing behind");
	});

	it("hears a frame's own window only, with the blank origin its page has, so a sibling board cannot write another's storage", () => {
		const keeper = storageKeeper(memory().store, "k:");
		const p = page();
		const a = p.frame();
		const b = p.frame();
		attachBoardStorage(a.element, () => "a", keeper, p.view as unknown as Window);
		p.say(b.window, { decks: "storage.set", key: "x", value: "forged" });
		p.say(a.window, { decks: "storage.set", key: "x", value: "wrong origin" }, "http://127.0.0.1:4830");
		p.say({ postMessage() {} }, { decks: "storage.set", key: "x", value: "nobody" });
		assert.deepEqual(keeper.read("a"), {});
		p.say(b.window, { decks: "storage.hello" });
		assert.deepEqual(b.posted, [], "a sibling is told nothing of this board's storage");
	});

	it("keeps a megabyte a board at most, and stops listening when the frame goes", () => {
		const keeper = storageKeeper(memory().store, "k:");
		const p = page();
		const a = p.frame();
		const stop = attachBoardStorage(a.element, () => "a", keeper, p.view as unknown as Window);
		p.say(a.window, { decks: "storage.set", key: "big", value: "x".repeat(1_000_001) });
		assert.deepEqual(keeper.read("a"), {});
		stop();
		assert.equal(p.listening(), 0);
	});

	it("puts what a board has stored after the frame's address, and nothing for a board that keeps nothing", () => {
		assert.equal(storageHash({}), "");
		const items: BoardItems = { count: "3", "é": "ü" };
		const hash = storageHash(items);
		assert.match(hash, /^#decks-storage=[A-Za-z0-9_-]+$/);
		assert.deepEqual(JSON.parse(Buffer.from(hash.slice("#decks-storage=".length), "base64url").toString("utf8")), items);
	});

	it("reads nothing from a store it cannot parse", () => {
		const m = memory();
		m.map.set("k:a", "not json");
		assert.deepEqual(storageKeeper(m.store, "k:").read("a"), {});
		m.map.set("k:a", JSON.stringify({ ok: "1", bad: 2 }));
		assert.deepEqual(storageKeeper(m.store, "k:").read("a"), { ok: "1" });
	});
});

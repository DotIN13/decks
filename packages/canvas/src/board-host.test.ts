import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBoardHost, frameOrigin } from "./board-host.ts";

/** A page with frames, as much of the DOM as the host touches: its listeners, and what each frame was posted. */
function page(base = "http://127.0.0.1:4830/") {
	const listeners = new Set<(event: MessageEvent) => void>();
	const view = {
		addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
		removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
	};
	const frame = (src: string) => {
		const posted: Array<{ message: Record<string, unknown>; origin: string }> = [];
		const contentWindow = { postMessage: (message: Record<string, unknown>, origin: string) => posted.push({ message, origin }) };
		const element = { ownerDocument: { defaultView: view, baseURI: base }, contentWindow, src, getAttribute: (name: string) => (name === "src" ? element.src : null) };
		return { element: element as unknown as HTMLIFrameElement, window: contentWindow, posted, set: (next: string) => (element.src = next) };
	};
	/** A message arriving at the page from `source`. */
	const say = (source: unknown, data: unknown) => {
		for (const listener of [...listeners]) listener({ source, data } as MessageEvent);
	};
	return { frame, say, view, listening: () => listeners.size };
}

/** Timers that run only when told. */
function timers() {
	const due = new Map<number, { run: () => void; ms: number }>();
	let next = 0;
	return {
		setTimer: (run: () => void, ms: number) => {
			due.set(++next, { run, ms });
			return next;
		},
		clearTimer: (id: unknown) => void due.delete(id as number),
		fire: () => {
			const all = [...due.values()];
			due.clear();
			for (const one of all) one.run();
		},
		pending: () => [...due.values()].map((one) => one.ms),
	};
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("board host", () => {
	it("mints a token for each frame's own board when it says it is ready, and posts it only to that frame, at its origin", async () => {
		const p = page();
		const minted: Array<[string, string | undefined]> = [];
		let n = 0;
		const host = createBoardHost({ mint: async (path, stage) => (minted.push([path, stage]), `dk_b_${++n}`) });
		const a = p.frame("/api/board/boards/a.html?rev=1");
		const b = p.frame("http://127.0.0.1:4830/api/board/boards/b.html?decks_ticket=t");
		host.attach(a.element, { path: () => "boards/a.html", stage: () => "launch" });
		host.attach(b.element, { path: () => "boards/b.html" });

		p.say(a.window, { decks: "board.ready" });
		await settle();
		assert.deepEqual(minted, [["boards/a.html", "launch"]]);
		assert.deepEqual(a.posted, [{ message: { decks: "board.token", token: "dk_b_1" }, origin: "http://127.0.0.1:4830" }]);
		assert.equal(b.posted.length, 0, "the other frame hears nothing");

		p.say(b.window, { decks: "board.ready" });
		await settle();
		assert.deepEqual(minted[1], ["boards/b.html", undefined]);
		assert.equal(b.posted[0]?.message.token, "dk_b_2");
		assert.equal(a.posted.length, 1);
	});

	it("listens on the page's window when the frame is handed over before it is in the page (a template's document has none)", async () => {
		const p = page();
		const host = createBoardHost({ mint: async () => "dk_b_1", view: p.view as unknown as Window });
		const a = p.frame("/api/board/boards/a.html");
		(a.element as unknown as { ownerDocument: { defaultView: null; baseURI: string } }).ownerDocument = { defaultView: null, baseURI: "http://127.0.0.1:4830/" };
		host.attach(a.element, { path: () => "boards/a.html" });
		p.say(a.window, { decks: "board.ready" });
		await settle();
		assert.equal(a.posted[0]?.message.token, "dk_b_1");
	});

	it("ignores a ready from any window but the frame's, and messages that are not one", async () => {
		const p = page();
		let minted = 0;
		const host = createBoardHost({ mint: async () => `dk_b_${++minted}` });
		const a = p.frame("/api/board/boards/a.html");
		host.attach(a.element, { path: () => "boards/a.html" });
		p.say({ postMessage: () => {} }, { decks: "board.ready" });
		p.say(a.window, { decks: "board.token", token: "x" });
		p.say(a.window, "board.ready");
		await settle();
		assert.equal(minted, 0);
	});

	it("posts to the origin of the address the frame was given, so a frame that went elsewhere is not handed the token", async () => {
		const p = page("http://127.0.0.1:4801/canvas/x");
		const host = createBoardHost({ mint: async () => "dk_b_1" });
		const studio = p.frame("http://127.0.0.1:4830/api/board/boards/a.html?decks_ticket=t");
		host.attach(studio.element, { path: () => "boards/a.html", page: () => "http://127.0.0.1:4830/api/board/boards/a.html?decks_ticket=t" });
		p.say(studio.window, { decks: "board.ready" });
		await settle();
		assert.equal(studio.posted[0]?.origin, "http://127.0.0.1:4830", "the harness's origin, not Studio's");
	});

	it("gives no token to a frame whose address has no origin to name, and never posts to *", async () => {
		const p = page();
		const host = createBoardHost({ mint: async () => "dk_b_1" });
		const blank = p.frame("about:blank");
		host.attach(blank.element, { path: () => "boards/a.html" });
		p.say(blank.window, { decks: "board.ready" });
		await settle();
		assert.deepEqual(blank.posted, []);
		assert.equal(frameOrigin(blank.element, "data:text/html,hi"), undefined);
	});

	it("says why when the host can make no token for the board", async () => {
		const p = page();
		const host = createBoardHost({ mint: async () => undefined });
		const a = p.frame("/api/board/boards/a.html");
		host.attach(a.element, { path: () => "boards/a.html" });
		p.say(a.window, { decks: "board.ready" });
		await settle();
		assert.equal(a.posted[0]?.message.decks, "board.token");
		assert.equal(typeof a.posted[0]?.message.error, "string");
		assert.equal(a.posted[0]?.message.token, undefined);
	});

	it("sends a reloaded frame the token it had, and a new one for another board", async () => {
		const p = page();
		let minted = 0;
		const host = createBoardHost({ mint: async () => `dk_b_${++minted}` });
		const a = p.frame("/api/board/boards/a.html");
		let path = "boards/a.html";
		host.attach(a.element, { path: () => path });
		p.say(a.window, { decks: "board.ready" });
		await settle();
		p.say(a.window, { decks: "board.ready" });
		await settle();
		assert.equal(minted, 1);
		assert.deepEqual(
			a.posted.map((one) => one.message.token),
			["dk_b_1", "dk_b_1"],
		);
		path = "boards/b.html";
		a.set("/api/board/boards/b.html");
		p.say(a.window, { decks: "board.ready" });
		await settle();
		assert.equal(a.posted[2]?.message.token, "dk_b_2");
	});

	it("renews the token before it runs out, and sends the new one as a renewal", async () => {
		const p = page();
		const t = timers();
		let minted = 0;
		const host = createBoardHost({ mint: async () => `dk_b_${++minted}`, renewMs: 1000, setTimer: t.setTimer, clearTimer: t.clearTimer });
		const a = p.frame("/api/board/boards/a.html");
		host.attach(a.element, { path: () => "boards/a.html" });
		p.say(a.window, { decks: "board.ready" });
		await settle();
		assert.deepEqual(t.pending(), [1000]);
		t.fire();
		await settle();
		assert.deepEqual(a.posted[1]?.message, { decks: "board.token", token: "dk_b_2", renew: true });
		assert.deepEqual(t.pending(), [1000], "and again after that");
	});

	it("stops listening and renewing when the frame is let go", async () => {
		const p = page();
		const t = timers();
		const host = createBoardHost({ mint: async () => "dk_b_1", setTimer: t.setTimer, clearTimer: t.clearTimer });
		const a = p.frame("/api/board/boards/a.html");
		const detach = host.attach(a.element, { path: () => "boards/a.html" });
		p.say(a.window, { decks: "board.ready" });
		await settle();
		detach();
		assert.equal(p.listening(), 0);
		assert.deepEqual(t.pending(), []);
		p.say(a.window, { decks: "board.ready" });
		await settle();
		assert.equal(a.posted.length, 1);
	});
});

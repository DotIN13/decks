import { Refused, type Caller, type Envelope, type Who } from "../../protocol/index.ts";
import type { Heard } from "./events.ts";
import { LOCAL_PERSON } from "./callers.ts";
import { listen } from "./doors/http.ts";
import { buildKernel, type Built } from "./kernel.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { MemoryStore, memoryStores } from "./store.ts";
import type { CanvasDoc, Client, Context, Deck, Feature } from "./types.ts";

// For a feature's tests: the real kernel and router on an in-memory deck.
// Make a call by name as any caller, read every event it emitted, read the
// deck. Answers are checked against their declared shape here.

export const callers = {
	person: { kind: "person", id: "person", name: "you" } as Caller,
	agent: (id: string, canvas?: string): Caller => ({ kind: "agent", id, name: id, ...(canvas ? { canvas } : {}) }),
	card: (path: string, canvas: string): Caller => ({ kind: "card", id: path, name: path, canvas }),
	app: (name: string): Caller => ({ kind: "app", id: name, name }),
};

export type TestServer = Built & {
	deck: Deck;
	/** Every event emitted since the server started, oldest first. */
	heard: Heard[];
	call(name: string, args?: Record<string, unknown>, as?: Caller | Who, client?: Client): Promise<Envelope<unknown>>;
	/** The value of a call that must succeed; a refusal throws with its message. */
	value<T = unknown>(name: string, args?: Record<string, unknown>, as?: Caller | Who): Promise<T>;
	/** A token that calls as this caller through the doors. */
	token(who: Caller): string;
	/** The real doors (HTTP, socket, MCP) on a port; 0 picks a free one. token calls as the person. */
	listen(port?: number): Promise<{ url: string; port: number; token: string; close(): Promise<void> }>;
	close(): Promise<void>;
};

const asCaller = (as: Caller | Who | undefined): Caller => {
	if (as === undefined || as === "person") return callers.person;
	if (as === "agent") return callers.agent("agent-1");
	if (as === "card") return callers.card("canvases/test/cards/one/index.html", "test");
	if (as === "app") return callers.app("test-app");
	return as;
};

export async function testServer(options: { features?: Feature[]; deck?: Deck | Record<string, string>; clock?: () => number } = {}): Promise<TestServer> {
	const deck = options.deck instanceof Object && "read" in options.deck ? (options.deck as Deck) : new MemoryDeck((options.deck ?? {}) as Record<string, string>);
	const built = await buildKernel({ deck, stores: memoryStores(), features: options.features ?? [], checkAnswers: true, ...(options.clock ? { clock: options.clock } : {}) });
	const heard: Heard[] = [];
	const stopHearing = built.events.subscribe({ caller: callers.person }, (one) => void heard.push(one));
	const call = (name: string, args: Record<string, unknown> = {}, as?: Caller | Who, client?: Client) => built.router.call(name, args, asCaller(as), client);
	return {
		...built,
		deck: built.history,
		heard,
		call,
		async value<T>(name: string, args?: Record<string, unknown>, as?: Caller | Who): Promise<T> {
			const answer = await call(name, args, as);
			if (!answer.ok) throw Object.assign(new Error(`${name}: ${answer.error.code}: ${answer.error.message}`), { code: answer.error.code });
			return answer.value as T;
		},
		token: (who) => built.callers.issue(who),
		async listen(port = 0) {
			const served = await listen(built, port);
			return { url: served.url, port: served.port, token: built.callers.issue(LOCAL_PERSON, "test"), close: served.close };
		},
		async close() {
			stopHearing();
			await built.stop();
		},
	};
}

const noCanvas: CanvasDoc = {
	read: () => [],
	apply: () => ({ items: [], rev: 0 }),
	since: () => [],
};

/** A hand-made Context for testing a module alone; override any part. */
export function testContext(over: Partial<Context> = {}): Context & { notes: string[] } {
	const notes: string[] = [];
	return {
		caller: callers.person,
		deck: new MemoryDeck(),
		canvas: () => noCanvas,
		canvasName: (name) => name ?? "test",
		events: { emit() {}, on: () => () => {} },
		note: (text) => void notes.push(text),
		store: new MemoryStore(),
		call: async (name) => {
			throw new Refused("unavailable", `testContext makes no calls (${name}); give call in over, or use testServer.`);
		},
		notes,
		...over,
	};
}

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { WebGate, type GateEvent, type GateQuestion } from "./proxy.ts";
import type { CdpMessage } from "./gate.ts";

/**
 * The browser, without a browser.
 *
 * Everything the gate forwards lands here, and everything the gate asks the page is answered
 * from here, so a test can assert both halves: that a held command never arrived, and that
 * the command which did arrive carries the words the hook returned rather than the agent's.
 */
async function fakeBrowser(): Promise<{
	url: string;
	seen: CdpMessage[];
	answerPage: (value: (expression: string) => unknown) => void;
	close: () => Promise<void>;
}> {
	const http: Server = createServer();
	const wss = new WebSocketServer({ noServer: true });
	const seen: CdpMessage[] = [];
	let page: (expression: string) => unknown = () => undefined;
	http.on("upgrade", (request, socket, head) => {
		wss.handleUpgrade(request, socket, head, (ws) => {
			ws.on("message", (data) => {
				const message = JSON.parse(data.toString()) as CdpMessage;
				seen.push(message);
				if (message.method === "Runtime.evaluate") {
					const expression = String(message.params?.expression ?? "");
					ws.send(JSON.stringify({ id: message.id, ...(message.sessionId ? { sessionId: message.sessionId } : {}), result: { result: { value: page(expression) } } }));
					return;
				}
				ws.send(JSON.stringify({ id: message.id, ...(message.sessionId ? { sessionId: message.sessionId } : {}), result: {} }));
			});
		});
	});
	await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
	const port = (http.address() as AddressInfo).port;
	return {
		url: `ws://127.0.0.1:${port}/cdp`,
		seen,
		answerPage: (value) => {
			page = value;
		},
		close: () =>
			new Promise<void>((resolve) => {
				wss.close();
				http.close(() => resolve());
			}),
	};
}

/** One command, and the answer to it. */
function ask(client: WebSocket, message: CdpMessage, timeout = 3000): Promise<CdpMessage> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`no answer to ${message.method}`)), timeout);
		const listener = (data: WebSocket.RawData) => {
			const reply = JSON.parse(data.toString()) as CdpMessage;
			if (reply.id !== message.id) return;
			clearTimeout(timer);
			client.off("message", listener);
			resolve(reply);
		};
		client.on("message", listener);
		client.send(JSON.stringify(message));
	});
}

/** A gate on a fake browser, with a client attached and the pass-through proved before the test begins. */
async function harness(
	hooks: { allow: (q: GateQuestion) => Promise<boolean>; words: (q: GateQuestion) => Promise<string> },
	options: { timeoutMs?: number } = {},
) {
	const browser = await fakeBrowser();
	const events: GateEvent[] = [];
	const gate = await WebGate.start({ upstream: browser.url, hooks, onEvent: (event) => events.push(event), ...options });
	const client = new WebSocket(gate.cdpUrl);
	await new Promise<void>((resolve, reject) => {
		client.once("open", () => resolve());
		client.once("error", reject);
	});
	// A command the gate has no opinion about proves the wire is up in both directions.
	const version = await ask(client, { id: 1, method: "Browser.getVersion" });
	assert.ok(version.result, "the first command should reach the browser");
	browser.answerPage((expression) => {
		if (expression.includes("elementFromPoint")) return { tag: "BUTTON", name: "Send", submits: true, inForm: true };
		if (expression.includes("activeElement")) return 'input "Search"';
		if (expression === "document.title") return "Example form";
		return undefined;
	});
	return {
		browser,
		gate,
		events,
		client,
		close: async () => {
			client.close();
			await gate.close();
			await browser.close();
		},
	};
}

test("a command the gate has no opinion about goes straight through", async () => {
	const h = await harness({ allow: async () => true, words: async () => "unused" });
	try {
		const reply = await ask(h.client, { id: 2, method: "Page.navigate", params: { url: "https://example.com" } });
		assert.deepEqual(reply.result, {});
		assert.equal(h.events.length, 0, "nothing worth a line in the transcript happened");
	} finally {
		await h.close();
	}
});

test("the agent's own words never reach the browser", async () => {
	const asked: GateQuestion[] = [];
	const h = await harness({
		allow: async () => true,
		words: async (question) => {
			asked.push(question);
			return "the supervising agent's sentence";
		},
	});
	try {
		const reply = await ask(h.client, { id: 3, method: "Input.insertText", params: { text: "what jev wanted to say" } });
		assert.ok(reply.result !== undefined || reply.error === undefined);
		const typed = h.browser.seen.filter((message) => message.method === "Input.insertText");
		assert.equal(typed.length, 1);
		assert.equal(typed[0]?.params?.text, "the supervising agent's sentence");
		assert.ok(!JSON.stringify(h.browser.seen).includes("what jev wanted to say"), "the agent's text is nowhere on the wire");
		assert.equal(asked.length, 1);
		assert.equal(asked[0]?.kind, "words");
		assert.equal(asked[0]?.field, 'input "Search"');
		assert.equal(asked[0]?.tab, "Example form");
		assert.ok(h.events.some((event) => event.kind === "typed"));
	} finally {
		await h.close();
	}
});

test("a press the page says submits is held, and refusing it reaches the agent as a failure", async () => {
	const asked: GateQuestion[] = [];
	const h = await harness({
		allow: async (question) => {
			asked.push(question);
			return false;
		},
		words: async () => "unused",
	});
	try {
		const reply = await ask(h.client, { id: 4, method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 10, y: 20, button: "left" } });
		assert.match(String(reply.error?.message), /refused/i);
		assert.equal(h.browser.seen.filter((message) => message.method === "Input.dispatchMouseEvent").length, 0, "the press never arrived");
		assert.equal(asked.length, 1);
		assert.equal(asked[0]?.action, 'click "Send" — it submits the form');
		assert.equal(asked[0]?.tab, "Example form");
		assert.ok(h.events.some((event) => event.kind === "refused"));
	} finally {
		await h.close();
	}
});

test("allowing the press lets exactly that press through, and nothing else", async () => {
	const h = await harness({ allow: async () => true, words: async () => "unused" });
	try {
		const reply = await ask(h.client, { id: 5, method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 10, y: 20, button: "left" } });
		assert.deepEqual(reply.result, {});
		const presses = h.browser.seen.filter((message) => message.method === "Input.dispatchMouseEvent");
		assert.equal(presses.length, 1);
		assert.deepEqual(presses[0]?.params, { type: "mousePressed", x: 10, y: 20, button: "left" });
	} finally {
		await h.close();
	}
});

test("Enter is held like a press, and its question says what it is", async () => {
	const asked: GateQuestion[] = [];
	const h = await harness({
		allow: async (question) => {
			asked.push(question);
			return false;
		},
		words: async () => "unused",
	});
	try {
		const reply = await ask(h.client, { id: 6, method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "Enter", text: "\r" } });
		assert.match(String(reply.error?.message), /press Enter/);
		assert.equal(h.browser.seen.filter((message) => message.method === "Input.dispatchKeyEvent").length, 0);
		assert.equal(asked[0]?.action, "press Enter");
	} finally {
		await h.close();
	}
});

test("while a gate is open, nothing else reaches the browser", async () => {
	let release: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const h = await harness({
		allow: async () => true,
		words: async () => {
			await held;
			return "answered late";
		},
	});
	try {
		const typing = ask(h.client, { id: 7, method: "Input.insertText", params: { text: "jev's" } });
		const behind = ask(h.client, { id: 8, method: "Page.navigate", params: { url: "https://example.com/next" } });
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(h.browser.seen.filter((message) => message.id === 8).length, 0, "a command queued behind a gate must not overtake it");
		release?.();
		await typing;
		await behind;
		assert.equal(h.browser.seen.filter((message) => message.id === 8).length, 1);
	} finally {
		await h.close();
	}
});

test("a page the gate cannot read is not a reason to stop the run", async () => {
	const h = await harness({ allow: async () => true, words: async () => "unused" });
	try {
		h.browser.answerPage(() => undefined);
		const reply = await ask(h.client, { id: 9, method: "Input.dispatchMouseEvent", params: { type: "mousePressed", x: 3, y: 4, button: "left" } });
		assert.deepEqual(reply.result, {});
		assert.equal(h.browser.seen.filter((message) => message.method === "Input.dispatchMouseEvent").length, 1);
		assert.ok(h.events.some((event) => event.kind === "unread"));
	} finally {
		await h.close();
	}
});

test("a question nobody answers is a refusal, not a door left open", async () => {
	const h = await harness({ allow: () => new Promise<boolean>(() => {}), words: async () => "unused" }, { timeoutMs: 60 });
	try {
		const reply = await ask(h.client, { id: 10, method: "Input.dispatchKeyEvent", params: { type: "keyDown", key: "Enter" } });
		assert.match(String(reply.error?.message), /refused/i);
		assert.equal(h.browser.seen.filter((message) => message.method === "Input.dispatchKeyEvent").length, 0);
	} finally {
		await h.close();
	}
});

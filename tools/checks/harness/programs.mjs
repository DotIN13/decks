// Starting the programs, as the checks reach them: where they are, how a check says what it found,
// the fixture deck and the person's token, and the server's socket with the reset to the fixture's canvas.
import { readFileSync, writeFileSync } from "node:fs";
import { applyEdits } from "../../../pen/diff.ts";

// Where the programs are, and how a check says what it found.

export const WEB = process.env.DECKS_E2E_WEB ?? "http://127.0.0.1:4328";

export const API = process.env.DECKS_E2E_API ?? "http://127.0.0.1:4329";

let failures = 0;

/** Report one check. A failure sets the exit code, so a runner can trust it. */
export function say(name, ok, detail = "") {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) {
		failures += 1;
		process.exitCode = 1;
	}
}

export function failed() {
	return failures;
}

// The fixture deck and the person: the token, the canvas, its cards and their files.

/**
 * A person token for the checks' own calls, as a Decks tab gets one: the harness writes it into its
 * page loaded as a tab of its own (the server's token for it). Every request to the harness carries a
 * token, from this machine too. Made once per harness address.
 */
const tokens = new Map();

export function personToken(api) {
	api = typeof api === "string" ? api : API;
	if (!tokens.has(api)) {
		tokens.set(
			api,
			import("node:http").then(
				({ get }) =>
					new Promise((resolve, reject) => {
						get(`${api}/`, { headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" } }, (response) => {
							let html = "";
							response.setEncoding("utf8");
							response.on("data", (chunk) => (html += chunk));
							response.on("end", () => {
								const token = /<meta name="decks-session" content="([^"]+)">/.exec(html)?.[1];
								if (token) resolve(token);
								else reject(new Error(`${api}/ gave no person token: is it a Decks harness with a built web app?`));
							});
						}).on("error", reject);
					}),
			),
		);
	}
	return tokens.get(api);
}

/** The headers that make a check's request the person's. */
export async function asPerson(api) {
	return { authorization: `Bearer ${await personToken(api)}` };
}

/**
 * The fixture's canvas (`e2e/fixture/decks/canvases/auth-refresh/`): five cards (plan, risks, sources,
 * notes and how-deep-is-the-deep-sea), which `resetStage` puts the focused agent on.
 */
export const CANVAS = "auth-refresh";

/** A fixture card's deck path, by its name: `card("plan")` is `canvases/auth-refresh/cards/plan/index.html`. */
export const card = (name) => `canvases/${CANVAS}/cards/${name}/index.html`;

/**
 * The fixture's one leftover board: a friend's shared canvas (`shared/canvases/ada/old-notes/`, view
 * only), whose board is drawn as a picture and never runs. For the checks of an old board's drawing.
 */
export const SHARED_CANVAS = "shared/ada/old-notes";

export const SHARED_BOARD = "shared/canvases/ada/old-notes/boards/notes.html";

/** What a check calls a card or a board by: a card's folder (`plan` for `…/cards/plan/index.html`), else its file's name. */
export const nameOf = (path) => /\/cards\/([^/]+)\/index\.html$/.exec(path.split("?")[0])?.[1] ?? path.split("?")[0].split("/").pop();

/** Where the fixture puts each of its cards, from its canvas file: what `resetStage` moves them back to. */
const FIXTURE_PLACES = (() => {
	const doc = JSON.parse(readFileSync(new URL(`../../fixtures/deck/canvases/${CANVAS}/canvas.pen`, import.meta.url), "utf8"));
	return (doc.children ?? []).filter((node) => node.metadata?.type === "decks.card").map((node) => ({ path: `canvases/${CANVAS}/${node.metadata.path}`, x: node.x, y: node.y }));
})();

/**
 * The deck the server actually has open, straight from the API. `boards` is every card, board,
 * document and app on the deck's own canvases, which a check counting what is on screen counts;
 * a friend's shared canvas is left out of it. `library` is everything the deck lists.
 *
 * Each one's place and size are its item's in its canvas's file, read from disk: the deck's own
 * `x`/`y` are only the seed a new stage would lay it out from, not where the canvas has it.
 */
export async function deckState(api) {
	api = typeof api === "string" ? api : API;
	const response = await fetch(`${api}/api/deck`, { headers: await asPerson(api) });
	if (!response.ok) throw new Error(`GET /api/deck -> ${response.status}`);
	const deck = (await response.json()).deck;
	const drawings = new Map();
	const placed = (board) => {
		const canvas = /^canvases\/([^/]+)\//.exec(board.path)?.[1];
		if (!canvas) return board;
		if (!drawings.has(canvas)) {
			try {
				drawings.set(canvas, JSON.parse(readFileSync(`${deck.path}/canvases/${canvas}/canvas.pen`, "utf8")).children ?? []);
			} catch {
				drawings.set(canvas, []);
			}
		}
		const inFolder = board.path.slice(`canvases/${canvas}/`.length);
		const node = drawings.get(canvas).find((one) => one.metadata?.path === inFolder);
		return node && Number.isFinite(node.x) ? { ...board, x: node.x, y: node.y, w: node.width ?? board.w, h: node.height ?? board.h } : board;
	};
	return { ...deck, library: deck.boards, boards: deck.boards.filter((board) => !board.path.startsWith("shared/")).map(placed) };
}

/**
 * Refuse to run against a deck that is not a fixture.
 *
 * This exists because it already happened: a stale server on the API port meant a run
 * went against the deck being worked in, and boards were dragged ~100px before anyone
 * noticed. A check that writes to boards has no business guessing.
 */
export async function preflight() {
	const deck = await deckState();
	const marker = process.env.DECKS_E2E_MARKER ?? "decks-e2e";
	if (!deck.path.includes(marker)) {
		console.error(`refusing to run: ${deck.path} does not look like a fixture (no "${marker}" in the path).`);
		console.error("start the server on a fixture deck, or set DECKS_E2E_MARKER.");
		process.exit(2);
	}
	return deck;
}

/** A fixture card's file inside the deck under test, by its name (`cardFile("plan")`). */
export async function cardFile(name) {
	const deck = await deckState();
	return `${deck.path}/${card(name)}`;
}

export function read(file) {
	return readFileSync(file, "utf8");
}

export function write(file, text) {
	writeFileSync(file, text);
}

// The server's socket: today's tab socket, the reset to the fixture's canvas, a held-back line.

/** Talk to the server the way the client does. */
export async function socket(api) {
	api = typeof api === "string" ? api : API;
	const ws = new WebSocket(`${api.replace("http", "ws")}/ws?decks_token=${encodeURIComponent(await personToken(api))}`);
	const received = [];
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = reject;
	});
	/*
	 * A stage drawing comes whole once and then as edits (`stage.pen.delta`). Each delta is also
	 * recorded as the whole `stage.pen` frame it makes, so a check reads every revision the same way.
	 */
	const pens = new Map();
	ws.onmessage = (event) => {
		const message = JSON.parse(String(event.data));
		received.push(message);
		const key = `${message.agentId}|${message.stage}`;
		if (message.type === "stage.pen") pens.set(key, message);
		else if (message.type === "stage.pen.delta") {
			const held = pens.get(key);
			if (held?.rev !== message.from) return ws.send(JSON.stringify({ type: "stage.pen.get", agentId: message.agentId }));
			const whole = { type: "stage.pen", agentId: message.agentId, stage: message.stage, rev: message.rev, doc: applyEdits(held.doc, message.edits), base: message.base };
			pens.set(key, whole);
			received.push(whole);
		}
	};
	const link = {
		received,
		send: (message) => ws.send(JSON.stringify(message)),
		last: (type) => received.filter((m) => m.type === type).at(-1),
		close: () => ws.close(),
	};
	/*
	 * What a board frame acts on is **the stage of the agent this socket is on**. A new socket
	 * starts on the conversation last opened anywhere, which is the page's own when a check has
	 * just opened one; a check that drives boards over the wire for a particular agent sends
	 * `agent.focus` first, which moves this socket alone.
	 */
	return link;
}

/*
 * What the server last said an agent has on its stage: its `context.changed`, or its row in the
 * `agents` roster, whichever came later. The roster is the only word when nothing changed: a fresh
 * server's first agent may already be on the fixture's canvas, and opening it again changes nothing.
 */
const holding = (link, agent) => {
	let inPlay = [];
	for (const m of link.received) {
		if (m.type === "context.changed" && m.agentId === agent) inPlay = m.inPlay ?? [];
		else if (m.type === "agents") inPlay = m.chats?.find((chat) => chat.id === agent)?.inPlay ?? inPlay;
	}
	return inPlay;
};

/**
 * Put the fixture's canvas on the focused agent's stage, with each of its cards where the fixture has it.
 *
 * Most of these checks expect to see every card.
 * Without this they inherit whatever the previous check narrowed the stage to, and fail
 * for reasons that have nothing to do with what they test.
 *
 * A URL is for the runner, which has one server per worker and so no single `API` to read;
 * checks call it with their page, or nothing, and get this process's `API`.
 */
export async function resetStage(at) {
	const api = typeof at === "string" ? at : API;
	const wanted = FIXTURE_PLACES.map((one) => one.path);
	/*
	 * And where the fixture puts them, not wherever the last check left them.
	 *
	 * A card's place belongs to the canvas, so it survives from one call to the next within a check: a
	 * drag is still in force when the check flies to the plan and expects its neighbours. So each card is
	 * put back where the fixture's canvas file has it, one `card.move` per card, the same message a drag sends.
	 */
	const link = await socket(api);
	/*
	 * Confirmed, for the *focused* agent, and retried until it is.
	 *
	 * A fresh server is still starting its first agent when the first check begins, and that agent opens
	 * on a canvas of its own (a new agent joins the latest canvas of its workspace's agents, and it has
	 * none), so it is sent to the fixture's canvas (`agent.stage`) and this waits until the server says
	 * that agent holds every card. The greeting says who is focused; any other agent's `context.changed`
	 * describes a stage the browser is not looking at.
	 */
	const deadline = Date.now() + 25000;
	let landed = [];
	let agent;
	let passes = 0;
	while (Date.now() < deadline) {
		agent = link.last("agents")?.focused ?? agent;
		if (agent) {
			link.send({ type: "agent.stage", id: agent, stage: CANVAS });
			// A card an earlier round took off the canvas comes back by card.play: card.move only remembers a place for
			// a card that is not on it. From the second pass, once the canvas has said what it holds, so none is doubled.
			if (passes++ > 0) for (const one of FIXTURE_PLACES) if (!landed.includes(one.path)) link.send({ type: "card.play", stage: CANVAS, path: one.path });
			for (const one of FIXTURE_PLACES) link.send({ type: "card.move", stage: CANVAS, path: one.path, x: one.x, y: one.y });
		}
		// Watched rather than slept on: the answer is usually back in a few milliseconds, and is resent after 1.5s.
		const resend = Date.now() + (agent ? 1500 : 100);
		while (Date.now() < resend) {
			await new Promise((resolve) => setTimeout(resolve, 25));
			landed = holding(link, agent);
			if (agent && wanted.every((path) => landed.includes(path))) break;
		}
		if (agent && wanted.every((path) => landed.includes(path))) break;
	}
	link.close();
	if (!agent) throw new Error("resetStage: the server never said which agent is focused");
	if (!wanted.every((path) => landed.includes(path))) {
		throw new Error(`resetStage: ${wanted.filter((path) => landed.includes(path)).length} of ${wanted.length} cards reached ${agent}'s stage: wanted ${wanted.join(", ")}; on it ${landed.join(", ")}`);
	}
	return wanted;
}

/**
 * The canvas frame's line to the harness held back, as a far network holds it: the answer to each edit
 * the frame sends (`canvas.batch`) and every change on the stream it follows the drawing on
 * (`/api/v1/events`), each `ms` late and in order. The page's own socket is the check's to route.
 *
 * Call it before the page loads (it installs a script in every frame, and the frame made after it
 * is what it reaches), then `set(ms)` around what is measured; `queued()` is what is still held back.
 */
export async function lagCanvasLine(page) {
	const state = { ms: 0, queued: 0 };
	/*
	 * The frame's line is one WebSocket (`/api/v1/socket`, or compat's `/compat/v1/socket` the page's compat mode
	 * gives the frame): every message from the harness (the answer to an
	 * edit, the canvas's changes) is held back `ms`, in order; what the frame sends goes through at once.
	 */
	await page.routeWebSocket(/\/(api|compat)\/v1\/socket/, (ws) => {
		const server = ws.connectToServer();
		let last = 0;
		server.onMessage((message) => {
			const at = Math.max(Date.now() + state.ms, last);
			last = at;
			state.queued++;
			setTimeout(() => {
				state.queued--;
				try {
					ws.send(message);
				} catch {
					/* the frame went away */
				}
			}, at - Date.now());
		});
		server.onClose(() => ws.close().catch(() => {}));
		ws.onMessage((message) => server.send(message));
		ws.onClose(() => server.close().catch(() => {}));
	});
	return {
		async set(ms) {
			state.ms = ms;
		},
		async queued() {
			return state.queued;
		},
	};
}

/**
 * @decks/sdk: every Decks verb as a function, over HTTP.
 *
 * One file, no dependencies, the same in Node 18+ and a browser. Each verb in the table
 * (`packages/api`) is a function here that posts its arguments to `POST /api/v1/<verb>` and
 * answers with the value:
 *
 *     import { decks } from "@decks/sdk";        // DECKS_URL and DECKS_AGENT from the environment
 *     const { path } = await decks.board.create({ title: "Q3 revenue is up a fifth" });
 *     await decks.canvas.insert({ type: "board", board: path }, { at: { x1: 0, y1: 0 } });
 *     await decks.canvas.insert({ type: "note", content: "why?" }, { below: path });
 *     await decks.canvas.fit(path);
 *
 * Every canvas call takes `{ canvas }` last; left out, it is `decks.here()`. The old names
 * (`newBoard`, `show`, `pen.edit`, …) still work for one release, and say their new call.
 *
 * Who is calling is an agent (`DECKS_AGENT`, which Decks sets in each agent's shell), an app
 * (`DECKS_APP`, set for a server app; a page under `/app/<name>/` is found from its address), or a
 * board's button (its page, `/api/board/<path>`, says which board).
 * The `decks` command (`bin/decks.mjs`) and the MCP server (`mcp/server.mjs`) are this file.
 *
 * The list of verbs below is generated from the table by `scripts/gen-sdk.mjs`; the rest is not.
 */

/** Something Decks said went wrong: a refused call, a verb that threw, or no Decks at all. */
export class DecksError extends Error {
	constructor(message, details = {}) {
		super(message);
		this.name = "DecksError";
		this.status = details.status;
		this.notes = details.notes ?? [];
	}
}

// <generated:verbs> scripts/gen-sdk.mjs writes this list from packages/api; do not edit it here.
export const VERBS = [
	["canvas.read",["options?"]],
	["canvas.insert",["item","options?"]],
	["canvas.update",["id","change","options?"]],
	["canvas.replace",["id","item","options?"]],
	["canvas.delete",["id","options?"]],
	["canvas.move",["id","options?"]],
	["canvas.copy",["id","options?"]],
	["canvas.variables",["set","options?"]],
	["canvas.batch",["ops","options?"]],
	["canvas.fit",["board","options?"]],
	["canvas.save",["id","frame","options?"]],
	["canvas.screenshot",["options?"]],
	["canvas.rename",["title","options?"]],
	["canvas.file",["options?"]],
	["canvas.watch",["options?"]],
	["board.list",[]],
	["board.create",["options"]],
	["board.get",["board"]],
	["board.canvases",["board"]],
	["board.url",["board"]],
	["canvas.list",[]],
	["canvas.create",["title"]],
	["frame.create",["path","item?"]],
	["file.url",["file"]],
	["agent.me",[]],
	["agent.update",["patch"]],
	["here",[]],
	["agent.claim",["boards..."]],
	["agent.inbox",[]],
	["agent.list",["options?"]],
	["agent.get",["name"]],
	["agent.send",["name","message"]],
	["agent.queue",["name","work"]],
	["agent.create",["spec"]],
	["view.goto",["canvas"]],
	["view.focus",["target","options?"]],
	["view.camera",[]],
	["view.move",["camera"]],
	["view.viewport",[]],
	["view.cursor",["board","at"]],
	["view.reload",["options"]],
	["apps.list",[]],
	["apps.status",["name"]],
	["apps.create",["name","options?"]],
	["apps.board",["name"]],
	["apps.build",["name"]],
	["apps.run",["name"]],
	["apps.stop",["name"]],
	["apps.restart",["name"]],
	["apps.logs",["name","options?"]],
	["apps.check",["name"]],
	["web.status",[]],
	["web.pairing",[]],
	["web.repair",[]],
	["web.board",[]],
	["web.open",["url"]],
	["web.read",[]],
	["web.screenshot",["options?"]],
	["web.fill",["field","text"]],
	["web.select",["field","option"]],
	["web.click",["what"]],
	["web.press",["key"]],
	["web.submit",["what?","options?"]],
	["web.stop",[]],
	["ports",["change?"]],
	["now",[]],
	["newBoard",["options"]],
	["fit",["path","options?"]],
	["resize",["path","size"]],
	["report",["path..."]],
	["reload",["path"]],
	["boards",[]],
	["show",["target","options?"]],
	["hide",["path..."]],
	["move",["path","at"]],
	["cursor",["path","at"]],
	["camera",["at?","options?"]],
	["viewport",[]],
	["screenshot",["options?"]],
	["stages",[]],
	["open",["name"]],
	["newStage",["title"]],
	["title",["title?"]],
	["pen.read",["path?"]],
	["pen.edit",["edits","options?"]],
	["pen.create",["path","item?"]],
	["pen.save",["id","path","options?"]],
	["pen.file",[]],
	["me",["patch?"]],
	["agents",["options?"]],
	["send",["to","work"]],
	["queue",["agentId?"]],
	["url",["path"]],
	["resolve",["file"]],
];
// </generated:verbs>

const env = (name) => (typeof process !== "undefined" && process.env ? process.env[name] : undefined);

/**
 * In an app's page the server is the page's own, and the app is named in its address:
 * `/app/<name>/…`, keeping whatever prefix it is under (a second server's `/c/<id>/`).
 */
function fromPage() {
	if (typeof location === "undefined") return {};
	const app = /^(.*?)\/app\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(location.pathname);
	if (app) return { url: `${location.origin}${app[1]}`, app: app[2] };
	// A board's own page, `<prefix>/api/board/<path>`: its buttons call as the board.
	const board = /^(.*?)\/api\/board\/(.+)$/.exec(location.pathname);
	if (board) return { url: `${location.origin}${board[1]}`, board: decodeURIComponent(board[2]) };
	return { url: location.origin };
}

/** Notes go to stderr in Node, where an agent's script is reading; a page has nowhere to say them. */
function defaultNotes(lines) {
	if (typeof process !== "undefined" && process.stderr && typeof process.stderr.write === "function") {
		for (const line of lines) process.stderr.write(`${line}\n`);
	}
}

/**
 * A connection to Decks.
 *
 * @param {object} [options]
 * @param {string} [options.url]  Decks' address, as in http://127.0.0.1:4329. Default: `DECKS_URL`, or the page's own.
 * @param {string} [options.agent]  The agent the calls are for, by id or name. Default: `DECKS_AGENT`.
 * @param {string} [options.app]  The app the calls are from. Default: `DECKS_APP`, or the page's app.
 * @param {boolean} [options.person]  The person, in Decks' own page: `stage` and `agent` say whose stage (each a value or a function read per call).
 * @param {string | (() => string | undefined)} [options.stage]  For the person: the canvas on screen.
 * @param {string} [options.board]  A board whose button is calling. Default: the board whose page this is.
 * @param {string} [options.session]  An opencode session, which Decks maps to its agent. Default: `DECKS_SESSION`.
 * @param {(lines: string[]) => void} [options.notes]  Where the notes a verb adds go. Default: stderr in Node.
 * @param {typeof fetch} [options.fetch]  A fetch to use instead of the global one.
 */
export function connect(options = {}) {
	const page = fromPage();
	const base = String(options.url ?? env("DECKS_URL") ?? page.url ?? "").replace(/\/+$/, "");
	const agent = options.agent ?? env("DECKS_AGENT");
	// opencode's agents share one server, so their shell names the session, which Decks maps to the agent.
	const session = options.session ?? env("DECKS_SESSION");
	const app = options.app ?? env("DECKS_APP") ?? page.app;
	const board = options.board ?? page.board;
	// The person, clicking in Decks' own page: the canvas on screen and the agent they talk to.
	const person = options.person === true;
	const stage = options.stage;
	const doFetch = options.fetch ?? globalThis.fetch;
	const onNotes = options.notes ?? defaultNotes;
	if (!base) throw new DecksError("No Decks to talk to: set DECKS_URL (Decks sets it in each agent's shell), or pass { url }.");
	if (typeof doFetch !== "function") throw new DecksError("This runtime has no fetch; pass one as { fetch }.");

	/** Call one verb by name with its arguments, and answer with `{ value, notes }`. */
	async function call(verb, args = []) {
		// Trailing undefineds are left off, so an optional argument stays absent rather than null.
		const given = [...args];
		while (given.length && given[given.length - 1] === undefined) given.pop();
		const headers = { "content-type": "application/json" };
		if (person) {
			headers["x-decks-person"] = "1";
			const on = typeof stage === "function" ? stage() : stage;
			if (on) headers["x-decks-stage"] = on;
			const to = typeof agent === "function" ? agent() : agent;
			if (to) headers["x-decks-agent"] = to;
		} else if (app) headers["x-decks-app"] = app;
		else if (board) headers["x-decks-board"] = encodeURIComponent(board);
		else if (agent) headers["x-decks-agent"] = typeof agent === "function" ? agent() : agent;
		else if (session) headers["x-decks-session"] = session;
		let response;
		try {
			response = await doFetch(`${base}/api/v1/${verb}`, { method: "POST", headers, body: JSON.stringify({ args: given }) });
		} catch (error) {
			throw new DecksError(`Could not reach Decks at ${base}: ${error.message}`);
		}
		const answer = await response.json().catch(() => ({ ok: false, error: `Decks answered ${response.status} without a result` }));
		const notes = Array.isArray(answer.notes) ? answer.notes : [];
		if (!response.ok || answer.ok === false) throw new DecksError(answer.error || `Decks answered ${response.status}`, { status: response.status, notes });
		return { value: answer.value, notes, images: answer.images };
	}

	/** The verbs as functions, `pen.edit` under `pen`. */
	const tree = {};
	for (const [name] of VERBS) {
		const path = name.split(".");
		let owner = tree;
		for (const key of path.slice(0, -1)) owner = owner[key] ??= {};
		owner[path[path.length - 1]] = async (...args) => {
			const { value, notes } = await call(name, args);
			if (notes.length) onNotes(notes);
			return value;
		};
	}

	return {
		...tree,
		/** Where this connection reaches Decks. (`url` is the verb that gives a board's address.) */
		address: base,
		call,
		/** The same verbs, for code written against the SDK when they lived under `stage`. */
		stage: tree,
		/** Hand work to the agent with this name, making it from the spec first when there is none; it waits in its queue. */
		async sendTo(spec, work) {
			const have = (await tree.agent.list()).some((one) => one.name === spec.name);
			if (!have) await tree.agent.create(spec);
			const sent = await tree.agent.queue(spec.name, typeof work === "string" ? { task: work } : work);
			return { ...sent, name: spec.name, made: !have };
		},
		run() {
			throw new DecksError("decks.run(code) is gone: the server runs no code now. Call the verbs themselves, as in await decks.canvas.read().");
		},
		/**
		 * Every change as Decks broadcasts it (`GET /api/v1/events`): `onEvent` hears each frame, as
		 * in `{ type: "board.changed", path, board }`. `types` keeps only some. Answers with a way to stop.
		 */
		events(onEvent, options = {}) {
			const controller = new AbortController();
			const types = options.types?.length ? `?types=${encodeURIComponent(options.types.join(","))}` : "";
			const done = (async () => {
				const response = await doFetch(`${base}/api/v1/events${types}`, { signal: controller.signal });
				if (!response.ok || !response.body) throw new DecksError(`Decks answered ${response.status} for its events`, { status: response.status });
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				for (;;) {
					const { value, done: ended } = await reader.read();
					if (ended) return;
					buffer += decoder.decode(value, { stream: true });
					let gap;
					while ((gap = buffer.indexOf("\n\n")) >= 0) {
						const block = buffer.slice(0, gap);
						buffer = buffer.slice(gap + 2);
						const data = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
						if (data) onEvent(JSON.parse(data));
					}
				}
			})().catch((error) => {
				if (error?.name !== "AbortError") throw error;
			});
			return { close: () => controller.abort(), done };
		},
	};
}

/** A connection from the environment, made on first use. */
let shared;
export const decks = new Proxy({}, { get: (_target, key) => (shared ??= connect())[key] });

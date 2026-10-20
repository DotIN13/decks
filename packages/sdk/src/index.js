/**
 * @decks/sdk: every Decks verb as a function, over HTTP.
 *
 * One file, no dependencies, the same in Node 18+ and a browser. Each verb in the table
 * (`packages/api`) is a function here that posts its arguments to `POST /api/v1/<verb>` and
 * answers with the value:
 *
 *     import { decks } from "@decks/sdk";        // DECKS_URL and DECKS_TOKEN from the environment
 *     const { path } = await decks.board.create({ title: "Q3 revenue is up a fifth" });
 *     await decks.canvas.insert({ type: "board", board: path }, { at: { x1: 0, y1: 0 } });
 *     await decks.canvas.insert({ type: "note", content: "why?" }, { below: path });
 *     await decks.canvas.fit(path);
 *
 * Every canvas call takes `{ canvas }` last; left out, it is `decks.here()`. The old names
 * (`newBoard`, `show`, `pen.edit`, …) still work for one release, and say their new call.
 *
 * Who is calling is the token each call carries (`Authorization: Bearer`), and nothing else: an
 * agent's (`DECKS_TOKEN`, which Decks sets in each agent's shell), an app server's (the same, set
 * when Decks starts it), the person's at a terminal (`decks login` keeps it in `~/.decks/token`), or
 * one passed as `{ token }`. A board's button calls through the page around it, which has its own.
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
	["apps.repo",["name"]],
	["apps.clone",["url","options?"]],
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
	["studio.connect",["url","key"]],
	["pair.code",[]],
	["studio.status",[]],
	["studio.disconnect",[]],
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
 * In a page the server is the page's own, under whatever prefix it is at: an app's
 * `/app/<name>/`, a board's `/api/board/<path>`, a second server's `/c/<id>/`.
 */
function fromPage() {
	if (typeof location === "undefined") return {};
	const at = /^(.*?)\/(?:app\/[a-z0-9][a-z0-9-]*(?:\/|$)|api\/board\/)/.exec(location.pathname);
	return { url: `${location.origin}${at ? at[1] : ""}` };
}

/**
 * The token `decks login` kept for this harness, in Node: `~/.decks/token` is a JSON map from a
 * harness's address to its token, readable only by this user. Undefined in a browser, or for none.
 */
async function savedToken(base) {
	if (typeof process === "undefined" || !process.versions?.node) return undefined;
	try {
		const [{ readFileSync }, { homedir }, { join }] = await Promise.all([import("node:fs"), import("node:os"), import("node:path")]);
		const saved = JSON.parse(readFileSync(join(process.env.DECKS_HOME || join(homedir(), ".decks"), "token"), "utf8"));
		const token = saved?.[base.replace(/\/+$/, "")];
		return typeof token === "string" && token ? token : undefined;
	} catch {
		return undefined;
	}
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
 * @param {string | (() => string | undefined)} [options.token]  Who is calling: a token from Decks. Default: `DECKS_TOKEN`, else the one `decks login` kept for this address in `~/.decks/token`, else none (a page whose `fetch` adds its own).
 * @param {string | (() => string | undefined)} [options.stage]  For the person: the canvas they are acting on (`X-Decks-Stage`). A parameter, not who is calling.
 * @param {string | (() => string | undefined)} [options.agent]  For the person: the agent they are talking to (`X-Decks-Agent`). A parameter, not who is calling.
 * @param {string} [options.board]  For the person's page: a board whose button it relays (`X-Decks-Board`).
 * @param {(lines: string[]) => void} [options.notes]  Where the notes a verb adds go. Default: stderr in Node.
 * @param {typeof fetch} [options.fetch]  A fetch to use instead of the global one.
 * @param {Record<string, string>} [options.headers]  More headers for every call.
 */
export function connect(options = {}) {
	const page = fromPage();
	const base = String(options.url ?? env("DECKS_URL") ?? page.url ?? "").replace(/\/+$/, "");
	// What the person is acting on, when the person is calling: parameters, read per call.
	const agent = options.agent;
	const stage = options.stage;
	const board = options.board;
	const given = options.token ?? env("DECKS_TOKEN");
	/** The token, from what was given, else the one `decks login` kept; read once. */
	let found;
	const tokenNow = async () => {
		const now = typeof given === "function" ? given() : given;
		if (now) return now;
		found ??= savedToken(base);
		return found;
	};
	const doFetch = options.fetch ?? globalThis.fetch;
	const onNotes = options.notes ?? defaultNotes;
	if (!base) throw new DecksError("No Decks to talk to: set DECKS_URL (Decks sets it in each agent's shell), or pass { url }.");
	if (typeof doFetch !== "function") throw new DecksError("This runtime has no fetch; pass one as { fetch }.");

	/** The headers every request carries: the caller's own, and its token. */
	async function authHeaders() {
		const token = await tokenNow();
		return { ...options.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) };
	}

	/** Call one verb by name with its arguments, and answer with `{ value, notes }`. */
	async function call(verb, args = []) {
		// Trailing undefineds are left off, so an optional argument stays absent rather than null.
		const given = [...args];
		while (given.length && given[given.length - 1] === undefined) given.pop();
		const headers = { ...(await authHeaders()), "content-type": "application/json" };
		const on = typeof stage === "function" ? stage() : stage;
		if (on) headers["x-decks-stage"] = on;
		const to = typeof agent === "function" ? agent() : agent;
		if (to) headers["x-decks-agent"] = to;
		if (board) headers["x-decks-board"] = encodeURIComponent(board);
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
				const response = await doFetch(`${base}/api/v1/events${types}`, { headers: await authHeaders(), signal: controller.signal });
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

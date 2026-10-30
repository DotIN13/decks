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
 * agent's harness token (`DECKS_TOKEN`, which Decks sets in each agent's shell), an app server's (the
 * same variable, set when Decks starts it), the person's at a terminal (`decks login` keeps it in `~/.decks/token`), or
 * one passed as `{ token }`. An app server's is an app pass, good while that run of it goes.
 * The `decks` command (`bin/decks.mjs`) and the MCP server (`mcp/server.mjs`) are this file.
 *
 * A page on another site (Decks Studio) talks to a harness with this file alone: `connectStudio` or
 * `pairSite` for its site token, the verbs, `request` for the harness's other doors, `events` for its
 * changes, `canvasPass` for each canvas frame it shows, and `appUrl`/`tickets`/`pageUrl` for the tabs
 * it opens on the harness's own address. The token only ever goes in a header; a frame or a tab carries
 * a ticket instead.
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
		// A pairing door's refusal for want of a (working) pairing code.
		if (details.needsCode) this.needsCode = true;
	}
}

// <generated:verbs> scripts/gen-sdk.mjs writes this list from packages/api; do not edit it here.
export const VERBS = [
	["canvas.read",["options?"]],
	["canvas.space",["size","options?"]],
	["canvas.insert",["item","options?"]],
	["canvas.update",["id","change","options?"]],
	["canvas.replace",["id","item","options?"]],
	["canvas.delete",["id","options?"]],
	["canvas.move",["id","options?"]],
	["canvas.copy",["id","options?"]],
	["canvas.variables",["set","options?"]],
	["canvas.batch",["ops","options?"]],
	["canvas.step",["direction","options?"]],
	["canvas.fit",["card","options?"]],
	["canvas.save",["id","frame","options?"]],
	["canvas.screenshot",["options?"]],
	["canvas.export",["of","options?"]],
	["canvas.rename",["title","options?"]],
	["canvas.file",["options?"]],
	["card.list",[]],
	["card.create",["options"]],
	["card.get",["card"]],
	["card.canvases",["card"]],
	["card.url",["card"]],
	["canvas.list",[]],
	["canvas.create",["title"]],
	["canvas.copyShared",["options?"]],
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
	["view.focus",["target...","options?"]],
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
	["apps.delete",["name"]],
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
	["board.list",[]],
	["board.create",["options"]],
	["board.get",["board"]],
	["board.canvases",["board"]],
	["board.url",["board"]],
	["newBoard",["options"]],
	["fit",["path","options?"]],
	["resize",["path","size"]],
	["report",["path..."]],
	["reload",["path"]],
	["boards",[]],
	["show",["target...","options?"]],
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
		// Named at run time, so a bundler making this file into a page leaves Node's modules alone.
		const node = ["node:fs", "node:os", "node:path"];
		const [{ readFileSync }, { homedir }, { join }] = await Promise.all(node.map((name) => import(/* @vite-ignore */ name)));
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
		let response;
		try {
			response = await doFetch(`${base}/api/v1/${verb}`, { method: "POST", headers, body: JSON.stringify({ args: given }) });
		} catch (error) {
			throw new DecksError(`Could not reach Decks at ${base}: ${error.message}`);
		}
		// A refusal at the gate (no token, or one taken back) is a sentence, not the verbs' JSON.
		const text = await response.text().catch(() => "");
		let answer;
		try {
			answer = JSON.parse(text);
		} catch {
			answer = { ok: false, error: text.trim() ? `Decks answered ${response.status}: ${text.trim().slice(0, 400)}` : `Decks answered ${response.status} without a result` };
		}
		const notes = Array.isArray(answer.notes) ? answer.notes : [];
		if (!response.ok || answer.ok === false) throw new DecksError(answer.error || `Decks answered ${response.status}`, { status: response.status, notes });
		return { value: answer.value, notes, images: answer.images };
	}

	/**
	 * Any other door the harness has, with the token: `path` from its root, as in `/api/harness`. A
	 * body that is a Blob (a File, a recording) or bytes goes as it is, with its own type; anything
	 * else as JSON. Answers with the JSON sent back, or `as: "blob"`, `"text"` or `"response"`.
	 */
	async function request(path, opts = {}) {
		const { body, as = "json", signal } = opts;
		const method = opts.method ?? (body === undefined ? "GET" : "POST");
		const headers = { ...(await authHeaders()), ...opts.headers };
		let sent;
		if (body !== undefined) {
			const raw = (typeof Blob !== "undefined" && body instanceof Blob) || body instanceof ArrayBuffer || ArrayBuffer.isView(body);
			sent = raw ? body : JSON.stringify(body);
			headers["content-type"] ??= raw ? body.type || "application/octet-stream" : "application/json";
		}
		let response;
		try {
			response = await doFetch(`${base}${path.startsWith("/") ? "" : "/"}${path}`, { method, headers, ...(sent === undefined ? {} : { body: sent }), ...(signal ? { signal } : {}) });
		} catch (error) {
			if (error?.name === "AbortError") throw error;
			throw new DecksError(`Could not reach Decks at ${base}: ${error.message}`);
		}
		if (as === "response") return response;
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			let said = {};
			try {
				said = JSON.parse(text) ?? {};
			} catch {}
			const error = typeof said.error === "string" ? said.error : text.trim() ? `Decks answered ${response.status}: ${text.trim().slice(0, 400)}` : `Decks answered ${response.status}`;
			throw new DecksError(error, { status: response.status, needsCode: said.needsCode === true });
		}
		if (as === "blob") return response.blob();
		if (as === "text") return response.text();
		const text = await response.text();
		return text ? JSON.parse(text) : undefined;
	}

	/**
	 * Tickets for pages this connection opens in a frame or a tab, which cannot send the token in a
	 * header: by request path, decoded (`/api/board/boards/a.html`, `/api/f/…`, `/app/<name>/`).
	 */
	const held = new Map();
	/** The most paths one ask may name (the harness's `MAX_TICKETS`). */
	const PER_ASK = 200;
	async function tickets(paths) {
		const made = {};
		let expires = Date.now();
		for (let at = 0; at < paths.length; at += PER_ASK) {
			const got = await request("/api/tickets", { body: { paths: paths.slice(at, at + PER_ASK) } });
			for (const [path, ticket] of Object.entries(got.tickets ?? {})) {
				made[path] = ticket;
				held.set(path, { ticket, expires: got.expires });
			}
			expires = got.expires;
		}
		return { tickets: made, expires };
	}
	/** The ticket held for a page, while it has a little time left. */
	const ticketFor = (path) => {
		const one = held.get(path);
		return one && one.expires - Date.now() > 10_000 ? one.ticket : undefined;
	};
	/** A page's address on the harness, with its ticket when there is one. `path` is decoded. */
	const pageUrl = (path, ticket = ticketFor(path)) =>
		`${base}${path.split("/").map(encodeURIComponent).join("/")}${ticket ? `?decks_ticket=${encodeURIComponent(ticket)}` : ""}`;

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
		request,
		/**
		 * Whether a Decks answers here, its name, whether it will want a pairing code, and whether this
		 * connection's token still works (`paired`). Open to anyone: no token needed.
		 */
		hello() {
			return request("/api/hello");
		},
		/**
		 * Pair a page on another site with this harness (`POST /api/pair`): a site token back, bound to the
		 * page's origin, and the harness's name. A thrown DecksError with `needsCode` wants a code from `decks pair code`.
		 */
		pairSite(given = {}) {
			return request("/api/pair", { body: { label: given.label ?? "Another Decks", ...(given.code ? { code: given.code } : {}) } });
		},
		/**
		 * Decks Studio connecting this harness in one call, at the one pairing door (`POST /api/pair`):
		 * Studio's address and the key to sync with, and a harness token as that site back. `needsCode` as
		 * for `pairSite`.
		 */
		connectStudio(given) {
			return request("/api/pair", { body: { studio: given.studio, key: given.key, label: given.label ?? "Decks Studio", ...(given.code ? { code: given.code } : {}) } });
		},
		/**
		 * A canvas pass for one canvas (`POST /api/passes`): what a canvas frame holds, an hour, bound to
		 * this connection's token. Its calls send it as the bearer; its files are read at
		 * `pageUrl("/api/t/<pass>/board/<deck path>", "")`. Ask again at half its life.
		 */
		async canvasPass(canvas) {
			const said = await request("/api/passes", { body: { canvas } });
			if (typeof said?.pass !== "string") throw new DecksError(`Decks gave no pass for the canvas ${canvas}.`);
			return { pass: said.pass, role: said.role === "view" ? "view" : "edit", expires: Number(said.expires) };
		},
		/**
		 * An app's address for a tab of its own, with an app pass in it (`POST /api/passes { app }`): what
		 * another site opens an app with. The pass is good for a day, while this connection's token is.
		 */
		async appUrl(name) {
			const said = await request("/api/passes", { body: { app: name } });
			if (typeof said?.url !== "string") throw new DecksError(`Decks would not open the app ${name}.`);
			return `${base}${said.url}`;
		},
		/**
		 * Put a file into the deck's `assets/`, for an agent to read, or with `canvas` into that canvas's
		 * own `files/` (a friend's canvas you may edit included, which syncs it back to them): its deck
		 * path back. In the canvas's drawing it is `files/<name>`. A canvas shared with you to view refuses.
		 */
		async upload(file, given = {}) {
			const name = given.name ?? file.name ?? "pasted";
			const canvas = given.canvas ? `&canvas=${encodeURIComponent(given.canvas)}` : "";
			const said = await request(`/api/upload?name=${encodeURIComponent(name || "pasted")}${canvas}`, { body: file });
			if (typeof said?.path !== "string") throw new DecksError(`Could not upload ${name}.`);
			return said.path;
		},
		tickets,
		ticketFor,
		pageUrl,
		/** A page's address with a fresh ticket, for a tab about to open it. Throws if the harness will not open it. */
		async ticketedUrl(path) {
			const ticket = (await tickets([path])).tickets[path];
			if (!ticket) throw new DecksError("Decks would not open that page.");
			return pageUrl(path, ticket);
		},
		/**
		 * Keep tickets for pages that stay shown: `want(paths)` asks for any not held at once, and every
		 * path wanted is asked for again every four minutes (a ticket lasts five), and when a page in a
		 * browser comes back into view. `onChange` hears each batch that came. `stop()` ends it.
		 */
		keepTickets(onChange, given = {}) {
			let wanted = [];
			const asking = new Set();
			const ask = async (paths) => {
				const fresh = paths.filter((one) => !asking.has(one));
				if (!fresh.length) return;
				for (const one of fresh) asking.add(one);
				try {
					const got = await tickets(fresh);
					if (Object.keys(got.tickets).length) onChange?.(got.tickets);
				} catch {
					// Out of reach, or a harness from before tickets: asked again at the next round.
				} finally {
					for (const one of fresh) asking.delete(one);
				}
			};
			const again = () => wanted.length && void ask(wanted);
			const timer = setInterval(again, given.every ?? 4 * 60_000);
			// A tab back from the background, or a laptop from sleep, may hold tickets that ran out meanwhile.
			const back = () => typeof document !== "undefined" && document.visibilityState === "visible" && again();
			if (typeof document !== "undefined") document.addEventListener("visibilitychange", back);
			return {
				want(paths) {
					wanted = [...new Set(paths)];
					const missing = wanted.filter((one) => !ticketFor(one));
					if (missing.length) void ask(missing);
				},
				stop() {
					clearInterval(timer);
					if (typeof document !== "undefined") document.removeEventListener("visibilitychange", back);
				},
			};
		},
		/**
		 * Every change as Decks broadcasts it (`GET /api/v1/events`): `onEvent` hears each frame, as
		 * in `{ type: "board.changed", path, board }`. `types` keeps only some. Read with fetch, so the
		 * token goes in its header, never the address. With `reconnect` a stream that ends or fails is
		 * opened again, a little later each time up to 15 s, until a refusal (401, 403), which calls
		 * `refused`. Answers with a way to stop.
		 */
		events(onEvent, given = {}) {
			const controller = new AbortController();
			const types = given.types?.length ? `?types=${encodeURIComponent(given.types.join(","))}` : "";
			const once = async () => {
				const response = await request(`/api/v1/events${types}`, { as: "response", headers: { accept: "text/event-stream" }, signal: controller.signal });
				if (!response.ok || !response.body) throw new DecksError(`Decks answered ${response.status} for its events`, { status: response.status });
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				for (;;) {
					const { value, done: ended } = await reader.read();
					if (ended) return;
					buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
					let gap;
					while ((gap = buffer.indexOf("\n\n")) >= 0) {
						const block = buffer.slice(0, gap);
						buffer = buffer.slice(gap + 2);
						// `event:` names the frame, which its JSON names too; `:` lines keep the stream open.
						const data = block
							.split("\n")
							.filter((line) => line.startsWith("data:"))
							.map((line) => line.slice(5).replace(/^ /, ""))
							.join("\n");
						if (data) onEvent(JSON.parse(data));
					}
				}
			};
			const done = (async () => {
				if (!given.reconnect) return once();
				let wait = 1000;
				while (!controller.signal.aborted) {
					try {
						await once();
						wait = 1000;
					} catch (error) {
						if (controller.signal.aborted) return;
						if (error?.status === 401 || error?.status === 403) {
							given.refused?.();
							return;
						}
					}
					await new Promise((resolve) => setTimeout(resolve, wait));
					wait = Math.min(wait * 2, 15_000);
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";

/**
 * Port forwarding, the way Open OnDemand does it: a server running on this machine is reached
 * through Decks' own address, so a board can show it in a frame.
 *
 * - `/node/localhost/<port>/…` sends the path on **as it came**, for a server told it lives
 *   under that base path (VS Code's `--server-base-path`, Jupyter's `base_url`).
 * - `/rnode/localhost/<port>/…` takes the prefix **off**, for a server that thinks it is at the
 *   root (most dev servers).
 *
 * Websockets go through both. Only `127.0.0.1` is ever dialled, whatever host the URL names.
 *
 * **A port is forwarded only once an agent opens it** (`stage.ports`), and stays open until one
 * closes it; the list is kept in `.decks/ports.json` so a restart keeps it. Decks has no sign-in
 * (DEPLOYMENT §1): whoever can open the app can open what it forwards, and a forwarded VS Code
 * is a shell. That is the same reach an agent's own shell already gives, which is why agents
 * manage the list, and why nothing is forwarded until one asks. Decks' own port is refused.
 *
 * **Same origin as the app.** A forwarded page is served from Decks' origin, so it can read what
 * the app keeps in the browser and open `/ws`, as any board already can.
 */

export interface Forward {
	port: number;
	/** What it is, in a few words: "VS Code on decks-pen". */
	label?: string;
	/** The agent that opened it. */
	by?: string;
	at: number;
}

const ROUTE = /^\/(r?node)\/([^/?]+)\/(\d{1,5})(\/[^?]*)?(\?.*)?$/;

/** Where a request goes: the port and the path the server there should see, or nothing. */
export function forwardTarget(url: string): { port: number; path: string } | undefined {
	const match = ROUTE.exec(url);
	if (!match) return undefined;
	const [, kind, host, digits, tail = "/", query = ""] = match;
	const port = Number(digits);
	if (port < 1 || port > 65535) return undefined;
	const path = kind === "node" ? `/node/${host}/${port}${tail}` : tail;
	return { port, path: `${path}${query}` };
}

/** The open forwards, kept on disk beside the deck's other state. */
export class Forwards {
	private file: string;
	private list: Forward[];

	constructor(
		deckPath: string,
		/** Decks' own port, which is never forwarded: it would be the app framing itself. */
		private readonly own: number,
	) {
		this.file = join(deckPath, ".decks", "ports.json");
		this.list = this.load();
	}

	setDeck(deckPath: string): void {
		this.file = join(deckPath, ".decks", "ports.json");
		this.list = this.load();
	}

	all(): Forward[] {
		return this.list.map((one) => ({ ...one }));
	}

	isOpen(port: number): boolean {
		return this.list.some((one) => one.port === port);
	}

	/** Open a port, or say why not. Opening one that is open again updates its label. */
	open(port: unknown, options: { label?: string; by?: string } = {}): Forward {
		if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
			throw new Error("A port is a whole number from 1 to 65535, as in stage.ports({ open: 8766 }).");
		}
		if (port === this.own) throw new Error(`Port ${port} is Decks itself, and is not forwarded.`);
		const label = typeof options.label === "string" && options.label.trim() ? options.label.trim().slice(0, 80) : undefined;
		const next: Forward = { port, ...(label ? { label } : {}), ...(options.by ? { by: options.by } : {}), at: Date.now() };
		this.list = [...this.list.filter((one) => one.port !== port), next].sort((a, b) => a.port - b.port);
		this.save();
		return { ...next };
	}

	/** Close a port. Answers whether it was open. */
	close(port: unknown): boolean {
		const before = this.list.length;
		this.list = this.list.filter((one) => one.port !== port);
		if (this.list.length === before) return false;
		this.save();
		return true;
	}

	private load(): Forward[] {
		try {
			if (!existsSync(this.file)) return [];
			const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
			if (!Array.isArray(raw)) return [];
			return raw.filter((one): one is Forward => typeof one?.port === "number" && Number.isInteger(one.port) && one.port !== this.own);
		} catch {
			return [];
		}
	}

	private save(): void {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, `${JSON.stringify(this.list, null, "\t")}\n`, "utf8");
	}
}

/** Forward one request. Answers whether it was a `/node/` or `/rnode/` request at all. */
export function forwardRequest(req: IncomingMessage, res: ServerResponse, forwards: Forwards): boolean {
	const target = forwardTarget(req.url ?? "/");
	if (!target) return false;
	if (!forwards.isOpen(target.port)) {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end(`Port ${target.port} is not forwarded. An agent opens it with stage.ports({ open: ${target.port} }).`);
		return true;
	}
	const upstream = httpRequest({ host: "127.0.0.1", port: target.port, method: req.method, path: target.path, headers: withForwarding(req) }, (answer) => {
		res.writeHead(answer.statusCode ?? 502, answer.headers);
		answer.pipe(res);
	});
	upstream.on("error", (error) => {
		if (res.headersSent) return void res.destroy();
		res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
		res.end(`Nothing answered on port ${target.port}: ${error.message}`);
	});
	req.pipe(upstream);
	return true;
}

/** Forward a websocket upgrade. Answers whether it was a `/node/` or `/rnode/` one at all. */
export function forwardUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, forwards: Forwards): boolean {
	const target = forwardTarget(req.url ?? "/");
	if (!target) return false;
	if (!forwards.isOpen(target.port)) {
		socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
		return true;
	}
	const upstream = connect(target.port, "127.0.0.1", () => {
		const lines = [`${req.method ?? "GET"} ${target.path} HTTP/1.1`];
		for (const [name, value] of Object.entries(withForwarding(req))) {
			for (const one of Array.isArray(value) ? value : [value]) if (one !== undefined) lines.push(`${name}: ${one}`);
		}
		upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
		if (head.length > 0) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
	const close = () => {
		upstream.destroy();
		socket.destroy();
	};
	upstream.on("error", close);
	socket.on("error", close);
	socket.on("close", () => upstream.destroy());
	upstream.on("close", () => socket.destroy());
	return true;
}

/** The request's own headers, plus the ones that say where it really came from. */
function withForwarding(req: IncomingMessage): Record<string, string | string[] | undefined> {
	const headers: Record<string, string | string[] | undefined> = { ...req.headers };
	const host = req.headers["x-forwarded-host"] ?? req.headers.host;
	if (host) headers["x-forwarded-host"] = host;
	headers["x-forwarded-proto"] = req.headers["x-forwarded-proto"] ?? "http";
	headers["x-forwarded-for"] = req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "";
	return headers;
}

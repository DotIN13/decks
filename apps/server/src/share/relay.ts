import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import type { Request, Response } from "express";

/**
 * Another Decks server, passed through this one, for a page that has no service worker.
 *
 * A board's page has to come from the app's own address (`web/src/connections`). On HTTPS or
 * localhost the service worker does that in the browser; on a plain `http://` address on a network
 * the browser has no service workers, so this server does it instead: the page tells it which
 * server `/c/<id>/` stands for, with that server's token, and every request under the prefix is
 * fetched from there and handed back.
 *
 * Only this server's own front end may register a connection (the cross-site guard in `http.ts`
 * refuses anyone else before this is reached), and only registered ones are passed through, so it
 * is not a way for a page to make this server fetch an address of its choosing. Kept on disk beside
 * the pairing tokens, readable only by this user, so a restart does not leave an open page asking
 * for a connection the server has forgotten.
 */
interface Target {
	base: string;
	token: string;
}

const PASSED = ["content-type", "cache-control", "content-disposition", "content-security-policy", "x-decks-stand-in", "last-modified", "etag"];

export class Relay {
	private readonly targets = new Map<string, Target>();

	constructor(private readonly file?: string) {
		if (!file || !existsSync(file)) return;
		try {
			const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, Target>;
			for (const [id, target] of Object.entries(saved)) if (typeof target?.base === "string" && typeof target?.token === "string") this.targets.set(id, target);
		} catch {
			// A damaged file is no relays: each page registers its own again.
		}
	}

	private save(): void {
		if (!this.file) return;
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(this.file, `${JSON.stringify(Object.fromEntries(this.targets), null, "\t")}\n`, { mode: 0o600 });
	}

	register(id: string, base: string, token: string): string | undefined {
		if (!/^[a-z0-9]{4,32}$/.test(id)) return "That is not a connection id.";
		let url: URL;
		try {
			url = new URL(base);
		} catch {
			return "That is not an address.";
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https servers can be relayed.";
		const target = { base: base.replace(/\/+$/, ""), token };
		const known = this.targets.get(id);
		if (known?.base === target.base && known.token === target.token) return undefined;
		this.targets.set(id, target);
		this.save();
		return undefined;
	}

	async pass(req: Request, res: Response): Promise<void> {
		const id = String(req.params.id ?? "");
		const target = this.targets.get(id);
		if (!target) {
			res.status(404).type("text").send("This server does not know that connection. Reload the page.");
			return;
		}
		const rest = req.originalUrl.slice(`/c/${id}`.length) || "/";
		const headers: Record<string, string> = { Authorization: `Bearer ${target.token}` };
		for (const name of ["accept", "content-type", "range"]) {
			const value = req.headers[name];
			if (typeof value === "string") headers[name] = value;
		}
		// JSON was already read by `express.json`; anything else, an upload, is still the request stream.
		const parsed = req.is("application/json") && req.body !== undefined;
		const body = req.method === "GET" || req.method === "HEAD" ? undefined : parsed ? JSON.stringify(req.body) : Readable.toWeb(req);
		let answer: globalThis.Response;
		try {
			answer = await fetch(`${target.base}${rest}`, { method: req.method, headers, ...(body ? { body: body as RequestInit["body"], duplex: "half" } : {}), redirect: "follow" } as RequestInit);
		} catch (error) {
			res.status(502).type("text").send(`Could not reach ${target.base}: ${(error as Error).message}`);
			return;
		}
		res.status(answer.status);
		for (const name of PASSED) {
			const value = answer.headers.get(name);
			if (value) res.setHeader(name, value);
		}
		if (!answer.body) {
			res.end();
			return;
		}
		const stream = Readable.fromWeb(answer.body as import("node:stream/web").ReadableStream);
		res.on("close", () => stream.destroy());
		stream.pipe(res);
	}
}

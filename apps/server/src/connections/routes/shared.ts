import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { SHARED_SANDBOX } from "@decks/hub/layout";
import type { App } from "../../app.ts";
import type { Relay } from "../../share/relay.ts";
import { squeezedFile } from "../static.ts";

/** What a route module is given: the app, and the relay its `/c/<id>/` connections go through. */
export interface RouteDeps {
	app: App;
	relay: Relay;
}

export function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
	return (req: Request, res: Response, next: NextFunction) => {
		handler(req, res).catch(next);
	};
}

/**
 * A friend's card, or anything else from a canvas shared with you, is someone else's page on your
 * machine: sent with a sandbox of its own, so it has a blank origin wherever it is opened, a frame or
 * a tab, and can reach nothing of the harness's (`deck/layout.ts`).
 */
export function sharedHeaders(res: Response): void {
	res.setHeader("Content-Security-Policy", `sandbox ${SHARED_SANDBOX}`);
	res.setHeader("Referrer-Policy", "no-referrer");
}

/** The wildcard segment of `/api/card/*path`, as one forward-slashed string. */
export function wildcard(req: Request): string {
	const raw = (req.params as Record<string, string | string[]>).path;
	return Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
}

/**
 * Send a file of the deck. A text file (a card's page, stylesheet, module or data) goes squeezed to a
 * browser that takes it (`connections/static.ts`, `squeezedFile`): a frame fetches a card's files whole
 * every time it starts, with no cache to ask. Everything else, and a request for part of a file, goes
 * as it is on disk.
 */
export function sendFile(res: Response, target: string): Promise<void> {
	const req = res.req;
	const small = req?.method === "GET" ? squeezedFile(target, req.headers["accept-encoding"] as string | undefined, req.headers.range) : undefined;
	if (small) {
		res.setHeader("Vary", "Accept-Encoding");
		res.setHeader("ETag", small.etag);
		if (!res.getHeader("Cache-Control")) res.setHeader("Cache-Control", "no-cache");
		if (req.headers["if-none-match"] === small.etag) {
			res.status(304).end();
			return Promise.resolve();
		}
		if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", small.type);
		res.setHeader("Content-Encoding", small.encoding);
		res.setHeader("Content-Length", String(small.body.length));
		res.end(small.body);
		return Promise.resolve();
	}
	return new Promise((ok, fail) => {
		res.sendFile(target, { acceptRanges: true, dotfiles: "allow" }, (error) => (error ? fail(error) : ok()));
	});
}

/**
 * Which harness this is, as a copy on the clipboard says it (`canvas.clip`): a paste within the same
 * harness is its to make. Its deck folder, hashed, so it is the same across restarts and says nothing of where.
 */
export function harnessId(deck: string): string {
	return `h_${createHash("sha256").update(deck).digest("hex").slice(0, 16)}`;
}

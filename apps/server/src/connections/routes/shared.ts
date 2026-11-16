import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { NextFunction, Request, Response } from "express";
import { SHARED_SANDBOX } from "@decks/hub/layout";
import type { App } from "../../app.ts";
import type { Relay } from "../../share/relay.ts";

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

export function sendFile(res: Response, target: string): Promise<void> {
	return new Promise((ok, fail) => {
		res.sendFile(target, { acceptRanges: true, dotfiles: "allow" }, (error) => (error ? fail(error) : ok()));
	});
}


/** The commit this harness runs, short, read once; "" when it is not a git checkout. */
let version: string | undefined;
export function harnessVersion(): string {
	if (version !== undefined) return version;
	try {
		version = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.env.DECKS_APP_DIR ?? process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		version = "";
	}
	return version;
}

/**
 * Which harness this is, as a copy on the clipboard says it (`canvas.clip`): a paste within the same
 * harness is its to make. Its deck folder, hashed, so it is the same across restarts and says nothing of where.
 */
export function harnessId(deck: string): string {
	return `h_${createHash("sha256").update(deck).digest("hex").slice(0, 16)}`;
}

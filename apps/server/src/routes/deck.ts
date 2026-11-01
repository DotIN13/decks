import type { RouteDeps } from "./shared.ts";
import type { Router } from "express";
import { runVerb } from "../verbs/router.ts";

/**
 * The deck: the relay's connections and the deck's state.
 */
export function register(api: Router, { app, relay }: RouteDeps): void {
	/**
	 * Pass another server through this one, for a page with no service worker (`share/relay.ts`).
	 * The page names the connection and its token; `/c/<id>/...` below is then that server's.
	 */
	api.post("/relay", (req, res) => {
		const body = (req.body ?? {}) as { id?: unknown; base?: unknown; token?: unknown };
		const refused = typeof body.id === "string" && typeof body.base === "string" && typeof body.token === "string" ? relay.register(body.id, body.base, body.token) : "Name the connection, its address and its token.";
		if (refused) {
			res.status(400).json({ error: refused });
			return;
		}
		res.json({ ok: true });
	});

	// Kept one release as an alias of deck.get.
	api.get("/deck", async (req, res) => {
		const { status, answer } = await runVerb(app, req.principal, req.headers, "deck.get", [], req.socket.remoteAddress);
		if (!answer.ok) res.status(status).json({ error: answer.error });
		else res.json(answer.value);
	});
}

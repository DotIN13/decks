import { PathRefused } from "../deck/roots.ts";
import { asyncRoute, type RouteDeps } from "./shared.ts";
import type { Router } from "express";

/**
 * The deck: a board deleted from another front end, the relay's connections, the deck's state and a board's past versions.
 */
export function register(api: Router, { app, relay }: RouteDeps): void {
	/**
	 * Delete a board's file, for another front end's board pill (Studio): what this app's own page sends
	 * on its socket (`board.delete`). A revision of it is kept first, as there.
	 */
	api.post("/boards/delete", (req, res) => {
		const path = String(((req.body ?? {}) as { path?: unknown }).path ?? "");
		let refused: string | undefined;
		app.boards.deleteBoard(path, (message) => {
			if (message.type === "notice") refused = message.text;
		});
		if (refused) res.status(/no board/i.test(refused) ? 404 : 409).json({ error: refused });
		else res.json({ path, deleted: true });
	});

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

	api.get("/deck", (_req, res) => {
		res.json({ deck: app.deck.state(), warnings: app.deck.warnings });
	});

	/**
	 * One past version of a board, by content hash (§6.7).
	 *
	 * This is what lets the timeline show what a board looked like at a point in the
	 * conversation without writing anything: the frame loads a revision instead of
	 * the file. Same quarantine headers as any other stored document.
	 */
	api.get(
		"/revision/:sha",
		asyncRoute(async (req, res) => {
			const sha = String(req.params.sha);
			if (!app.boards.revisions.has(sha)) throw new PathRefused(sha, "no such revision");
			res.setHeader("X-Content-Type-Options", "nosniff");
			// Immutable by construction: the name is the hash of the contents.
			res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
			res.type("html").send(app.boards.revisions.read(sha));
		}),
	);
}

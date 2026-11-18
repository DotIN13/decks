import type { Response, Router } from "express";
import { asyncRoute, type RouteDeps } from "./shared.ts";

/**
 * Decks Studio's sign-in coming back (`studio/login.ts`): the tab the person's browser opened on
 * Studio is sent here by the page's button, with the code Studio shows, and the harness trades the
 * code for its key. A door
 * (`auth/guard.ts`): the tab comes from Studio's site with no token of this harness's, and what lets
 * it in is the `state` only this harness and that tab know. That it is on this machine is Studio's
 * rule and the sign-in's own (a redirect is asked for, and given, only to a loopback address); it is
 * not checked again here, where a page served through a proxy on this machine would fail it.
 */
export function register(api: Router, { app }: RouteDeps): void {
	const page = (res: Response, title: string, said: string, ok: boolean) =>
		res
			.status(ok ? 200 : 400)
			.type("html")
			.setHeader("Cache-Control", "no-store")
			.send(`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Decks Studio</title><body style="font:16px system-ui;margin:15vh auto;max-width:28em;line-height:1.5;padding:0 1em"><h1 style="font-size:22px">${escape(title)}</h1><p>${escape(said)}</p><p style="color:#777">You can close this tab.</p>${ok ? "<script>setTimeout(() => window.close(), 1500)</script>" : ""}</body>`);
	api.get(
		"/studio/callback",
		asyncRoute(async (req, res) => {
			try {
				const got = await app.studioLogin.finish(String(req.query.code ?? ""), String(req.query.state ?? ""));
				page(res, "Signed in to Decks Studio", `This Decks now syncs with ${got.url}${got.account.email ? ` as ${got.account.email}` : ""}.`, true);
			} catch (error) {
				page(res, "Not signed in", (error as Error).message, false);
			}
		}),
	);
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

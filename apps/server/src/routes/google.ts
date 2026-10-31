import { asyncRoute, type RouteDeps } from "./shared.ts";
import { type Response, type Router } from "express";

/**
 * Google Docs (`google/`): signing in as the person, the pictures in a Doc's page, and the agents' Google Docs tools.
 */
export function register(api: Router, { app }: RouteDeps): void {
	/*
	 * Google Docs (`google/`): signing in as the person, the pictures in a Doc's page, and the
	 * agents' Google Docs tools. The sign-in is started by the page with its own origin, since
	 * behind a proxy this server cannot tell what address the browser used to reach it.
	 */
	api.get("/google/status", (_req, res) => {
		res.setHeader("Cache-Control", "no-store");
		res.json(app.google.state());
	});
	api.get("/google/signin", (req, res) => {
		const origin = typeof req.query.origin === "string" && /^https?:\/\/[^/\s]+$/.test(req.query.origin) ? req.query.origin : `${req.protocol}://${req.get("host")}`;
		try {
			res.redirect(302, app.google.auth.signInUrl(origin));
		} catch (error) {
			res.status(400).type("text/plain").send((error as Error).message);
		}
	});
	const signedIn = (res: Response, said: string, ok: boolean) =>
		res
			.status(ok ? 200 : 400)
			.type("html")
			.send(`<!doctype html><meta charset="utf-8"><title>Google</title><body style="font:16px system-ui;margin:15vh auto;max-width:28em;line-height:1.5"><h1 style="font-size:22px">${ok ? "Signed in" : "Not signed in"}</h1><p>${said.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</p><p>You can close this tab and go back to Decks.</p></body>`);
	api.get(
		"/google/callback",
		asyncRoute(async (req, res) => {
			try {
				const email = await app.google.auth.finish({ code: String(req.query.code ?? ""), state: String(req.query.state ?? ""), ...(req.query.error ? { url: `http://x/?error=${String(req.query.error)}` } : {}) });
				signedIn(res, `Decks can now read and edit the Google Docs ${email} can.`, true);
			} catch (error) {
				signedIn(res, (error as Error).message, false);
			}
		}),
	);
	api.post(
		"/google/code",
		asyncRoute(async (req, res) => {
			try {
				const email = await app.google.auth.finish({ url: String((req.body as { url?: unknown })?.url ?? "") });
				res.json({ ok: true, email });
			} catch (error) {
				res.json({ ok: false, message: (error as Error).message });
			}
		}),
	);
	/** The person's Google Docs for the file picker, the ones they looked at last first; `q` narrows them by name. */
	api.get(
		"/google/docs",
		asyncRoute(async (req, res) => {
			res.setHeader("Cache-Control", "no-store");
			if (!app.google.state().signedIn) {
				res.status(401).json({ error: "Not signed in to Google." });
				return;
			}
			try {
				res.json({ docs: await app.google.api().list(typeof req.query.q === "string" ? req.query.q : undefined) });
			} catch (error) {
				res.status(502).json({ error: (error as Error).message });
			}
		}),
	);
	api.post("/google/signout", (_req, res) => {
		app.google.auth.signOut();
		res.json({ ok: true });
	});
	api.get(
		"/google/image/:doc/:object",
		asyncRoute(async (req, res) => {
			const doc = await app.google.api().get(String(req.params.doc)).catch(() => undefined);
			const uri = doc?.inlineObjects?.[String(req.params.object)]?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
			const fetched = uri ? await fetch(uri).catch(() => undefined) : undefined;
			if (!fetched?.ok) {
				res.status(404).end();
				return;
			}
			res.setHeader("Content-Type", fetched.headers.get("content-type") ?? "image/png");
			res.setHeader("Cache-Control", "private, max-age=600");
			res.end(Buffer.from(await fetched.arrayBuffer()));
		}),
	);
	/*
	 * The agents' Google Docs tools, for a runtime outside this process (opencode, antigravity),
	 * with the same identity as the canvas tool: a token per agent, or opencode's session id.
	 */
	api.post(
		"/gdocs/call",
		asyncRoute(async (req, res) => {
			const header = req.headers.authorization;
			const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : undefined;
			const body = (req.body ?? {}) as { tool?: unknown; args?: unknown; sessionID?: unknown };
			const agentId = app.bridge.agentFor(token, typeof body.sessionID === "string" ? body.sessionID : undefined);
			if (!agentId) {
				res.json({ text: "This tool's token is not valid any more. The agent it belonged to has gone.", isError: true });
				return;
			}
			res.json(await app.google.tool(String(body.tool ?? ""), (body.args ?? {}) as Record<string, unknown>, app.agentName(agentId)));
		}),
	);
}

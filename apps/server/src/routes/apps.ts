import { SDK_FILE } from "../apps/service.ts";
import { type RouteDeps } from "./shared.ts";
import { type Request, type Response, type Router } from "express";

/**
 * The deck's apps (`apps/service.ts`) and the SDK an app's page imports.
 */
export function register(api: Router, { app }: RouteDeps): void {
	/*
	 * The deck's apps (`apps/service.ts`), for the bar on an app's board (`lib/live-app.js`): what
	 * each is doing, its log, that its board is still in view, and the bar's Restart.
	 */
	const appOf = (req: Request, res: Response): string | undefined => {
		const name = String(req.params.name ?? "");
		if (app.apps.exists(name)) return name;
		res.status(404).json({ error: `There is no app called ${name}.` });
		return undefined;
	};
	api.get("/apps", (_req, res) => {
		res.json({ apps: app.apps.list() });
	});
	api.get("/apps/:name", (req, res) => {
		const name = appOf(req, res);
		if (name) res.set("cache-control", "no-store").json(app.apps.state(name));
	});
	api.get("/apps/:name/log", (req, res) => {
		const name = appOf(req, res);
		if (name) res.set("cache-control", "no-store").json({ lines: app.apps.log(name, Number(req.query.tail) || 200) });
	});
	/*
	 * An app's board saying it is on screen, which keeps a server app awake. A read as well as a post:
	 * a board's page has no token (`auth/guard.ts` lets this read in), and a heartbeat is no more than the
	 * request from its frame that would wake the app anyway.
	 */
	const seen = (req: Request, res: Response) => {
		const name = appOf(req, res);
		if (!name) return;
		app.apps.seen(name);
		res.set("cache-control", "no-store").json({ ok: true });
	};
	api.get("/apps/:name/seen", seen);
	api.post("/apps/:name/seen", seen);

	/**
	 * The SDK, for an app's page: `import { decks } from "../../api/sdk/decks.mjs"`. It is one file
	 * with no dependencies (`packages/sdk`), and a server app is told its path on disk instead.
	 */
	api.get("/sdk/decks.mjs", (_req, res) => {
		res.setHeader("Cache-Control", "no-cache");
		res.type("text/javascript").sendFile(SDK_FILE);
	});

	api.post("/apps/:name/restart", async (req, res) => {
		const name = appOf(req, res);
		if (!name) return;
		app.apps.stop(name);
		res.json(await app.apps.run(name, 30_000));
	});
}

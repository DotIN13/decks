import type { Router, Request, Response } from "express";
import { asyncRoute, type RouteDeps } from "./shared.ts";
import { runVerb } from "../verbs/router.ts";

/** `/api/harness…`, kept one release as aliases of the person's verbs for Decks Studio's Settings page. */
export function register(api: Router, { app }: RouteDeps): void {
	const run = async (req: Request, res: Response, verb: string, args: unknown[], shape: (value: unknown) => unknown = (value) => value, failed = 400) => {
		const { status, answer } = await runVerb(app, req.principal, req.headers, verb, args, req.socket.remoteAddress, req.tokenId ? { tokenId: req.tokenId } : undefined);
		if (!answer.ok) {
			res.status(status === 422 ? failed : status).json({ error: answer.error });
			return;
		}
		res.set("cache-control", "no-store").json(shape(answer.value));
	};
	api.get("/harness", asyncRoute((req, res) => run(req, res, "harness.get", [])));
	api.post("/harness", asyncRoute((req, res) => run(req, res, "harness.configure", [req.body ?? {}], () => ({ ok: true }))));
	api.post("/harness/paired/:id/revoke", asyncRoute((req, res) => run(req, res, "harness.revoke", [String(req.params.id)], () => ({ revoked: true }), 404)));
	api.post("/harness/extension/code", asyncRoute((req, res) => run(req, res, "web.repair", [])));
	api.post("/harness/accounts/:id/forget", asyncRoute((req, res) => run(req, res, "account.forget", [String(req.params.id)], () => ({ forgotten: true }))));
}

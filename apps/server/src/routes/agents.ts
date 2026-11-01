import type { Router, Request, Response } from "express";
import { asyncRoute, type RouteDeps } from "./shared.ts";
import { runVerb } from "../verbs/router.ts";

/**
 * `/api/agents/:id/…`, kept one release as aliases of the person's verbs (`@decks/api`, `PERSON_VERBS`)
 * for Decks Studio and a page of the release before. Each runs the verb as `POST /api/v1/<verb>` would,
 * for the request's token, and answers the shape the route always answered.
 */
export function register(api: Router, { app }: RouteDeps): void {
	const run = async (req: Request, res: Response, verb: string, args: unknown[], shape: (value: unknown) => unknown = (value) => value, failed = 400) => {
		const { status, answer } = await runVerb(app, req.principal, req.headers, verb, args, req.socket.remoteAddress);
		if (!answer.ok) {
			res.status(status === 422 ? failed : status).json({ error: answer.error });
			return;
		}
		res.set("cache-control", "no-store").json(shape(answer.value));
	};
	const id = (req: Request) => String(req.params.id);
	const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

	api.get("/agents/:id/history", asyncRoute((req, res) => run(req, res, "chat.open", [id(req)], (v) => ({ items: (v as { items?: unknown[] })?.items ?? [], more: (v as { more?: boolean })?.more ?? false }), 404)));
	api.get("/agents/:id/earlier", asyncRoute((req, res) => run(req, res, "chat.earlier", [id(req), { before: String(req.query.before ?? ""), limit: Number(req.query.limit) || 60 }], undefined, 404)));
	api.get("/agents/:id/tool/:item", asyncRoute((req, res) => run(req, res, "chat.tool", [id(req), String(req.params.item)])));
	api.get("/agents/:id/dialogs", asyncRoute((req, res) => run(req, res, "agent.dialogs", [id(req)], undefined, 404)));
	api.get("/agents/:id/settings", asyncRoute((req, res) => run(req, res, "agent.settings", [id(req), { ...(req.query.limits ? { limits: true } : {}) }], undefined, 404)));

	api.post(
		"/agents/:id/:act",
		asyncRoute(async (req, res) => {
			const act = String(req.params.act);
			const given = body(req);
			const agentId = id(req);
			switch (act) {
				case "prompt": {
					const text = String(given.text ?? "");
					if (!text.trim()) return void res.status(400).json({ error: "Say something to send." });
					return run(req, res, "chat.send", [agentId, { text, ...(typeof given.canvas === "string" && given.canvas ? { canvas: given.canvas } : {}) }], () => ({ id: agentId, sent: true }), 404);
				}
				case "rewind": {
					const entryId = String(given.entryId ?? "");
					if (!entryId) return void res.status(400).json({ error: "Name the message, by its entry." });
					return run(req, res, "chat.rewind", [agentId, entryId], (v) => ((v as { cancelled?: boolean })?.cancelled ? { cancelled: true } : { rewound: true, ...((v as { editorText?: string })?.editorText ? { editorText: (v as { editorText?: string }).editorText } : {}) }));
				}
				case "fork": {
					const entryId = String(given.entryId ?? "");
					if (!entryId) return void res.status(400).json({ error: "Name the message, by its entry." });
					return run(req, res, "chat.fork", [agentId, entryId], undefined, 409);
				}
				case "reset":
					return run(req, res, "agent.reset", [agentId], () => ({ id: agentId, reset: true }));
				case "workspace": {
					const workspace = given.workspace;
					if (!(workspace === null || typeof workspace === "string")) return void res.status(400).json({ error: "A workspace is a name, or null for none." });
					return run(req, res, "agent.set", [agentId, { workspace: workspace === "" ? null : workspace }], () => ({ id: agentId, workspace: app.agents.get(agentId)?.workspace ?? null }));
				}
				case "dialog":
					if (typeof given.id !== "string") return void res.status(400).json({ error: "An answer names the question it answers." });
					return run(req, res, "agent.answer", [given], () => ({ answered: given.id }));
				case "rename":
					return run(req, res, "agent.set", [agentId, { name: String(given.name ?? "") }], () => ({ id: agentId, name: app.agents.get(agentId)?.chat().name }), 409);
				case "queue":
					return run(req, res, "chat.queue", [agentId, given], () => ({ id: agentId, ...app.agents.get(agentId)?.queuedMine() }));
				case "stop":
					return run(req, res, "chat.abort", [agentId], () => ({ id: agentId, stopped: true }));
				case "remove":
					return run(req, res, "agent.remove", [agentId], () => ({ id: agentId, removed: true }), 409);
				case "model":
					if (typeof given.provider !== "string" || typeof given.model !== "string") return void res.status(400).json({ error: "Say which provider and model." });
					return run(req, res, "agent.set", [agentId, { model: { provider: given.provider, model: given.model, ...(typeof given.thinking === "string" ? { thinking: given.thinking } : {}) } }], () => ({ id: agentId, model: app.agents.get(agentId)?.model ?? null }));
				case "thinking":
					return run(req, res, "agent.set", [agentId, { thinking: String(given.thinking ?? "") }], () => ({ id: agentId, model: app.agents.get(agentId)?.model ?? null }));
				case "mode":
					return run(req, res, "agent.set", [agentId, { mode: String(given.mode ?? "") }], () => ({ id: agentId, mode: app.agents.get(agentId)?.mode ?? null }));
				case "account":
					return run(req, res, "account.use", [String(given.id ?? ""), agentId], () => ({ id: agentId, account: String(given.id ?? "") }));
				default:
					res.status(404).json({ error: `No such action: ${act}.` });
			}
		}),
	);
}

import { PERSON_VERBS, signature, VERBS } from "@decks/api";
import express, { type Request, type Response } from "express";
import { bearerOf } from "../../auth/guard.ts";
import { actsAsPerson } from "../../auth/principal.ts";
import { cardRefusedFor, DOC_CALLS, onCanvas } from "../../calls/canvas-frame.ts";
import { runVerb } from "../../calls/run.ts";
import type { RouteDeps } from "./shared.ts";

/**
 * `/api/v1`: every verb in the table (`@decks/api`) as a route, and the one way in for the SDK in
 * all three of its forms: the TypeScript client, the `decks` command and the MCP relay.
 *
 * `POST /api/v1/<verb>` with `{ "args": [...] }` calls the verb for whoever the request's token is
 * (`calls/run.ts`) and answers `{ ok, value, notes }`. `GET /api/v1` lists the verbs, which is what
 * `decks --help` prints, and `GET /api/v1/events` streams every change as it is broadcast. Beside
 * them, what the canvas frame says to the harness that is not a call: an answer to an agent's
 * `decks view …`, a document item's messages, and that a card was read or how it measured.
 */
export function verbRoutes(app: RouteDeps["app"]): express.Router {
	const router = express.Router();

	router.get("/", (req, res) => {
		// The person's own verbs are listed to the person: an agent's command does not have them.
		const mine = actsAsPerson(req.principal) ? [...VERBS, ...PERSON_VERBS] : VERBS;
		res.set("cache-control", "no-store").json({
			verbs: mine.map((verb) => ({ name: verb.name, group: verb.group, touches: verb.touches, effect: verb.effect, summary: verb.summary, signature: signature(verb), ...(verb.who ? { who: verb.who } : {}) })),
		});
	});

	/**
	 * Every change as it happens, for a client that is not a browser on the socket: the frames Decks
	 * broadcasts (`card.changed`, `canvas.changed`, `agent.state`, …), one Server-Sent Event each.
	 * `?types=card.changed,canvas.changed` keeps only those. A comment every 25 seconds keeps
	 * proxies from closing a quiet stream.
	 */
	router.get("/events", (req: Request, res: Response) => {
		const wanted = new Set(String(req.query.types ?? "").split(",").map((one) => one.trim()).filter(Boolean));
		// A canvas frame hears its own canvas and nothing else (`onCanvas`), and what was said to it alone (`frame`).
		const own = req.principal?.kind === "canvas" ? req.principal.canvas : undefined;
		const frameId = typeof req.query.frame === "string" ? req.query.frame : undefined;
		/*
		 * A canvas pass is checked on every use, and a stream is used for as long as it is open: before each
		 * message and each beat, so a pass run out, signed out or unshared ends it at once. The frame comes
		 * back on the pass it holds now (`backend.ts`), and reads again what it missed.
		 */
		const pass = own !== undefined ? bearerOf(req.headers) : undefined;
		const still = () => pass === undefined || app.passes.openCanvas(pass)?.canvas === own;
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
		res.write(": decks events\n\n");
		if (own !== undefined) app.pages.canvasFrames += 1;
		const stop = app.pages.listen((message) => {
			if (!still()) {
				res.end();
				return;
			}
			const to = (message as { frameTo?: string }).frameTo;
			if (to !== undefined) {
				if (own === undefined || to !== frameId) return;
				const { frameTo: _to, ...rest } = message as { frameTo?: string };
				res.write(`event: ${message.type}\ndata: ${JSON.stringify(rest)}\n\n`);
				return;
			}
			if (wanted.size && !wanted.has(message.type)) return;
			if (own !== undefined && !onCanvas(app, message, own)) return;
			res.write(`event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
		});
		const beat = setInterval(() => (still() ? res.write(": still here\n\n") : res.end()), pass === undefined ? 25_000 : 5_000);
		beat.unref?.();
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			clearInterval(beat);
			if (own !== undefined) app.pages.canvasFrames -= 1;
			stop();
		};
		req.on("close", close);
		res.on("close", close);
	});

	/**
	 * A canvas frame's answer to an agent's `decks view …` on its canvas (`stage.call`, which its stream
	 * carries), as a tab answers on the socket. Only a front end showing the canvas answers one.
	 */
	router.post("/stage-result", (req: Request, res: Response) => {
		const kind = req.principal?.kind;
		if (kind !== "canvas" && !actsAsPerson(req.principal)) {
			res.status(403).json({ ok: false, error: "Only a page showing the canvas answers the canvas's calls." });
			return;
		}
		const result = (req.body ?? {}) as { id?: unknown; value?: unknown; error?: unknown };
		if (typeof result.id !== "string") {
			res.status(400).json({ ok: false, error: "Send { id, value } or { id, error }." });
			return;
		}
		const settled = app.pageCalls.settle({ id: result.id, value: result.value, ...(typeof result.error === "string" ? { error: result.error } : {}) });
		res.json({ ok: true, settled });
	});

	/**
	 * What the canvas frame says about a card on its canvas, which a tab says on the socket: that you
	 * read it (`card-seen`) and how it measured (`card-extent`, kept for `decks canvas fit` to report).
	 * Each for a card or board on the caller's own canvas; the person and a paired site may say them for any.
	 */
	const onItsCanvas = (req: Request, res: Response): string | undefined => {
		const path = String((req.body as { path?: unknown } | undefined)?.path ?? "");
		const refused = cardRefusedFor(app, req.principal, path);
		if (!refused) return path;
		res.status(refused.status).json({ ok: false, error: refused.error });
		return undefined;
	};
	/**
	 * A document item's editor, in the canvas frame (`decks.document`): what it sends, for a file a
	 * document item on the frame's canvas names, and nothing else. The answers go down the frame's own
	 * stream (`frame` in its address), since some come later, as a compile does.
	 */
	router.post("/doc", (req: Request, res: Response) => {
		if (req.principal?.kind !== "canvas") {
			res.status(403).json({ ok: false, error: "A document item's calls are the canvas frame's; a tab sends them on its socket." });
			return;
		}
		const body = (req.body ?? {}) as { frame?: unknown; message?: { type?: unknown; path?: unknown } };
		const message = body.message;
		const frame = typeof body.frame === "string" ? body.frame : "";
		if (!message || typeof message.type !== "string" || !DOC_CALLS.has(message.type) || typeof message.path !== "string" || !frame) {
			res.status(400).json({ ok: false, error: "Send { frame, message }, a document message for a file on this canvas." });
			return;
		}
		const key = app.documentsOn(req.principal.canvas).get(message.path);
		if (key === undefined) {
			res.status(403).json({ ok: false, error: `${message.path} is not a document on this canvas.` });
			return;
		}
		// The file as the deck names it; an item that names it another way hears its answers under the name it used.
		const given = message.path;
		app.docs.handle({ ...message, path: key } as never, (answer) => app.pages.tellStreams({ ...answer, ...((answer as { path?: unknown }).path === key ? { path: given } : {}), frameTo: frame } as never));
		res.json({ ok: true });
	});

	router.post("/card-seen", (req: Request, res: Response) => {
		const path = onItsCanvas(req, res);
		if (!path) return;
		app.boards.seen(path);
		res.json({ ok: true });
	});
	router.post("/card-extent", (req: Request, res: Response) => {
		const path = onItsCanvas(req, res);
		if (!path) return;
		const body = req.body as Record<string, unknown>;
		const num = (key: string) => (typeof body[key] === "number" && Number.isFinite(body[key]) ? (body[key] as number) : undefined);
		const rev = num("rev");
		const w = num("w");
		const h = num("h");
		if (rev === undefined || w === undefined || h === undefined) {
			res.status(400).json({ ok: false, error: "Send { path, rev, w, h }, and what else was measured." });
			return;
		}
		const extra: Record<string, number> = {};
		for (const key of ["at", "page", "words", "minFont", "overflowX", "cut", "overlaps"]) {
			const value = num(key);
			if (value !== undefined) extra[key] = value;
		}
		app.boards.noteExtent(path, { rev, w, h, ...extra });
		res.json({ ok: true });
	});
	router.post("/:verb", async (req: Request, res: Response) => {
		const { status, answer } = await runVerb(app, req.principal, req.headers, String(req.params.verb ?? ""), (req.body as { args?: unknown } | undefined)?.args, req.socket.remoteAddress, req.tokenId ? { tokenId: req.tokenId } : undefined);
		res.status(status).json(answer);
	});

	return router;
}

import type { IncomingMessage } from "node:http";
import type { Route } from "../kernel/index.ts";

// Today's picture routes, read from server/pictures with the same token, query and body:
// a canvas's tile, a card's picture, a screenshot, and a card's posted page drawn.

/** Today's picture routes and where each is now: a canvas's tile, a card's picture. */
const FORWARDS = [
	{ old: "/api/stage-thumb/", now: "/pictures/canvas-tile/" },
	{ old: "/api/thumb/", now: "/pictures/" },
	{ old: "/api/stage-shot", now: "/pictures/shot" },
	{ old: "/api/snapshot", now: "/pictures/snapshot", method: "POST" as const },
	{ old: "/compat/snapshot", now: "/pictures/snapshot", method: "POST" as const },
	{ old: "/compat/card-extent", now: "/pictures/extent", method: "POST" as const },
	{ old: "/api/card-extent", now: "/pictures/extent", method: "POST" as const },
];

export const pictureRoutes = (url: () => string | undefined): Route[] => FORWARDS.map((f) => forward(f.old, f.now, url, ("method" in f && f.method) || "GET"));

/** A card's page posted to be drawn comes as its body; a GET has none. */
function bodyOf(req: IncomingMessage): Promise<Buffer> {
	return new Promise((done, fail) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => done(Buffer.concat(chunks)));
		req.on("error", fail);
	});
}

function forward(OLD: string, NOW: string, url: () => string | undefined, method: "GET" | "POST"): Route {
	return {
		method,
		prefix: OLD,
		async serve(_ctx, req, res) {
			const base = url();
			if (!base) return void res.writeHead(503, { "content-type": "text/plain" }).end("The server is not listening yet.");
			const rest = (req.url ?? "").slice(OLD.length);
			const sent: Record<string, string> = { ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}), ...(req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {}) };
			const answer = await fetch(`${base}${NOW}${rest}`, { method, headers: sent, ...(method === "POST" ? { body: await bodyOf(req) } : {}) });
			const headers: Record<string, string> = {};
			answer.headers.forEach((value, key) => void (key !== "content-encoding" && key !== "content-length" && (headers[key] = value)));
			res.writeHead(answer.status, headers).end(Buffer.from(await answer.arrayBuffer()));
		},
	};
}

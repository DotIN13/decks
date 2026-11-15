import type { Route } from "../kernel/index.ts";

// Today's /api/stage-thumb/<canvas> and /api/thumb/<card>, read from server/pictures'
// /pictures/canvas-tile/<canvas> and /pictures/<card> with the same token and query.

/** Today's picture routes and where each is now: a canvas's tile, a card's picture. */
const FORWARDS = [
	{ old: "/api/stage-thumb/", now: "/pictures/canvas-tile/" },
	{ old: "/api/thumb/", now: "/pictures/" },
];

export const pictureRoutes = (url: () => string | undefined): Route[] => FORWARDS.map(({ old, now }) => forward(old, now, url));

function forward(OLD: string, NOW: string, url: () => string | undefined): Route {
	return {
		method: "GET",
		prefix: OLD,
		async serve(_ctx, req, res) {
			const base = url();
			if (!base) return void res.writeHead(503, { "content-type": "text/plain" }).end("The server is not listening yet.");
			const rest = (req.url ?? "").slice(OLD.length);
			const answer = await fetch(`${base}${NOW}${rest}`, { headers: req.headers.authorization ? { authorization: req.headers.authorization } : {} });
			const headers: Record<string, string> = {};
			answer.headers.forEach((value, key) => void (key !== "content-encoding" && key !== "content-length" && (headers[key] = value)));
			res.writeHead(answer.status, headers).end(Buffer.from(await answer.arrayBuffer()));
		},
	};
}

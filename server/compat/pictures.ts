import type { Route } from "../kernel/index.ts";

// Today's /api/stage-thumb/<canvas>, a canvas's tile picture, read from server/pictures'
// /pictures/canvas-tile/<canvas> with the same token and query.

const OLD = "/api/stage-thumb/";
const NOW = "/pictures/canvas-tile/";

export function stageThumbRoute(url: () => string | undefined): Route {
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

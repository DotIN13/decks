// Today's POST <api>/apps/<name>/open: the canvas frame asks to open an app placed on its
// canvas, on its pass; server/apps answers it at POST /app-pass/<name>.
import type { Route } from "../kernel/index.ts";

const OLD = ["/compat/apps/", "/api/apps/"];

export const appOpenRoutes = (url: () => string | undefined): Route[] =>
	OLD.map((prefix) => ({
		method: "POST" as const,
		prefix,
		// A canvas pass may ask to open an app; /app-pass/<name> then checks its canvas, the placement and the app.
		scoped: (_scope, asked) => asked.method === "POST" && appToOpen(asked.path, prefix) !== undefined,
		async serve(_ctx, req, res) {
			const name = appToOpen(req.url ?? "", prefix);
			const base = url();
			if (!name || !base) return void res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "No such app to open." }));
			const answer = await fetch(`${base}/app-pass/${encodeURIComponent(name)}`, { method: "POST", headers: req.headers.authorization ? { authorization: req.headers.authorization } : {} });
			res.writeHead(answer.status, { "content-type": answer.headers.get("content-type") ?? "application/json" }).end(Buffer.from(await answer.arrayBuffer()));
		},
	}));

/** The app's name in /…/apps/<name>/open, or undefined for any other path. */
export function appToOpen(path: string, prefix: string): string | undefined {
	const m = /^([^/]+)\/open$/.exec(path.slice(prefix.length).split("?")[0] ?? "");
	return m ? decodeURIComponent(m[1]!) : undefined;
}

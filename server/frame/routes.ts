// POST /api/passes, /api/t/<pass>/card/<path> and /thumb/<path>, as today's server gives them
// (README rules 2, 3). They are read through /files/ and /pictures/ on the same pass, so a card's
// page, modules and picture come as those features make them.
import { deckFiles, layout } from "../../protocol/index.ts";
import { toDeckPath, type Context, type Route, type RouteAnswer } from "../kernel/index.ts";
import { isPass, type Passes } from "./passes.ts";

const PASS_ROOT = "/api/t/";

const json = (status: number, value: unknown): RouteAnswer => ({ status, type: "application/json", body: JSON.stringify(value) });

const allowed = (canvas: string, rest: string) => rest.startsWith(`${layout.canvasFolder(canvas)}/`) || ["assets/", "lib/", "docs/", "apps/"].some((root) => rest.startsWith(root));

/** Where a pass's kind of file is read: a file through cards' /files/, a picture through /pictures/. */
const FORWARD: Record<string, string> = { card: "/files/", thumb: "/pictures/" };

export function passRoute(passes: Passes): Route {
	return {
		method: "POST",
		prefix: "/api/passes",
		async answer(ctx, _path, _query, body) {
			if (ctx.caller.kind !== "person" || isPass(ctx.caller.id)) return json(403, { error: "Only the person's own token asks for a canvas pass." });
			let canvas = "";
			try {
				canvas = String((JSON.parse(new TextDecoder().decode(body)) as { canvas?: unknown }).canvas ?? "");
			} catch {
				return json(400, { error: "Send { canvas }." });
			}
			const got = await ctx.call<{ name: string }>("canvas.get", { canvas }).catch(() => undefined);
			if (!got) return json(404, { error: `There is no canvas called ${canvas}.` });
			const imports = await importsOf(ctx);
			return json(200, { ...passes.issue(got.name, ctx.caller), imports });
		},
	};
}

/** The deck's import map for the frame, read by the protocol's rule; {} when the deck has none, so the frame never looks for one itself. */
async function importsOf(ctx: Context): Promise<Record<string, string>> {
	try {
		return deckFiles.importMap(new TextDecoder().decode(await ctx.deck.read(toDeckPath(deckFiles.IMPORT_MAP))));
	} catch {
		return {};
	}
}

export function passFilesRoute(passes: Passes, url: () => string | undefined): Route {
	return {
		method: "GET",
		prefix: PASS_ROOT,
		public: true,
		async serve(_ctx, req, res) {
			const [path, query = ""] = (req.url ?? "").split("?");
			const [pass = "", kind = "", ...parts] = path!.slice(PASS_ROOT.length).split("/");
			// A canvas's lib/, assets/, docs/ and apps/ are the deck's, as today (servedAs); a card's folder at a revision is the folder.
			const rest = decodeURIComponent(parts.join("/")).replace(/@\d+(?=\/)/g, "").replace(/^(?:shared\/)?canvases\/(?:[^/]+\/)+?(lib|assets|docs|apps)\//, "$1/");
			const canvas = passes.canvasOf(pass);
			const base = url();
			const forward = FORWARD[kind];
			if (!canvas || !forward || !allowed(canvas, rest) || !base) return void res.writeHead(404, { "content-type": "text/plain" }).end("Not found.");
			const params = new URLSearchParams(query);
			params.set("pass", pass);
			const answer = await fetch(`${base}${forward}${rest.split("/").map(encodeURIComponent).join("/")}?${params}`);
			const headers: Record<string, string> = {};
			answer.headers.forEach((value, key) => void (key !== "content-encoding" && key !== "content-length" && (headers[key] = value)));
			// Read by the sandboxed frame, whose origin is null: modules and fetches need it said.
			headers["access-control-allow-origin"] = "*";
			res.writeHead(answer.status, headers).end(Buffer.from(await answer.arrayBuffer()));
		},
	};
}

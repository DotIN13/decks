// Today's POST /api/upload?name=&canvas= and GET /api/where?path=: a dropped file kept in the
// canvas's files/ (or assets/), never over another, and whether a path is a file of the deck.
import { layout } from "../../protocol/index.ts";
import { toDeckPath, type Context, type Route, type RouteAnswer } from "../kernel/index.ts";

const json = (status: number, value: unknown): RouteAnswer => ({ status, type: "application/json", body: JSON.stringify(value) });

export const uploadRoute: Route = {
	method: "POST",
	prefix: "/api/upload",
	async answer(ctx, _path, query, body) {
		const canvas = query.get("canvas") || undefined;
		if (canvas && !(await ctx.call("canvas.get", { canvas }).then(() => true, () => false))) return json(404, { error: `There is no canvas ${canvas} to put the file in.` });
		const folder = canvas ? `${layout.canvasFolder(canvas)}/files` : "assets";
		const name = await freeName(ctx, folder, safeName(query.get("name") ?? ""));
		await ctx.deck.write(toDeckPath(`${folder}/${name}`), body, ctx.caller);
		return json(200, { path: `${folder}/${name}`, name, bytes: body.byteLength, ...(canvas ? { ref: `files/${name}` } : {}) });
	},
};

/** A file name made safe: its last part, plain characters only. */
export function safeName(asked: string): string {
	const base = asked.split(/[\\/]/).pop() ?? "";
	const clean = base.replace(/[^\w.\- ]+/g, "-").replace(/^[.\s]+/, "").trim();
	return clean || "file";
}

/** The first free name in the folder: name, then name-2, name-3 before its extension. */
async function freeName(ctx: Context, folder: string, name: string): Promise<string> {
	const dot = name.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	for (let n = 1; ; n++) {
		const candidate = n === 1 ? name : `${stem}-${n}${ext}`;
		if (!(await exists(ctx, `${folder}/${candidate}`))) return candidate;
	}
}

async function exists(ctx: Context, path: string): Promise<boolean> {
	try {
		await ctx.deck.read(toDeckPath(path));
		return true;
	} catch {
		return false;
	}
}

export const whereRoute: Route = {
	method: "GET",
	prefix: "/api/where",
	async answer(ctx, _path, query) {
		const asked = query.get("path") ?? "";
		try {
			const path = toDeckPath(asked);
			return json(200, (await exists(ctx, path)) ? { inDeck: true, path } : { inDeck: false });
		} catch {
			return json(200, { inDeck: false });
		}
	},
};

import type { PenDocument, PenEdit } from "@decks/pen";
import { sync } from "../../../protocol/index.ts";
import { commitEdits } from "./commit.ts";
import type { Live } from "./live.ts";
import type { HubStore, Role, Who } from "./store.ts";

// The /sync/v1 routes, as one fetch handler: a Request in, a Response out, or
// undefined for a path that is not one of them. Only a harness's key gets in.

export type HubOptions = { hub: HubStore; live?: Live; who: (req: Request) => Who | undefined; maxBytes?: number };
type Ctx = { who: Who; params: Record<string, string>; url: URL; req: Request };
type Handler = (c: Ctx) => Response | Promise<Response>;

export class HubError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const mayEdit = (role: Role | undefined) => role === "owner" || role === "edit";

export function hubRoutes(o: HubOptions): (req: Request) => Promise<Response | undefined> {
	const table = routeTable(o);
	return async (req) => {
		const url = new URL(req.url);
		for (const [key, handle] of table) {
			const [method, path] = key.split(" ") as [string, string];
			const params = match(path, url.pathname);
			if (req.method !== method || !params) continue;
			const who = o.who(req);
			if (!who?.harness) return json(401, { error: "Send a harness's key: Authorization: Bearer <key>." });
			try {
				return await handle({ who, params, url, req });
			} catch (e) {
				if (e instanceof HubError) return json(e.status, { error: e.message });
				throw e;
			}
		}
		return undefined;
	};
}

function match(pattern: string, path: string): Record<string, string> | undefined {
	const keys: string[] = [];
	const re = new RegExp(`^${pattern.replace(/:([a-z]+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
	const m = re.exec(path);
	if (!m) return undefined;
	return Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
}

function routeTable(o: HubOptions): Map<string, Handler> {
	const R = sync.SYNC_ROUTES;
	const t = new Map<string, Handler>();
	const add = (r: { method: string; path: string }, h: Handler) => t.set(`${r.method} ${r.path}`, h);
	const { hub, live } = o;
	const roleOf = ({ who, params }: Ctx) => {
		const role = hub.role(who.user.id, params.id!);
		if (!role) throw new HubError(404, "No such canvas.");
		return role;
	};
	const editable = (c: Ctx) => {
		if (!mayEdit(roleOf(c))) throw new HubError(403, "This canvas is shared with you to view.");
	};
	const by = (who: Who) => who.harness?.id ?? who.user.id;
	add(R.hello, ({ who }) => json(200, { user: who.user, harness: who.harness }));
	add(R.canvases, ({ who }) => json(200, { canvases: hub.canvases(who.user.id) }));
	add(R.createCanvas, async (c) => createCanvas(o, c));
	add(R.canvas, (c) => {
		const role = roleOf(c);
		const k = hub.canvas(c.params.id!)!;
		return json(200, { id: k.id, rev: k.rev, title: k.title, name: k.name, role, pen: k.pen });
	});
	add(R.changes, (c) => {
		roleOf(c);
		const got = hub.changesSince(c.params.id!, Number(c.url.searchParams.get("since")));
		const rev = hub.canvas(c.params.id!)!.rev;
		return json(200, got ? { rev, changes: got.map((x) => x.edits) } : { rev, tooOld: true });
	});
	add(R.edits, async (c) => pushEdits(o, c, by(c.who)));
	add(R.files, (c) => (roleOf(c), json(200, { files: hub.canvasFiles(c.params.id!) })));
	add(R.putFile, async (c) => (editable(c), putFile(o, c, by(c.who))));
	add(R.deleteFile, (c) => {
		editable(c);
		const path = pathOf(c.url);
		if (!hub.removeCanvasFile(c.params.id!, path, baseOf(c.url))) throw new HubError(409, "Studio's copy changed since; it stays.");
		live?.toCanvas(c.params.id!, { type: "file", canvas: c.params.id!, path, version: 0, hash: "", by: by(c.who) });
		return json(200, { path, deleted: true });
	});
	add(R.blob, ({ who, params }) => {
		const bytes = hub.blob(who.user.id, params.hash!);
		if (!bytes) throw new HubError(404, "No such blob.");
		return new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
	});
	add(R.inventory, async (c) => putInventory(o, c));
	return t;
}

async function createCanvas(o: HubOptions, { who, req }: Ctx): Promise<Response> {
	const got = (await bodyOf(req, o.maxBytes)) as { name?: unknown; title?: unknown; pen?: unknown };
	if (!sync.safeCanvasName(got.name)) throw new HubError(400, "A canvas's name is one plain folder name: letters, digits, dots, dashes, underscores.");
	const existing = o.hub.canvases(who.user.id).find((c) => c.owner === who.user.id && c.name === got.name);
	if (existing) return json(200, { canvas: existing, existed: true });
	const title = typeof got.title === "string" && got.title ? got.title : got.name;
	const canvas = o.hub.createCanvas(who.user.id, title, got.name, got.pen as PenDocument | undefined);
	o.live?.toUser(who.user.id, { type: "canvases" });
	return json(201, { canvas });
}

/** A push of drawing edits, merged onto the canvas as it is now. */
async function pushEdits(o: HubOptions, c: Ctx, by: string): Promise<Response> {
	if (!mayEdit(o.hub.role(c.who.user.id, c.params.id!))) throw new HubError(403, "You may not edit this canvas.");
	const sent = (await bodyOf(c.req, o.maxBytes)) as { edits?: unknown; client?: unknown };
	if (!Array.isArray(sent.edits)) throw new HubError(400, "Send edits: a list from the pen diff.");
	if (sent.edits.length > sync.EDITS_MAX) throw new HubError(413, `At most ${sync.EDITS_MAX} edits in one push.`);
	const client = typeof sent.client === "string" ? sent.client : undefined;
	return json(200, commitEdits(o.hub, o.live, c.params.id!, sent.edits as PenEdit[], by, client));
}

/** One file of a canvas's bundle, put; the canvas's sockets hear of it when it is the current copy. */
async function putFile(o: HubOptions, c: Ctx, by: string): Promise<Response> {
	const path = pathOf(c.url);
	const put = o.hub.putCanvasFile(c.params.id!, path, await bytesOf(c.req, o.maxBytes), baseOf(c.url));
	if (put.current) o.live?.toCanvas(c.params.id!, { type: "file", canvas: c.params.id!, path, version: put.version, hash: put.hash, by });
	return json(200, { path, ...put });
}

/** A harness's app list, for Studio to show what it can open. */
async function putInventory(o: HubOptions, { who, req }: Ctx): Promise<Response> {
	const got = (await bodyOf(req, o.maxBytes)) as { apps?: unknown };
	if (!Array.isArray(got.apps)) throw new HubError(400, "Send { apps }.");
	o.hub.setInventory(who.harness!.id, got.apps as { name: string; title: string; kind: string }[]);
	o.live?.toUser(who.user.id, { type: "harnesses" });
	return json(200, { apps: got.apps.length });
}

// Reading a request: the path, the base version, the body
function pathOf(url: URL): string {
	const path = url.searchParams.get("path");
	if (!sync.safeSyncPath(path) || sync.secretLooking(path)) throw new HubError(400, "That path is not a file of a canvas's bundle.");
	return path;
}

const baseOf = (url: URL) => (url.searchParams.has("base") ? Number(url.searchParams.get("base")) : undefined);

async function bytesOf(req: Request, max = 50 * 1024 * 1024): Promise<Uint8Array> {
	const got = new Uint8Array(await req.arrayBuffer());
	if (got.length > max) throw new HubError(413, `The body is over ${Math.round(max / 1024 / 1024)} MB.`);
	return got;
}

async function bodyOf(req: Request, max?: number): Promise<unknown> {
	const bytes = await bytesOf(req, max);
	if (!bytes.length) return {};
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		throw new HubError(400, "The body is not JSON.");
	}
}

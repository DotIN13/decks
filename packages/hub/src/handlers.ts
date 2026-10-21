import type { PenDocument, PenEdit } from "@decks/pen";
import { CANVAS_NAME, CANVAS_NAME_ERROR, CANVAS_PATH_ERROR, Inventory, NewCanvas, PushEdits, safeSyncPath } from "@decks/sync-protocol";
import { changesSince, commitEdits, mayEdit } from "./commit.ts";
import type { Live } from "./live.ts";
import type { HubStore, Who } from "./store.ts";

export interface SyncHandlerOptions {
	store: HubStore;
	/** Where changes are announced; leave it out and nobody hears of them until they ask. */
	live?: Live;
	/**
	 * Who is asking, from the request: Studio looks a harness's key up from `Authorization: Bearer`.
	 * Nothing means 401. Unless `harnessesOnly` is false, only harnesses (`who.harness` set) get in.
	 */
	who: (req: Request) => Who | undefined | Promise<Who | undefined>;
	/** The largest body taken, in bytes: 50 MB unless said. */
	maxBytes?: number;
	/**
	 * Whether only harnesses may use these routes (the default). A site whose own pages read and edit
	 * canvases through the same routes sets it false; `who` then answers for a page's person too.
	 */
	harnessesOnly?: boolean;
}

/** A request that does not fit: answered with its status and sentence. */
export class HubError extends Error {
	constructor(readonly status: number, message: string) {
		super(message);
	}
}

type Handler = (req: Request, ctx: { who: Who; params: Record<string, string>; url: URL }) => Response | Promise<Response>;

/**
 * The `/sync/v1` routes a harness syncs through, as one fetch handler: a `Request` in, a `Response`
 * out, or `undefined` for a path that is not one of them, so a server can try it first and go on.
 * Mount it on anything that speaks fetch (Hono, Bun, Deno, a Worker), or on node:http with
 * `@decks/hub/node`'s `nodeHandler`. The live socket (`/sync/v1/live`) is the server's to upgrade;
 * hand the socket to `live.add`.
 */
export function syncHandler(o: SyncHandlerOptions): (req: Request) => Promise<Response | undefined> {
	const { store, live } = o;
	const max = o.maxBytes ?? 50 * 1024 * 1024;
	const routes: { method: string; pattern: RegExp; keys: string[]; handle: Handler }[] = [];
	const route = (method: string, path: string, handle: Handler) => {
		const keys: string[] = [];
		const pattern = new RegExp(`^${path.replace(/:([a-z]+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
		routes.push({ method, pattern, keys, handle });
	};
	const json = (status: number, value: unknown, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
	const bytesOf = async (req: Request): Promise<Uint8Array> => {
		const declared = Number(req.headers.get("content-length") ?? "0");
		if (declared > max) throw new HubError(413, `The body is over ${Math.round(max / 1024 / 1024)} MB.`);
		const got = new Uint8Array(await req.arrayBuffer());
		if (got.length > max) throw new HubError(413, `The body is over ${Math.round(max / 1024 / 1024)} MB.`);
		return got;
	};
	const bodyOf = async (req: Request): Promise<unknown> => {
		const bytes = await bytesOf(req);
		if (!bytes.length) return {};
		try {
			return JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			throw new HubError(400, "The body is not JSON.");
		}
	};
	const roleOr404 = (who: Who, id: string) => {
		const role = store.role(who.user.id, id);
		if (!role) throw new HubError(404, "No such canvas.");
		return role;
	};
	const editable = (who: Who, id: string) => {
		if (!mayEdit(roleOr404(who, id))) throw new HubError(403, "This canvas is shared with you to view.");
	};
	const pathParam = (url: URL) => {
		const path = url.searchParams.get("path");
		if (!safeSyncPath(path)) throw new HubError(400, CANVAS_PATH_ERROR);
		return path;
	};
	const baseParam = (url: URL) => (url.searchParams.has("base") ? Number(url.searchParams.get("base")) : undefined);

	route("GET", "/sync/v1/hello", (_req, { who }) => json(200, { user: who.user, harness: who.harness }));
	route("GET", "/sync/v1/canvases", (_req, { who }) => json(200, { canvases: store.canvases(who.user.id) }));
	route("POST", "/sync/v1/canvases", async (req, { who }) => {
		const got = NewCanvas.safeParse(await bodyOf(req));
		if (!got.success || !CANVAS_NAME.test(got.data.name)) throw new HubError(400, CANVAS_NAME_ERROR);
		const { name, title, pen } = got.data;
		const existing = store.canvases(who.user.id).find((c) => c.owner === who.user.id && c.name === name);
		if (existing) return json(200, { canvas: existing, existed: true });
		const canvas = store.createCanvas(who.user.id, title || name, name, pen as unknown as PenDocument | undefined);
		live?.toUser(who.user.id, { type: "canvases" });
		return json(201, { canvas });
	});
	route("GET", "/sync/v1/canvases/:id", (_req, { who, params, url }) => {
		const role = roleOr404(who, params.id!);
		const since = Number(url.searchParams.get("since") ?? "0");
		const c = store.canvas(params.id!)!;
		const changes = since > 0 ? store.changesSince(params.id!, since) : undefined;
		return json(200, changes ? { id: c.id, rev: c.rev, changes } : { id: c.id, rev: c.rev, title: c.title, name: c.name, role, pen: c.pen });
	});
	route("GET", "/sync/v1/canvases/:id/changes", (_req, { who, params, url }) => {
		roleOr404(who, params.id!);
		return json(200, changesSince(store, params.id!, Number(url.searchParams.get("since"))));
	});
	route("POST", "/sync/v1/canvases/:id/edits", async (req, { who, params }) => {
		const started = performance.now();
		if (!mayEdit(store.role(who.user.id, params.id!))) throw new HubError(403, "You may not edit this canvas.");
		const got = PushEdits.safeParse(await bodyOf(req));
		if (!got.success) throw new HubError(400, "Send edits: a list from @decks/pen's diff.");
		const answer = commitEdits(store, live, params.id!, got.data.edits as unknown as PenEdit[], who.harness?.id ?? who.user.id, got.data.client);
		// How long the edit took, answer included, for a network panel and a bench.
		return json(200, answer, { "Server-Timing": `edit;dur=${(performance.now() - started).toFixed(1)}` });
	});
	route("GET", "/sync/v1/canvases/:id/files", (_req, { who, params }) => {
		roleOr404(who, params.id!);
		return json(200, { files: store.canvasFiles(params.id!) });
	});
	route("PUT", "/sync/v1/canvases/:id/files", async (req, { who, params, url }) => {
		editable(who, params.id!);
		const path = pathParam(url);
		const put = store.putCanvasFile(params.id!, path, await bytesOf(req), baseParam(url), who.harness?.id ?? who.user.id);
		if (put.current) live?.toCanvas(params.id!, { type: "file", canvas: params.id!, path, version: put.version, hash: put.hash, by: who.harness?.id ?? who.user.id });
		return json(200, { path, ...put });
	});
	route("DELETE", "/sync/v1/canvases/:id/files", (_req, { who, params, url }) => {
		editable(who, params.id!);
		const path = pathParam(url);
		if (!store.removeCanvasFile(params.id!, path, baseParam(url))) throw new HubError(409, "The service's copy changed since; it stays.");
		live?.toCanvas(params.id!, { type: "file", canvas: params.id!, path, version: 0, hash: "", by: who.harness?.id ?? who.user.id });
		return json(200, { path, deleted: true });
	});
	/** Bytes by their hash, for a file this account (or someone sharing a canvas with it) has or had. */
	route("GET", "/sync/v1/blobs/:hash", (_req, { who, params }) => {
		const bytes = store.mayReadBlob(who.user.id, params.hash!) ? store.blob(params.hash!) : undefined;
		if (!bytes) throw new HubError(404, "No such blob.");
		return new Response(bytes as unknown as ArrayBuffer, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
	});
	/** What a harness serves (its apps and their boards), so pages know which harness to show an app's board from. */
	route("PUT", "/sync/v1/inventory", async (req, { who }) => {
		if (!store.setInventory || !who.harness) throw new HubError(404, "This service keeps no inventory.");
		const got = Inventory.safeParse(await bodyOf(req));
		if (!got.success) throw new HubError(400, got.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
		store.setInventory(who.harness.id, got.data.apps);
		live?.toUser(who.user.id, { type: "harnesses" });
		return json(200, { apps: got.data.apps.length });
	});

	return async (req) => {
		const url = new URL(req.url);
		if (!url.pathname.startsWith("/sync/v1/")) return undefined;
		const found = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
		if (!found) return undefined;
		const who = await o.who(req);
		if (!who || (o.harnessesOnly !== false && !who.harness)) return json(401, { error: "Send a harness's key: Authorization: Bearer <key>." });
		const m = url.pathname.match(found.pattern)!;
		const params: Record<string, string> = {};
		found.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
		try {
			return await found.handle(req, { who, params, url });
		} catch (e) {
			if (e instanceof HubError) return json(e.status, { error: e.message });
			throw e;
		}
	};
}

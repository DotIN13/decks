import { any, arr, bool, int, lit, named, nul, num, obj, opt, rec, str, union } from "./schema.ts";
import { Camera, Point } from "./shapes.ts";
import { Envelope } from "./wire.ts";

// What a server and Studio exchange. Neither trusts the other to name places
// on its disk: canvas names and file paths are checked here, the same way.

export const CANVAS_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]{0,99}$/u;
export const BUNDLE_PARTS: readonly string[] = ["cards", "frames", "files", "assets", "docs", ".pictures"];
export const EDITS_MAX = 5000;
const SECRET_FILE = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore)|id_(?:rsa|ed25519|ecdsa).*|credentials\.json)$/i;

export function safeCanvasName(name: unknown): name is string {
	return typeof name === "string" && CANVAS_NAME.test(name) && name !== "." && name !== "..";
}

/** Whether a synced path names a file of a canvas's bundle. */
export function safeSyncPath(path: unknown): path is string {
	if (typeof path !== "string" || !path || path.length > 1000 || path.includes("\\") || path.includes("\0")) return false;
	const parts = path.split("/");
	if (parts.length < 2 || !BUNDLE_PARTS.includes(parts[0] ?? "")) return false;
	return parts.every((part, i) => part !== "" && part !== "." && part !== ".." && (i === 0 || !part.startsWith(".")));
}

/** Whether a file looks like a secret or a dependency, and so is never synced. */
export function secretLooking(path: string): boolean {
	const parts = path.split("/");
	return parts.includes("node_modules") || SECRET_FILE.test(parts[parts.length - 1] ?? "");
}

export const Role = named("Role", lit("owner", "edit", "view"));
export const PenOp = named("PenOp", obj({ op: lit("insert", "remove", "set", "place", "meta") }, true), "A drawing edit as the pen diff makes it.");
export const SyncCanvas = named(
	"SyncCanvas",
	obj({ id: str(), name: str(), title: str(), rev: int(), role: Role, owner: str(), ownerName: opt(str()), othersEdit: opt(bool()) }),
);
export const SyncFile = named("SyncFile", obj({ path: str(), version: int(), hash: str(), size: int(), at: num() }));
export const PutFile = named("PutFile", obj({ path: str(), version: int(), current: bool(), hash: str() }));
export const Inventory = named("Inventory", obj({ apps: arr(obj({ name: str(), title: str(), kind: str() })) }));
export const Changes = named("Changes", union(obj({ rev: int(), changes: arr(arr(PenOp)) }), obj({ rev: int(), tooOld: lit(true) })));
export const PushEdits = named("PushEdits", obj({ base: int(), edits: arr(PenOp), client: opt(str()) }));
export const EditsAnswer = named(
	"EditsAnswer",
	obj({ rev: int(), base: opt(int()), applied: int(), adjusted: int(), dropped: int(), changes: opt(arr(PenOp)), pen: opt(rec(any())) }),
);
export const NewCanvas = named("NewCanvas", obj({ name: str(), title: opt(str()), pen: opt(rec(any())) }));
export const Hello = named("Hello", obj({ user: obj({ id: str(), email: str(), name: str() }, true), harness: opt(obj({ id: str(), name: str() }, true)) }));

export const PresenceBy = named("PresenceBy", obj({ kind: lit("person", "agent"), id: str(), name: opt(str()), color: str(), harness: opt(str()) }));
const presence = { canvas: str(), pointer: opt(union(Point, nul)), selection: opt(arr(str())), camera: opt(union(Camera, nul)), gone: opt(lit(true)) };

/** What Studio's live socket sends, to browsers and servers alike; an ask relays a call to a machine. */
export const LiveEvent = named(
	"LiveEvent",
	union(
		obj({ type: lit("hello"), user: str(), harness: opt(str()) }),
		obj({ type: lit("canvas"), id: str(), rev: int(), base: opt(int()), by: opt(str()), client: opt(str()), changes: opt(arr(PenOp)) }),
		obj({ type: lit("canvas.gone"), id: str() }),
		obj({ type: lit("file"), path: str(), version: int(), hash: str(), by: opt(str()), canvas: opt(str()) }),
		obj({ type: lit("canvases") }),
		obj({ type: lit("harnesses") }),
		obj({ type: lit("presence"), by: PresenceBy, ...presence }),
		obj({ type: lit("token.ask"), id: str(), user: obj({ id: str(), name: str() }), origin: str() }),
		obj({ type: lit("ask"), id: str(), name: str(), args: rec(any()), caller: obj({ kind: lit("person"), id: str(), name: str() }) }),
	),
);
export const TokenGiven = named("TokenGiven", obj({ type: lit("token"), id: str(), token: opt(str()), expires: opt(num()), error: opt(str()) }));
/** What a server may send on its live socket, a reply to Studio's ask included. */
export const ServerSend = named("ServerSend", union(TokenGiven, obj({ type: lit("presence"), by: PresenceBy, ...presence }), obj({ type: lit("reply"), id: str(), envelope: Envelope })));

/** The routes Studio offers a server, under /sync/v1, each on the server's key. */
export const SYNC_ROUTES = {
	hello: { method: "GET", path: "/sync/v1/hello" },
	canvases: { method: "GET", path: "/sync/v1/canvases" },
	createCanvas: { method: "POST", path: "/sync/v1/canvases" },
	canvas: { method: "GET", path: "/sync/v1/canvases/:id" },
	changes: { method: "GET", path: "/sync/v1/canvases/:id/changes" },
	edits: { method: "POST", path: "/sync/v1/canvases/:id/edits" },
	files: { method: "GET", path: "/sync/v1/canvases/:id/files" },
	putFile: { method: "PUT", path: "/sync/v1/canvases/:id/files" },
	deleteFile: { method: "DELETE", path: "/sync/v1/canvases/:id/files" },
	blob: { method: "GET", path: "/sync/v1/blobs/:hash" },
	inventory: { method: "PUT", path: "/sync/v1/inventory" },
	live: { method: "GET", path: "/sync/v1/live" },
} as const;

/** A route's path with every :name filled and encoded. */
export function syncPath(path: string, params: Record<string, string> = {}): string {
	return path.replace(/:([a-z]+)/g, (_, key: string) => {
		const value = params[key];
		if (value === undefined) throw new Error(`${path} needs ${key}`);
		return encodeURIComponent(value);
	});
}

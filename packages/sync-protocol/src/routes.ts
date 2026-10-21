import { z } from "zod";
import { CanvasAnswer, Changes, EditsAnswer, Hello, Inventory, NewCanvas, PushEdits, PutFile, SyncCanvas, SyncFile } from "./schemas.ts";

/**
 * The routes a sharing service offers a harness, under `/sync/v1`, each authorised by the
 * harness's key in `Authorization: Bearer`. A file's bytes travel raw (`body: "bytes"`); its path
 * and the version it replaces (`base`) go in the query, as `path` and `base`.
 */
export const syncRoutes = {
	hello: { method: "GET", path: "/sync/v1/hello", answer: Hello },
	canvases: { method: "GET", path: "/sync/v1/canvases", answer: z.object({ canvases: z.array(SyncCanvas) }) },
	createCanvas: { method: "POST", path: "/sync/v1/canvases", body: NewCanvas, answer: z.object({ canvas: SyncCanvas, existed: z.boolean().optional() }) },
	canvas: { method: "GET", path: "/sync/v1/canvases/:id", answer: CanvasAnswer },
	changes: { method: "GET", path: "/sync/v1/canvases/:id/changes", answer: Changes },
	edits: { method: "POST", path: "/sync/v1/canvases/:id/edits", body: PushEdits, answer: EditsAnswer },
	files: { method: "GET", path: "/sync/v1/canvases/:id/files", answer: z.object({ files: z.array(SyncFile) }) },
	putFile: { method: "PUT", path: "/sync/v1/canvases/:id/files", body: "bytes", answer: PutFile },
	deleteFile: { method: "DELETE", path: "/sync/v1/canvases/:id/files", answer: z.object({ path: z.string(), deleted: z.literal(true) }) },
	/** Bytes by their hash, for a file the account (or someone sharing a canvas with it) has or had. */
	blob: { method: "GET", path: "/sync/v1/blobs/:hash", answer: "bytes" },
	inventory: { method: "PUT", path: "/sync/v1/inventory", body: Inventory, answer: z.object({ apps: z.number() }) },
	/** The live socket: every `LiveEvent` for the account's canvases. */
	live: { method: "GET", path: "/sync/v1/live", answer: "socket" },
	/** An account's tree, as files were kept before they were kept per canvas (2026-10-20): read by older harnesses only. */
	accountFiles: { method: "GET", path: "/sync/v1/files", answer: z.object({ files: z.array(SyncFile) }) },
} as const;

export type SyncRoutes = typeof syncRoutes;
export type SyncRouteName = keyof SyncRoutes;

/** `/sync/v1/canvases/:id` with `{ id: "x" }`: every `:name` filled, encoded. */
export function syncPath(path: string, params: Record<string, string> = {}): string {
	return path.replace(/:([a-z]+)/g, (_, key: string) => {
		const value = params[key];
		if (value === undefined) throw new Error(`${path} needs ${key}`);
		return encodeURIComponent(value);
	});
}

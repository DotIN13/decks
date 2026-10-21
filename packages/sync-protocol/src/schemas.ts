import { z } from "zod";

/** What someone may do with a canvas: own it, edit it, or only view it. */
export const Role = z.enum(["owner", "edit", "view"]);
export type Role = z.infer<typeof Role>;

/**
 * A drawing edit, as `@decks/pen`'s `diff` makes them. Only its kind is checked here; the merge
 * applies it, and drops what does not apply.
 */
export const PenEdit = z.object({ op: z.enum(["insert", "remove", "set", "place", "meta"]) }).passthrough();
export type PenEdit = z.infer<typeof PenEdit>;

/** A drawing: a `.pen` document, checked by `@decks/pen` when it is parsed. */
export const PenDocument = z.record(z.string(), z.unknown());

/** A canvas as the sync API lists it. */
export const SyncCanvas = z.object({
	id: z.string(),
	/** The folder name it has on a harness: `canvases/<name>/`. */
	name: z.string(),
	title: z.string(),
	rev: z.number(),
	role: Role,
	owner: z.string(),
	/** The owner's name, as a harness names the folder a friend's canvas lands in: `shared/canvases/<owner>/<name>/`. */
	ownerName: z.string().optional(),
});
export type SyncCanvas = z.infer<typeof SyncCanvas>;

/**
 * One file of a canvas, by its path in the canvas's folder: a board (`boards/…`), a frame
 * (`frames/…`), a file its boards use (`files/…`), a deck file they point at (`assets/…`, `docs/…`),
 * or a picture (`.pictures/…`).
 */
export const SyncFile = z.object({ path: z.string(), version: z.number(), hash: z.string(), size: z.number(), at: z.number() });
export type SyncFile = z.infer<typeof SyncFile>;

/** The answer to a pushed file: `current` false means the file had moved on, and this upload was kept as a version only. */
export const PutFile = z.object({ path: z.string(), version: z.number(), current: z.boolean(), hash: z.string() });
export type PutFile = z.infer<typeof PutFile>;

/** An app a harness serves, and the board that shows it (`boards/apps/<name>.html`). */
export const HarnessApp = z.object({ name: z.string().max(200), title: z.string().max(200), kind: z.string().max(80), board: z.string().max(500) });
export type HarnessApp = z.infer<typeof HarnessApp>;

/** What a harness says it serves (`PUT /sync/v1/inventory`): its apps, at most 500. */
export const Inventory = z.object({ apps: z.array(HarnessApp).max(500) });
export type Inventory = z.infer<typeof Inventory>;

/** `changes?since=N`: the revisions after N in order, one list of edits each, or `tooOld` when the log no longer reaches back. */
export const Changes = z.union([z.object({ rev: z.number(), changes: z.array(z.array(PenEdit)) }), z.object({ rev: z.number(), tooOld: z.literal(true) })]);
export type Changes = z.infer<typeof Changes>;

/** Edits made against revision `base`. A body naming its `client` (a page, a harness) is not sent the whole drawing back. */
export const PushEdits = z.object({ base: z.number(), edits: z.array(PenEdit), client: z.string().max(100).optional() });
export type PushEdits = z.infer<typeof PushEdits>;

/**
 * What came of pushed edits: the new revision, the one they went onto (`base`), how many applied,
 * were adjusted or dropped, and what happened (`changes`); the drawing (`pen`) only to a body with no `client`.
 */
export const EditsAnswer = z.object({
	rev: z.number(),
	base: z.number().optional(),
	applied: z.number(),
	adjusted: z.number(),
	dropped: z.number(),
	changes: z.array(PenEdit).optional(),
	pen: PenDocument.optional(),
});
export type EditsAnswer = z.infer<typeof EditsAnswer>;

/** One canvas: whole (title, folder name, role, drawing), or with `?since=N` only its revisions after N. */
export const CanvasAnswer = z.union([
	z.object({ id: z.string(), rev: z.number(), changes: z.array(z.object({ rev: z.number(), edits: z.array(PenEdit) })) }),
	z.object({ id: z.string(), rev: z.number(), title: z.string(), name: z.string(), role: Role, pen: PenDocument }),
]);
export type CanvasAnswer = z.infer<typeof CanvasAnswer>;

/** A new canvas from a harness: its folder name, title and drawing. An existing one of the same name answers `existed`. */
export const NewCanvas = z.object({ name: z.string(), title: z.string().optional(), pen: PenDocument.optional() });
export type NewCanvas = z.infer<typeof NewCanvas>;

/** Who a key belongs to: the account and the harness. */
export const Hello = z.object({
	user: z.object({ id: z.string(), email: z.string(), name: z.string() }).passthrough(),
	harness: z.object({ id: z.string(), name: z.string() }).passthrough().optional(),
});
export type Hello = z.infer<typeof Hello>;

/** What the live sockets send, to browsers and harnesses alike. */
export const LiveEvent = z.discriminatedUnion("type", [
	/** Connected; on a reconnect, what was said while away is not known. */
	z.object({ type: z.literal("hello"), user: z.string(), harness: z.string().optional() }),
	/**
	 * A new revision: who made it (`by`, and the page or harness that sent it, `client`), the revision
	 * it follows (`base`) and its edits (`changes`) when they fit in a message (64 KB); without them,
	 * fetch `changes?since=`.
	 */
	z.object({ type: z.literal("canvas"), id: z.string(), rev: z.number(), base: z.number().optional(), by: z.string().optional(), client: z.string().optional(), changes: z.array(PenEdit).optional() }),
	z.object({ type: z.literal("canvas.gone"), id: z.string() }),
	/** A file changed: of a canvas (`canvas`, its path in the canvas's folder), or of an account's older tree. Version 0 is deleted. */
	z.object({ type: z.literal("file"), path: z.string(), version: z.number(), hash: z.string(), by: z.string().optional(), canvas: z.string().optional() }),
	/** The list of canvases changed. */
	z.object({ type: z.literal("canvases") }),
	/** A harness changed what it serves. */
	z.object({ type: z.literal("harnesses") }),
	z.object({ type: z.literal("cursor"), canvas: z.string(), user: z.string(), name: z.string(), x: z.number(), y: z.number() }),
	z.object({ type: z.literal("cursor.gone"), canvas: z.string(), user: z.string() }),
]);
export type LiveEvent = z.infer<typeof LiveEvent>;

/** What a browser may send on its live socket: where its pointer is on a canvas, in canvas units. */
export const LiveSend = z.object({ type: z.literal("cursor"), canvas: z.string(), x: z.number(), y: z.number() });
export type LiveSend = z.infer<typeof LiveSend>;

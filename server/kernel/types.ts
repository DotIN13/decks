import { handlersFor, layout, Refused, type AnyEvent, type Caller, type Handled, type Payload, type shapes, type Who } from "../../protocol/index.ts";

// The kernel's interfaces, as types, for wave 1 to build against. Keel owns
// this folder after wave 0 and writes what implements them.

export type Bytes = Uint8Array;
export type Stop = () => void;

/** A path from the deck's root, checked once: no hidden part, nothing outside. */
export type DeckPath = string & { readonly deckPath: unique symbol };

export function toDeckPath(raw: string): DeckPath {
	const path = raw.split("\\").join("/").replace(/^\.\/+/, "").replace(/\/+$/, "");
	if (!layout.deckPathOk(path) || path.split("/").some((part) => part === "..")) {
		throw new Refused("invalid", `${raw} is not a path inside the deck.`, "file.list");
	}
	return path as DeckPath;
}

/** One recorded write: which file, its revision, who wrote it and when. */
export type Revision = { path: DeckPath; rev: number; by: string; at: number };
/** One name in a folder. */
export type Entry = { path: DeckPath; kind: "file" | "dir"; size: number; rev?: number; at: number };
/** What a watcher hears: a file was written, or went. */
export type FileChange = { path: DeckPath; kind: "written" | "deleted"; rev: number; by: string; at: number };

/** Every read and write of a deck. Nothing else touches node:fs. */
export interface Deck {
	read(path: DeckPath): Promise<Bytes>;
	write(path: DeckPath, bytes: Bytes, by: Caller): Promise<Revision>;
	list(dir: DeckPath | ""): Promise<Entry[]>;
	watch(on: (change: FileChange) => void): Stop;
	/** Added beside DESIGN's four, for file.delete and file.move. */
	remove(path: DeckPath, by: Caller): Promise<Revision>;
	move(from: DeckPath, to: DeckPath, by: Caller): Promise<Revision>;
	/** History, wave 1: a file's revisions, oldest first; deleted ones included. */
	revisions?(path: DeckPath): Promise<Revision[]>;
	/** The file as it was at a revision of the deck; not_found if it did not exist then. */
	readAt?(path: DeckPath, rev: number): Promise<Bytes>;
	/** Write the file back as it was at a revision, as a new revision. */
	restore?(path: DeckPath, rev: number, by: Caller): Promise<Revision>;
}

export type Item = shapes.Item;
export type ItemOp = shapes.ItemOp;
export type ItemQuery = { ids?: string[]; depth?: number };
export type Change = { rev: number; ops: ItemOp[]; by: string; at?: number };

/** A drawing changes only by ops; undo, sync and news all read since(). */
export interface CanvasDoc {
	read(query?: ItemQuery): Item[];
	apply(ops: ItemOp[], by: Caller): { items: Item[]; rev: number };
	since(rev: number): Change[];
}

/** One stream; each listener gets what it may see. */
export interface Events {
	emit<E extends AnyEvent>(event: E, payload: Payload<E>, options?: EmitOptions): void;
	on<E extends AnyEvent>(event: E, hear: (payload: Payload<E>) => void): Stop;
}

/** What a handler sees. It never sees a token, nor which server it runs on. */
export interface Context {
	caller: Caller;
	deck: Deck;
	canvas(name?: string): CanvasDoc;
	/** A canvas's name from a name or title; left out, the caller's here. Refuses as canvas() does. */
	canvasName(name?: string): string;
	events: Events;
	note(text: string): void;
	/** The handling feature's own private state, never readable as a deck file. */
	store: Store;
	/** The connection the call came on; undefined for a one-shot HTTP call. */
	client?: Client;
}

/** A pen.dev node as the drawing's file holds it. */
export type PenNode = { type: string; id?: string; [key: string]: unknown };

/** One kind of thing on a canvas, as the server sees it. */
export interface ItemKind {
	type: string;
	fromPen(node: PenNode, at?: { canvas: string }): Item;
	toPen(item: Item, at?: { canvas: string }): PenNode;
	files?(item: Item): DeckPath[];
	picture?(item: Item, size: shapes.Box): Promise<Bytes>;
}

/** What a feature's start() is handed. */
export interface Kernel {
	deck: Deck;
	events: Events;
	canvas(name: string): CanvasDoc;
	/** Tokens for callers: issue, revoke, and who a token's caller is now. */
	callers: Tokens;
	/** A feature's private state, by the feature's name. */
	store(feature: string): Store;
	/** Every feature's item kinds, collected before any start runs. */
	kinds: ItemKind[];
}

/** The only way code enters the server. */
export interface Feature {
	name: string;
	calls: Handled<Context>[];
	items?: ItemKind[];
	start?(kernel: Kernel): Stop | void | Promise<Stop | void>;
	/** Supplies ctx.canvas and kernel.canvas. At most one feature gives it. */
	canvases?: (kernel: Kernel) => CanvasSource;
	/** Pages the feature serves over HTTP, outside /api/v1. */
	routes?: Route[];
}

// Seams added in wave 1. They only grow.

/** Where canvases come from: a name or title resolved, then its doc. */
export interface CanvasSource {
	doc(name: string): CanvasDoc;
	name(nameOrTitle: string): string;
}

/** A feature's private key-value state: .decks/<feature>/ on a folder. */
export interface Store {
	get(key: string): Promise<Bytes | undefined>;
	put(key: string, bytes: Bytes): Promise<void>;
	delete(key: string): Promise<void>;
	keys(prefix?: string): Promise<string[]>;
}

/** Tokens. The kernel keeps only hashes; revoke takes every token of a caller id. */
export interface Tokens {
	issue(who: Caller, label?: string): string;
	revoke(id: string): void;
	/** Who a caller of this kind is now; undefined refuses its tokens. */
	describe(kind: Who, now: (id: string) => Caller | undefined): void;
}

/** One live connection: a socket or an MCP session. */
export interface Client {
	id: string;
	closed(on: () => void): Stop;
}

/** clients: only these connections hear the event. */
export type EmitOptions = { clients?: string[] };

/** What a route answers. */
export type RouteAnswer = { status?: number; type: string; body: Bytes | string; headers?: Record<string, string> };

/** A page served over HTTP. Every request needs a token or ?pass=, which gives ctx.caller. */
export interface Route {
	method: "GET" | "POST";
	prefix: string;
	answer(ctx: Context, path: string, query: URLSearchParams, body: Bytes): Promise<RouteAnswer>;
}

/** Declare a feature: its name, its handled calls, its item kinds, its start. */
export const defineFeature = (feature: Feature): Feature => feature;

/** handle(call, fn) and handleAll(calls, fns), bound to the handler's context. */
export const { handle, handleAll } = handlersFor<Context>();

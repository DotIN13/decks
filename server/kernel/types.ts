import { handlersFor, layout, Refused, type AnyEvent, type Caller, type Handled, type Payload, type shapes } from "../../protocol/index.ts";

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
}

export type Item = shapes.Item;
export type ItemOp = shapes.ItemOp;
export type ItemQuery = { ids?: string[]; depth?: number };
export type Change = { rev: number; ops: ItemOp[]; by: string };

/** A drawing changes only by ops; undo, sync and news all read since(). */
export interface CanvasDoc {
	read(query?: ItemQuery): Item[];
	apply(ops: ItemOp[], by: Caller): { items: Item[]; rev: number };
	since(rev: number): Change[];
}

/** One stream; each listener gets what it may see. */
export interface Events {
	emit<E extends AnyEvent>(event: E, payload: Payload<E>): void;
	on<E extends AnyEvent>(event: E, hear: (payload: Payload<E>) => void): Stop;
}

/** What a handler sees. It never sees a token, nor which server it runs on. */
export interface Context {
	caller: Caller;
	deck: Deck;
	canvas(name?: string): CanvasDoc;
	events: Events;
	note(text: string): void;
}

/** A pen.dev node as the drawing's file holds it. */
export type PenNode = { type: string; id?: string; [key: string]: unknown };

/** One kind of thing on a canvas, as the server sees it. */
export interface ItemKind {
	type: string;
	fromPen(node: PenNode): Item;
	toPen(item: Item): PenNode;
	files?(item: Item): DeckPath[];
	picture?(item: Item, size: shapes.Box): Promise<Bytes>;
}

/** What a feature's start() is handed. */
export interface Kernel {
	deck: Deck;
	events: Events;
	canvas(name: string): CanvasDoc;
}

/** The only way code enters the server. */
export interface Feature {
	name: string;
	calls: Handled<Context>[];
	items?: ItemKind[];
	start?(kernel: Kernel): Stop | void | Promise<Stop | void>;
}

export type DefineFeature = (feature: Feature) => Feature;

/** handle(call, fn) and handleAll(calls, fns), bound to the handler's context. */
export const { handle, handleAll } = handlersFor<Context>();

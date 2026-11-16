import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { handlersFor, layout, Refused, type AnyCall, type AnyEvent, type Caller, type Envelope, type Handled, type RefusalCode, type Payload, type shapes, type Who } from "../../protocol/index.ts";

// What a feature is built on: the feature itself, the context its handlers
// see, the deck, the kernel its start is handed, item kinds and HTTP routes.
// These types only grow; each addition is announced to every owner.

export type Bytes = Uint8Array;
export type Stop = () => void;

// The feature.

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
	/** Calls this feature declares itself, beside the protocol's (Studio's own); checked the same way. */
	declares?: AnyCall[];
	/** Brings an old deck up to date, run in feature order before any start. */
	upgrade?(deck: Deck, version: VersionFile): Promise<void>;
}

/** Declare a feature: its name, its handled calls, its item kinds, its start. */
export const defineFeature = (feature: Feature): Feature => feature;

/** handle(call, fn) and handleAll(calls, fns), bound to the handler's context. */
export const { handle, handleAll } = handlersFor<Context>();

// A handler's context, and what it reaches: its client, events, its store.

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
	/** Make another call through the router, as the same caller and client; a refusal throws Refused. */
	call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
}

/** One live connection: a socket or an MCP session. */
export interface Client {
	id: string;
	closed(on: () => void): Stop;
}

/** One stream; each listener gets what it may see. */
export interface Events {
	emit<E extends AnyEvent>(event: E, payload: Payload<E>, options?: EmitOptions): void;
	on<E extends AnyEvent>(event: E, hear: (payload: Payload<E>) => void): Stop;
}

/** clients: only these connections hear the event. */
export type EmitOptions = { clients?: string[] };

/** A feature's private key-value state: .decks/<feature>/ on a folder. */
export interface Store {
	get(key: string): Promise<Bytes | undefined>;
	put(key: string, bytes: Bytes): Promise<void>;
	delete(key: string): Promise<void>;
	keys(prefix?: string): Promise<string[]>;
}

// A canvas, as a handler reaches it.

/** A drawing changes only by ops; undo, sync and news all read since(). */
export interface CanvasDoc {
	read(query?: ItemQuery): Item[];
	apply(ops: ItemOp[], by: Caller): { items: Item[]; rev: number };
	since(rev: number): Change[];
}

export type Item = shapes.Item;
export type ItemOp = shapes.ItemOp;
export type ItemQuery = { ids?: string[]; depth?: number };
export type Change = { rev: number; ops: ItemOp[]; by: string; at?: number };

/** Where canvases come from: a name or title resolved, then its doc. */
export interface CanvasSource {
	doc(name: string): CanvasDoc;
	name(nameOrTitle: string): string;
}

// The deck: paths, revisions, every read and write.

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

/** The deck's version record: exactly .decks/migrations.json, as text. */
export interface VersionFile {
	read(): Promise<string | undefined>;
	write(text: string): Promise<void>;
}

// The kernel a feature's start is handed, and the hooks it offers.

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
	/** Say which connected host answers a call no feature handles. At most one feature calls it. */
	relay(answerer: Answerer): void;
	/** Turn a name the protocol does not declare into a declared call. At most one feature calls it. */
	translate(translator: Translator): void;
	/** Make a call as a given caller from outside any handler (the sync client); the router's checks apply. */
	call(name: string, args: unknown, caller: Caller): Promise<Envelope<unknown>>;
	/** The machine's own folder for the kernel and features, outside any deck, user-only. */
	machine(): string;
	/** A stable id for this deck, made once and kept with the deck. */
	deckId(): string;
	/** A check before every handler or relay, after the who and argument checks; throw Refused to refuse. */
	guard(guard: Guard): void;
	/** Trim a call's value before it is answered (a list to what the caller may see); several run in order. */
	filter(filter: Filter): void;
	/** Whether a caller may see a canvas; an event of a canvas it may not see is not sent to it. */
	sees(sees: Sees): void;
	/** The deck's absolute folder on Decks-local; undefined in memory and on Studio. For old routes only. */
	folder(): string | undefined;
	/** The server's own address once a door listens, for apps and pictures; undefined before. */
	url(): string | undefined;
}

/** Tokens. The kernel keeps only hashes; revoke takes every token of a caller id. */
export interface Tokens {
	issue(who: Caller, label?: string): string;
	revoke(id: string): void;
	/** Who a caller of this kind is now; undefined refuses its tokens. */
	describe(kind: Who, now: (id: string, issued: Caller) => Caller | undefined): void;
}

/** The client id of the host that answers this call for this caller, or undefined. */
export type Answerer = (call: string, caller: Caller) => string | undefined;

/** An old name and its arguments, as a declared call; back turns its value into the old answer. */
export type Translator = (
	name: string,
	args: unknown,
) => { name: string; args: Record<string, unknown>; back?: (value: unknown) => unknown } | { refusal: { code: RefusalCode; message: string; hint?: string } } | undefined;

/** Refuses a call by throwing Refused; for a server with many people (Studio). */
export type Guard = (name: string, args: unknown, caller: Caller) => void | Promise<void>;
/** A call's value as the caller may have it. */
export type Filter = (name: string, value: unknown, caller: Caller) => unknown | Promise<unknown>;
/** Whether a caller may see a canvas. */
export type Sees = (caller: Caller, canvas: string) => boolean;

// Item kinds: one kind of thing on a canvas.

/** A pen.dev node as the drawing's file holds it. */
export type PenNode = { type: string; id?: string; [key: string]: unknown };

/** One kind of thing on a canvas, as the server sees it. */
export interface ItemKind {
	type: string;
	fromPen(node: PenNode, at?: { canvas: string }): Item;
	toPen(item: Item, at?: { canvas: string }): PenNode;
	files?(item: Item): DeckPath[];
	picture?(item: Item, size: shapes.Box): Promise<Bytes>;
	/** Run before an item of this kind is inserted or replaced; the canvas places what it answers.
	 *  The canvas passes the call's note and the deck. */
	prepare?(item: Item, at: { canvas: string; caller: Caller; note?: (text: string) => void; deck?: Deck }): Promise<Item>;
}

// HTTP routes a feature serves, and the socket parts an upgrade gets.

/** A page served over HTTP. Every request needs a token or ?pass=, which gives ctx.caller. */
export interface Route {
	method: "GET" | "POST" | "ANY";
	prefix: string;
	answer?(ctx: Context, path: string, query: URLSearchParams, body: Bytes): Promise<RouteAnswer>;
	/** GET only, no token needed; ctx.caller is PUBLIC, which may call nothing. For static pages. */
	public?: true;
	/** The raw request, unbuffered, called instead of answer: for a proxy. Decks-local only. */
	serve?(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void>;
	/** A token carried in the path, as /app/t/<pass>/<name>/: the token, and the path the route then sees. */
	tokenOf?(url: URL): { token: string; path: string } | undefined;
	/** A WebSocket or other upgrade under the prefix; the route resolves its caller itself. */
	upgrade?(req: IncomingMessage, socket: Duplex, head: Buffer, door: SocketDoor): void;
}

/** What a route answers. */
export type RouteAnswer = { status?: number; type: string; body: Bytes | string; headers?: Record<string, string> };

/** Who a public route's request is: a card of no canvas, so no call lets it in. */
export const PUBLIC: Caller = { kind: "card", id: "public", name: "public" };

/** One WebSocket connection, JSON or text messages. */
export interface Peer {
	send(text: string): void;
	close(code?: number, reason?: string): void;
	onText(hear: (text: string) => void): void;
	onClose(hear: () => void): void;
}

/** What a route's upgrade gets: the kernel's socket parts, to speak its own line. */
export interface SocketDoor {
	accept(): Peer | undefined;
	resolve(token: string | undefined): Caller | undefined;
	call(name: string, args: unknown, caller: Caller, client?: Client): Promise<Envelope<unknown>>;
	subscribe(sub: { caller: Caller; client?: string; events?: string[]; canvas?: string }, hear: (heard: { name: string; payload: Record<string, unknown> }) => void): Stop;
	/** A client for this connection; end() runs whatever waited for it to close. */
	client(): Client & { end(): void };
}

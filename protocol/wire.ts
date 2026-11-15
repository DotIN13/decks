import { REFUSAL_CODES, WHO } from "./call.ts";
import { any, arr, int, lit, named, obj, opt, str, union } from "./schema.ts";

// How a call travels, the same for every server and client. HTTP: POST
// /api/v1/<name> with the arguments as one JSON object, answered with the
// envelope. Socket: /api/v1/socket, JSON messages, hello first. A host gets
// an ask for each harness call it offered and sends one reply; it tells the
// harness's events, which the server fans out like its own.

// Where things are, and the environment a client reads.
export const API = "/api/v1";
export const callPath = (name: string): string => `${API}/${name}`;
export const SOCKET_PATH = `${API}/socket`;
/** Trade a pairing code, or the lock file's token, for a terminal's own. No call needs it first. */
export const LOGIN_PATH = `${API}/login`;
/** Every deck file, and a card as a page of its own, by deck path: what file.url and card.url answer. */
export const FILES_PATH = "/files/";
/** MCP as JSON-RPC over HTTP, on the caller's bearer token: the server's own door. */
export const MCP_PATH = "/mcp";
/** Where the Decks extension dials, with ?code=<pairing code>; kept from before the rewrite, since installed extensions dial it. */
export const TAB_RELAY_PATH = "/api/web/relay";
/** The widths, in pixels, a card's picture is made at; a screen asks for the rung its drawn width needs. */
export const PICTURE_LADDER = [192, 480, 800] as const;

/** Where a client finds a server and who it is, when it is not told. */
export const ENV = { url: "DECKS_URL", token: "DECKS_TOKEN", deck: "DECKS_DECK", tools: "DECKS_TOOLS", home: "DECKS_HOME" } as const;

// The lock file, the answer to every call, and login.
/** The lock file a running server keeps in its deck, readable by its user only. */
export const LOCK_FILE = ".decks/server.json";
export const Lock = named(
	"Lock",
	obj({ url: str(), pid: int(), protocol: str(), started: int(), token: str("The person's token, for a client on this machine as this user.") }),
	"What .decks/server.json holds while a server runs.",
);

export const Refusal = named("Refusal", obj({ code: lit(...REFUSAL_CODES), message: str(), hint: opt(str()) }));
export const Envelope = named(
	"Envelope",
	union(obj({ ok: lit(true), value: any(), notes: arr(str()) }), obj({ ok: lit(false), error: Refusal, notes: arr(str()) })),
	"Every answer: the value and its notes, or a refusal.",
);

export const Login = named("Login", obj({ code: opt(str()), label: opt(str()) }), "POST /api/v1/login: a code, or the lock's token as the bearer.");
export const LoginAnswer = named("LoginAnswer", obj({ token: str(), name: str() }), "The value of login's envelope.");

// The socket's messages.
const Who = obj({ kind: lit(...WHO), id: str(), name: str(), canvas: opt(str()) });

/** What a client sends on the socket. */
export const ClientMessage = named(
	"ClientMessage",
	union(
		obj({ type: lit("hello"), token: str(), protocol: str() }),
		obj({ type: lit("call"), id: str(), name: str(), args: any() }),
		obj({ type: lit("watch"), events: opt(arr(str())), canvas: opt(str()) }),
		obj({ type: lit("reply"), id: str(), envelope: Envelope }),
		obj({ type: lit("tell"), name: str(), payload: any() }),
	),
);

/** What a server sends on the socket. */
export const ServerMessage = named(
	"ServerMessage",
	union(
		obj({ type: lit("hello"), protocol: str(), caller: Who }),
		obj({ type: lit("answer"), id: str(), envelope: Envelope }),
		obj({ type: lit("event"), name: str(), payload: any() }),
		obj({ type: lit("ask"), id: str(), name: str(), args: any(), caller: Who }),
	),
);

import { find, readTokens, tokensFile } from "./find.ts";
import { clientFor, type Client, type Typed } from "./client.ts";
import { DecksError, type Answered } from "./http.ts";
import { host, type Answerer, type Host, type HostOptions } from "./host.ts";
import { Line, type Ask } from "./line.ts";
import type { Heard, Stream, Watch } from "./socket.ts";

// @decks/sdk: every call, typed from the protocol, over HTTP; the event
// stream over the socket. decks.item.move({ id, at }) answers the item as it
// now is; a refusal throws a DecksError with code, message and hint. A page
// imports @decks/sdk/browser, which holds no node module.

export { clientFor, DecksError, find, host, Line, readTokens, tokensFile, type Answered, type Answerer, type Ask, type Client, type Heard, type Host, type HostOptions, type Stream, type Typed, type Watch };

export type ConnectOptions = { url?: string; token?: string; notes?: (note: string) => void };

/** Reach a server: the url and token given, else found from the environment or the deck's lock file. */
export async function connect(options: ConnectOptions = {}): Promise<Client> {
	const found = await find(options);
	return clientFor(found.url, found.token, options.notes);
}


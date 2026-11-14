// @decks-next/sdk/browser: what a page needs, with no node module behind it.
// A page knows its server and token, so it never looks for them.

export { clientFor, type Client, type Typed } from "./client.ts";
export { DecksError, type Answered } from "./http.ts";
export { Line, type Ask } from "./line.ts";
export type { Heard, Stream, Watch } from "./socket.ts";

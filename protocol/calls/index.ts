import type { AnyCall } from "../call.ts";
import * as account from "./account.ts";
import * as agent from "./agent.ts";
import * as app from "./app.ts";
import * as canvas from "./canvas.ts";
import * as card from "./card.ts";
import * as chat from "./chat.ts";
import * as deck from "./deck.ts";
import * as file from "./file.ts";
import * as frame from "./frame.ts";
import * as google from "./google.ts";
import * as item from "./item.ts";
import * as port from "./port.ts";
import * as runtime from "./runtime.ts";
import * as studio from "./studio.ts";
import * as tab from "./tab.ts";
import * as view from "./view.ts";

// Every call, by noun, and one flat list in table order.

export const byNoun = { deck, canvas, item, card, file, frame, app, port, agent, view, tab, studio, google, chat, account, runtime };
export { account, agent, app, canvas, card, chat, deck, file, frame, google, item, port, runtime, studio, tab, view };

export const CALLS: readonly AnyCall[] = Object.values(byNoun).flatMap((noun) => Object.values(noun) as AnyCall[]);
export const CALL_BY_NAME: ReadonlyMap<string, AnyCall> = new Map(CALLS.map((call) => [call.name, call]));

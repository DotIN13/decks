// The calls a card may ask the page to make for it, in today's names and
// positional arguments (the canvas library speaks them), as the new call and
// its one object of arguments. Pure: no store, no DOM.

type Args = readonly unknown[];
const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

const CARD_CALLS: Record<string, (args: Args) => [string, Record<string, unknown>]> = {
	"agent.me": () => ["agent.me", {}],
	"agent.inbox": () => ["agent.inbox", {}],
	"agent.list": (args) => ["agent.list", rec(args[0])],
	"agent.get": (args) => ["agent.get", { agent: String(args[0] ?? "") }],
	"agent.send": (args) => ["agent.send", { agent: String(args[0] ?? ""), ...rec(args[1]) }],
	"agent.queue": (args) => ["agent.queue", { agent: String(args[0] ?? ""), ...rec(args[1]) }],
	"agent.create": (args) => ["agent.create", rec(args[0])],
	"view.goto": (args) => ["view.goto", { canvas: String(args[0] ?? "") }],
};

/** Whether a card may ask the page for this call. */
export const cardMayCall = (verb: string): boolean => verb in CARD_CALLS;

/** A card's call as the new call: its name and its arguments. */
export function cardCall(verb: string, args: Args): [string, Record<string, unknown>] {
	const make = CARD_CALLS[verb];
	if (!make) throw new Error(`${verb} is not a card's to call.`);
	return make(args);
}

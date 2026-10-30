import type { MessageMention, MessagePart } from "@decks/protocol";

/**
 * A message's parts as a browser sent them (`agent.prompt`, `agent.queue`), made safe to keep with the
 * message: only the fields `MessagePart` has, strings cut to a size, at most so many parts. They are
 * what the conversation draws, never what the agent reads, so anything unrecognised is dropped rather
 * than refused, and a message whose parts are all unreadable is kept as its text alone.
 */

const PARTS_LIMIT = 200;
/** A comment's note or a pasted paragraph can be long; the agent got all of it, and so does the card. */
const TEXT_LIMIT = 20_000;
const FIELD_LIMIT = 2_000;
const ITEMS_LIMIT = 50;
const KINDS = ["comment", "board", "item", "file"];

const str = (value: unknown, limit = FIELD_LIMIT) => (typeof value === "string" ? value.slice(0, limit) : undefined);

export function cleanParts(raw: unknown): MessagePart[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out: MessagePart[] = [];
	for (const part of raw.slice(0, PARTS_LIMIT)) {
		if (!part || typeof part !== "object") continue;
		const value = part as Record<string, unknown>;
		if (value.type === "text") {
			const text = str(value.text, TEXT_LIMIT);
			if (text) out.push({ type: "text", text });
			continue;
		}
		if (value.type !== "mention" || !KINDS.includes(value.kind as string)) continue;
		const id = str(value.id);
		if (!id) continue;
		const mention: MessageMention = {
			type: "mention",
			kind: value.kind as MessageMention["kind"],
			id,
			name: str(value.name) || id,
			from: value.from === "canvas" ? "canvas" : "you",
		};
		for (const key of ["label", "path", "component"] as const) {
			const one = str(value[key]);
			if (one) mention[key] = one;
		}
		for (const key of ["quote", "note", "exact"] as const) {
			const one = str(value[key], TEXT_LIMIT);
			if (one) mention[key] = one;
		}
		if (Array.isArray(value.items)) {
			const items = value.items.slice(0, ITEMS_LIMIT).map((one) => str(one)).filter((one): one is string => !!one);
			if (items.length) mention.items = items;
		}
		out.push(mention);
	}
	return out.some((part) => part.type === "mention") ? out : undefined;
}

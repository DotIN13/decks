import { callPath, type Refusal, type RefusalCode } from "../../protocol/index.ts";

// One call over HTTP: POST the arguments, read the envelope. A refusal is
// thrown as a DecksError with its code, sentence and hint.

export class DecksError extends Error {
	readonly code: RefusalCode;
	readonly hint: string | undefined;
	readonly notes: string[];
	constructor(refusal: Refusal, notes: string[] = []) {
		super(refusal.message);
		this.name = "DecksError";
		this.code = refusal.code;
		this.hint = refusal.hint;
		this.notes = notes;
	}
}

export type Answered = { value: unknown; notes: string[] };

type Envelope = { ok: true; value: unknown; notes?: string[] } | { ok: false; error: Refusal; notes?: string[] };

/** Make one call; answers the value and its notes, or throws the refusal. */
export async function post(url: string, token: string | undefined, name: string, args: unknown): Promise<Answered> {
	let response: Response;
	try {
		response = await fetch(`${url}${callPath(name)}`, {
			method: "POST",
			headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify(args ?? {}),
		});
	} catch (error) {
		throw new DecksError({ code: "unavailable", message: `Could not reach Decks at ${url}: ${(error as Error).message}.`, hint: "deck.get" });
	}
	const envelope = (await response.json().catch(() => undefined)) as Envelope | undefined;
	if (!envelope || typeof envelope.ok !== "boolean") {
		throw new DecksError({ code: "unavailable", message: `Decks at ${url} answered ${response.status} without an envelope.` });
	}
	if (!envelope.ok) throw new DecksError(envelope.error, envelope.notes ?? []);
	return { value: envelope.value, notes: envelope.notes ?? [] };
}

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { LOGIN_PATH } from "../../protocol/index.ts";
import { DecksError, find } from "../sdk/index.ts";

// decks login [code]: the person at a terminal gets a token of its own,
// with a code from decks deck pair, or on the server's machine with the
// lock file's token. It is kept by address in ~/.decks/tokens.json.

export async function login(words: string[], file: string): Promise<string> {
	const code = words.find((word) => /\d/.test(word))?.replace(/\D/g, "");
	const found = await find({});
	const bearer = code ? undefined : found.token;
	if (!code && !bearer) throw new DecksError({ code: "refused", message: `No code, and no lock file to log in with at ${found.url}.`, hint: "deck.pair" });
	let response: Response;
	try {
		response = await fetch(`${found.url}${LOGIN_PATH}`, {
			method: "POST",
			headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
			body: JSON.stringify({ ...(code ? { code } : {}), label: `decks login on ${hostname()}` }),
		});
	} catch (error) {
		throw new DecksError({ code: "unavailable", message: `Could not reach Decks at ${found.url}: ${(error as Error).message}.` });
	}
	const body = (await response.json().catch(() => ({}))) as { ok?: boolean; value?: { token?: string; name?: string }; error?: { code: never; message: string; hint?: string } };
	const answer = { ...body.value, error: body.error };
	if (!answer.token) throw new DecksError(answer.error ?? { code: "refused", message: `Decks at ${found.url} gave no token (${response.status}).`, hint: "deck.pair" });
	const tokens = { ...tokensFromFile(file), [found.url]: answer.token };
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	writeFileSync(file, `${JSON.stringify(tokens, null, "\t")}\n`, { mode: 0o600 });
	chmodSync(file, 0o600);
	return `Logged in to ${answer.name ?? found.url}. The token is in ${file}.`;
}

export function logout(url: string, file: string): string {
	const tokens = tokensFromFile(file);
	if (!tokens[url]) return `Not logged in to ${url}.`;
	delete tokens[url];
	writeFileSync(file, `${JSON.stringify(tokens, null, "\t")}\n`, { mode: 0o600 });
	return `Logged out of ${url}.`;
}

export const readText = (file: string) => readFileSync(file, "utf8");

/** The tokens decks login kept, by server address. */
function tokensFromFile(file: string): Record<string, string> {
	try {
		const saved = JSON.parse(readFileSync(file, "utf8")) as unknown;
		return saved && typeof saved === "object" ? (saved as Record<string, string>) : {};
	} catch {
		return {};
	}
}

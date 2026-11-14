import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";

/**
 * The OpenCode 2 client, signed in to the shared server.
 *
 * OpenCode 2's server always asks for its password, as HTTP Basic with the user `opencode`;
 * the password is the secret the manager minted for this server's lifetime.
 */
export type Opencode2Client = ReturnType<typeof OpenCode.make>;

export function connect(url: string, secret: string): Opencode2Client {
	return OpenCode.make({ baseUrl: url, headers: { authorization: `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}` } });
}

/**
 * The person's opencode 1 API keys, offered to OpenCode 2 where it has none.
 *
 * OpenCode 2 keeps keys in its own database and, started in its own folders, begins with none,
 * so an OpenCode 2 agent would otherwise have no models until the person signed every provider
 * in again. Only **API keys** are copied, and only for a provider OpenCode 2 has no connection
 * for, through OpenCode 2's own call for adding one. Logins with a refresh token are not:
 * two programs refreshing one token sign each other out, so those are the person's to sign in
 * with `opencode2 auth`.
 *
 * Once per server lifetime is enough, and a failure is a shorter model list, not a dead agent.
 */
const offered = new Set<string>();

export async function offerKeys(client: Opencode2Client, url: string, directory: string, authFile = join(homedir(), ".local", "share", "opencode", "auth.json")): Promise<string[]> {
	if (offered.has(url)) return [];
	offered.add(url);
	let keys: Record<string, { type?: string; key?: string }>;
	try {
		keys = JSON.parse(readFileSync(authFile, "utf8")) as typeof keys;
	} catch {
		return [];
	}
	const location = { directory };
	let known: Array<{ id: string; connections?: unknown[] }>;
	try {
		known = ((await client.integration.list({ location } as never)) as unknown as { data: typeof known }).data;
	} catch {
		return [];
	}
	const added: string[] = [];
	for (const [id, entry] of Object.entries(keys)) {
		if (entry?.type !== "api" || !entry.key) continue;
		const integration = known.find((one) => one.id === id);
		// A provider OpenCode 2 does not know is not offered, and one it already has a key for is
		// left alone: the person's OpenCode 2 sign-in wins over their opencode 1 one.
		if (!integration || (integration.connections?.length ?? 0) > 0) continue;
		try {
			await client.integration.connect.key({ integrationID: id, location, key: entry.key, label: "From opencode 1" } as never);
			added.push(id);
		} catch {
			/* that provider stays unsigned; the others still go */
		}
	}
	return added;
}

import type { AgentUiHost } from "../composer/host.ts";

// What a host gives the chat and composer, and what it has left out, so a page can see which plain
// fallbacks it will get before it mounts them.

/** Every field a host may give; all are optional. */
export const HOST_FIELDS = ["notice", "api", "authHeaders", "AgentFace", "AgentMenu", "FiveHour"] as const;

/** The fields this host leaves to their fallbacks. */
export function missingFromHost(host: AgentUiHost): string[] {
	return HOST_FIELDS.filter((field) => host[field] === undefined);
}

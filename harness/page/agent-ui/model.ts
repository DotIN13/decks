import type { AgentUiHost } from "../composer/host.ts";

// What a host gives the chat and composer, and what it has left out, so a page can see which plain
// fallbacks it will get before it mounts them.

/** Every field a host may give; all are optional. */
export const HOST_FIELDS = ["notice", "api", "authHeaders", "AgentFace", "AgentMenu", "FiveHour"] as const;

/** The fields this host leaves to their fallbacks. */
export function missingFromHost(host: AgentUiHost): string[] {
	return HOST_FIELDS.filter((field) => host[field] === undefined);
}

/** The design tokens the sheets read from the host page (the harness's page defines them in shell/tokens.css). */
export const HOST_TOKENS = [
	"--bg", "--bg-deep", "--panel", "--fg", "--muted", "--faint", "--line", "--line-strong", "--shadow", "--shadow-row",
	"--color-fg", "--color-muted", "--color-accent", "--color-accent-soft", "--color-danger", "--color-warn", "--color-grey-100", "--color-grey-1100",
	"--font-mono", "--type-body", "--type-hint", "--type-label", "--type-micro", "--type-name", "--type-note", "--type-title", "--type-ui",
	"--radius-chip", "--radius-item", "--radius-panel", "--radius-pill", "--radius-thumb", "--row-radius",
	"--keyboard", "--z-conversation",
] as const;

/** Read with a fallback of their own, so a host may leave them out: the accent, and the dock's height. */
export const OPTIONAL_TOKENS = ["--accent", "--border-strong", "--dock"] as const;

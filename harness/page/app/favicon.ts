import { createTabBadge } from "@decks/agent-ui/alerts";

/**
 * The tab's badge: `/favicon-badge.svg` and `(n) Decks` while something happened that you have
 * not looked at, `/favicon.svg` and `Decks` again once you have (`@decks/agent-ui/alerts`).
 */
export const setUnattended = createTabBadge({ title: "Decks", plain: "/favicon.svg", badged: "/favicon-badge.svg" });

/**
 * The sandbox a card (or an old board) from someone else runs in, as the tokens of an iframe's
 * `sandbox` attribute or a `Content-Security-Policy: sandbox …`: scripts, forms, pop-ups, dialogs
 * and downloads, and never `allow-same-origin`, so its page has an opaque origin of its own and
 * reaches nothing of the page that shows it and no cookie of the address it came from.
 *
 * One list for everyone who serves another person's page: the live card headers below
 * (`LIVE_CARD_POLICY`) and `@decks/hub`'s `SHARED_SANDBOX` for a friend's canvas. No Node, so a
 * browser bundle may import it.
 */
export const CARD_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/**
 * A value that is user data (an item's id, a card's path) escaped for a CSS selector. `CSS.escape`
 * is everywhere it matters; the fallback is for a test's DOM.
 */
export function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

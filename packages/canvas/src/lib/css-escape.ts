/** A string as a CSS selector reads it, with a stand-in where there is no `CSS.escape` (a test). */
export function cssEscape(value: string): string {
	return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

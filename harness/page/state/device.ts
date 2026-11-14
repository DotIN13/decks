/**
 * Which browser this is, as the server is told with each camera reading (`camera.set`).
 *
 * A camera is agent × canvas × device: a phone and a laptop on the same canvas look at different
 * places, and the server keeps one reading per device rather than letting the last one in replace
 * the other. Made once and kept in this browser's storage; with storage refused, one per page load.
 */
const KEY = "decks.device";

function make(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const deviceId: string = (() => {
	try {
		const kept = localStorage.getItem(KEY);
		if (kept) return kept;
		const made = make();
		localStorage.setItem(KEY, made);
		return made;
	} catch {
		return make();
	}
})();

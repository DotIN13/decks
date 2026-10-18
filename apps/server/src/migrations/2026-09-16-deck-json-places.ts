/**
 * 2026-09-16: where a board sits belongs to a canvas, not to `deck.json`.
 *
 * Older files kept a `boards` map of `{ x, y, w, h }`. Its `x`/`y` are read once more, as the places
 * a canvas starts from (`deck/loader.ts` hands them to the first canvas that draws the board), and
 * the map is dropped on the next write of `deck.json` (`deck/schema.ts`). A size is the board's own
 * file's business now, so `w`/`h` are ignored.
 *
 * Runs on read, whenever `deck.json` is parsed.
 */
export function oldBoardPlaces(
	boards: unknown,
	normalize: (path: string) => string,
	warnings: string[],
): Record<string, { x: number; y: number }> {
	const places: Record<string, { x: number; y: number }> = {};
	if (!boards || typeof boards !== "object" || Array.isArray(boards)) return places;
	for (const [path, value] of Object.entries(boards as Record<string, unknown>)) {
		const at = value as { x?: unknown; y?: unknown } | null;
		const x = Number(at?.x);
		const y = Number(at?.y);
		if (Number.isFinite(x) && Number.isFinite(y)) places[normalize(path)] = { x: Math.round(x), y: Math.round(y) };
		else warnings.push(`deck.json: ignoring the position of "${path}". x and y must be numbers.`);
	}
	return places;
}

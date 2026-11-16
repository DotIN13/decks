// A waiting comment saved before its `board` field was named `path`, read as one with `path`.

/** The same comment with `path`: an old one's `board` moved into it; anything else as it was. */
export function commentFromOld(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const { board, ...rest } = value as Record<string, unknown>;
	if (rest.path !== undefined || typeof board !== "string") return value;
	return { ...rest, path: board };
}

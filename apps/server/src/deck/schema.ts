import type { Root } from "@decks/protocol";

/**
 * `deck.json`, as it is on disk.
 *
 * A hand-written file first and a machine-written one second: the user is meant
 * to be able to open it, see where their boards are, add a root, and save. So
 * parsing is forgiving — an unreadable field is a default and a warning, never a
 * refusal to open the deck — and writing preserves keys we do not know about.
 */
export interface DeckFile {
	version: 1;
	name?: string;
	/**
	 * Board path (deck-relative) -> the size of a board that cannot say its own.
	 *
	 * **Not where a board sits.** A place belongs to a stage (`AgentRecord.positions`) and
	 * is written there; this file stopped holding an arrangement the day two conversations
	 * could look at one deck from different places.
	 *
	 * What is left is a *size*, and only for the formats with nowhere else to keep it: a
	 * component board carries `<meta name="board">` and is ignored here, but a foreign HTML
	 * page has no tag this app may edit and a slide deck's width is the user's drag rather
	 * than the file's to hold. Optional, because most boards do not need one and an absent
	 * key is smaller to read than one that repeats a default.
	 */
	sizes?: Record<string, { w?: number; h?: number }>;
	/** Directories embeds may reach outside the deck. `~` is allowed. */
	roots?: Array<string | { path: string; writable?: boolean }>;
	/** Anything we do not know about, kept so a write does not delete it. */
	[key: string]: unknown;
}

export interface ParsedDeckFile {
	file: DeckFile;
	warnings: string[];
}

/**
 * The keys this build understands.
 *
 * `boards` is here and not on `DeckFile`: it is the older name for `sizes`, carrying a
 * position as well, and it is consumed so that a write drops it rather than carrying it
 * forward forever. Nothing reads an `x` or a `y` out of it.
 */
const KNOWN = new Set(["version", "name", "boards", "sizes", "roots"]);

export function parseDeckFile(text: string): ParsedDeckFile {
	const warnings: string[] = [];
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		warnings.push(`deck.json is not valid JSON (${(error as Error).message}); starting from defaults.`);
		return { file: { version: 1 }, warnings };
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		warnings.push("deck.json is not an object; starting from defaults.");
		return { file: { version: 1 }, warnings };
	}

	const source = raw as Record<string, unknown>;
	const file: DeckFile = { version: 1 };

	if (typeof source.name === "string") file.name = source.name;
	if (source.version !== undefined && source.version !== 1) {
		warnings.push(`deck.json version ${String(source.version)} is newer than this build understands.`);
	}

	/*
	 * Sizes, and where they come from.
	 *
	 * `boards` is read first and `sizes` second, so the current key wins when a file has
	 * both — which is what a deck saved by this build but hand-edited from an older one
	 * looks like. A legacy entry's `x`/`y` is deliberately not read: the arrangement is a
	 * stage's now, and there is nobody here to attribute it to.
	 *
	 * A size is dropped silently when absent and warned about when present and wrong — a
	 * size of `0` or `-40` is a board nobody can see.
	 */
	const sizes: Record<string, { w?: number; h?: number }> = {};
	for (const container of [source.boards, source.sizes]) {
		if (!container || typeof container !== "object" || Array.isArray(container)) continue;
		for (const [path, value] of Object.entries(container as Record<string, unknown>)) {
			const at = value as { w?: unknown; h?: unknown } | null;
			const size: { w?: number; h?: number } = { ...sizes[normalizeBoardPath(path)] };
			for (const key of ["w", "h"] as const) {
				if (at?.[key] === undefined) continue;
				const measure = Number(at[key]);
				if (Number.isFinite(measure) && measure > 0) size[key] = Math.round(measure);
				else warnings.push(`deck.json: ignoring ${key} for "${path}". It must be a number above zero.`);
			}
			if (Object.keys(size).length > 0) sizes[normalizeBoardPath(path)] = size;
		}
	}
	if (Object.keys(sizes).length > 0) file.sizes = sizes;

	if (source.roots !== undefined) {
		if (Array.isArray(source.roots)) file.roots = source.roots as DeckFile["roots"];
		else warnings.push("deck.json: roots must be an array; ignoring it.");
	}

	for (const [key, value] of Object.entries(source)) {
		if (!KNOWN.has(key)) file[key] = value;
	}

	return { file, warnings };
}

/** Forward slashes everywhere, no leading "./", so one board has one key. */
export function normalizeBoardPath(path: string): string {
	return path.split("\\").join("/").replace(/^\.\//, "");
}

export function serializeDeckFile(file: DeckFile): string {
	// version first, then the parts a human scans for, then whatever else was
	// in the file — key order is the only formatting a JSON file has.
	// `boards` is destructured only to be dropped: it is the older name for `sizes`, and a
	// file that has been read once must not carry a position into the next write.
	const { version, name, sizes, roots, boards: _legacy, ...rest } = file;
	const ordered: Record<string, unknown> = { version: version ?? 1 };
	if (name !== undefined) ordered.name = name;
	if (sizes !== undefined && Object.keys(sizes).length > 0) ordered.sizes = sizes;
	if (roots !== undefined) ordered.roots = roots;
	for (const [key, value] of Object.entries(rest)) ordered[key] = value;
	return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function declaredRoots(file: DeckFile): Array<Omit<Root, "exists">> {
	return (file.roots ?? []).flatMap((entry) => {
		if (typeof entry === "string") return [{ path: entry, writable: false }];
		if (entry && typeof entry.path === "string") return [{ path: entry.path, writable: entry.writable === true }];
		return [];
	});
}

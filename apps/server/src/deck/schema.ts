import type { Root } from "@decks/protocol";

/**
 * `deck.json`, as it is on disk.
 *
 * A hand-written file first and a machine-written one second: the user is meant to be able to open
 * it, name the deck, add a root, and save. So parsing is forgiving — an unreadable field is a
default and a warning, never a refusal to open the deck — and writing preserves keys we do not know
 * about.
 *
 * **It holds no board state.** A place belongs to a stage (`AgentRecord.positions`), a size belongs
 * to the board's own file, and this app never writes this file at all: what is left is the deck's
 * name and the roots its embeds may reach. A `boards` map from an older build is still read — for
 * the arrangement, which seeds a stage — and is not written back.
 */
export interface DeckFile {
	version: 1;
	name?: string;
	/** Directories embeds may reach outside the deck. `~` is allowed. */
	roots?: Array<string | { path: string; writable?: boolean }>;
	/** Anything we do not know about, kept so a write does not delete it. */
	[key: string]: unknown;
}

export interface ParsedDeckFile {
	file: DeckFile;
	/**
	 * The arrangement an older `boards` map held, kept as a **seed** rather than as state.
	 *
	 * Where a board sits belongs to a stage now, so this is never written back and never read after
	 * the first send. It is the place a conversation that has not moved that board starts from, so a
	 * deck somebody laid out by hand does not open in rows of three the day the map stops being
	 * authoritative. The stage records whatever it is handed, and the map is gone from the file on
	 * the next write — which is what makes this a migration rather than a second source of truth.
	 */
	arrangement: Record<string, { x: number; y: number }>;
	warnings: string[];
}

/**
 * The keys this build understands.
 *
 * `boards` and `sizes` are here and not on `DeckFile`: both are names an older build wrote for board
 * state, and both are consumed so a write drops them rather than carrying them forward forever. A
 * `boards` map still gives up its `x`/`y` as the arrangement a stage is seeded from; its `w`/`h`, and
 * everything under `sizes`, are ignored — a size is the board file's business.
 */
const KNOWN = new Set(["version", "name", "boards", "sizes", "roots"]);

export function parseDeckFile(text: string): ParsedDeckFile {
	const warnings: string[] = [];
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		warnings.push(`deck.json is not valid JSON (${(error as Error).message}); starting from defaults.`);
		return { file: { version: 1 }, arrangement: {}, warnings };
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		warnings.push("deck.json is not an object; starting from defaults.");
		return { file: { version: 1 }, arrangement: {}, warnings };
	}

	const source = raw as Record<string, unknown>;
	const file: DeckFile = { version: 1 };

	if (typeof source.name === "string") file.name = source.name;
	if (source.version !== undefined && source.version !== 1) {
		warnings.push(`deck.json version ${String(source.version)} is newer than this build understands.`);
	}

	/*
	 * And the places, which are a seed rather than state.
	 *
	 * Only an older `boards` map has them: a file this build wrote does not, because a place belongs to
	 * a stage. A pair that is not two finite numbers is dropped with a warning — the board still exists,
	 * and the auto-layout is where it would have gone anyway. Its `w`/`h`, if it had any, are ignored:
	 * a size is the board's own file's business now.
	 */
	const arrangement: Record<string, { x: number; y: number }> = {};
	if (source.boards && typeof source.boards === "object" && !Array.isArray(source.boards)) {
		for (const [path, value] of Object.entries(source.boards as Record<string, unknown>)) {
			const at = value as { x?: unknown; y?: unknown } | null;
			const x = Number(at?.x);
			const y = Number(at?.y);
			if (Number.isFinite(x) && Number.isFinite(y)) arrangement[normalizeBoardPath(path)] = { x: Math.round(x), y: Math.round(y) };
			else warnings.push(`deck.json: ignoring the position of "${path}". x and y must be numbers.`);
		}
	}

	if (source.roots !== undefined) {
		if (Array.isArray(source.roots)) file.roots = source.roots as DeckFile["roots"];
		else warnings.push("deck.json: roots must be an array; ignoring it.");
	}

	for (const [key, value] of Object.entries(source)) {
		if (!KNOWN.has(key)) file[key] = value;
	}

	return { file, arrangement, warnings };
}

/** Forward slashes everywhere, no leading "./", so one board has one key. */
export function normalizeBoardPath(path: string): string {
	return path.split("\\").join("/").replace(/^\.\//, "");
}

export function serializeDeckFile(file: DeckFile): string {
	// version first, then the parts a human scans for, then whatever else was
	// in the file — key order is the only formatting a JSON file has.
	// `boards` and `sizes` are destructured only to be dropped: `boards` is the older name for the
	// arrangement, and a size is the board file's own business now, so neither is carried forward.
	const { version, name, roots, boards: _legacy, sizes: _sizes, ...rest } = file;
	const ordered: Record<string, unknown> = { version: version ?? 1 };
	if (name !== undefined) ordered.name = name;
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

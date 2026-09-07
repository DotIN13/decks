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
	 * Board path (deck-relative) -> where it sits on the stage, and how big it is.
	 *
	 * `x` and `y` are the user's drags and have always been here. `w` and `h` are newer and
	 * are **only** for boards that cannot say their own size: a component board carries
	 * `<meta name="board">` and this is ignored for it, but a markdown file has nowhere to
	 * put a number. Optional, because most boards do not need them and a key that is absent
	 * is smaller to read than one that repeats a default.
	 */
	boards?: Record<string, { x: number; y: number; w?: number; h?: number }>;
	/** Directories embeds may reach outside the deck. `~` is allowed. */
	roots?: Array<string | { path: string; writable?: boolean }>;
	/** Anything we do not know about, kept so a write does not delete it. */
	[key: string]: unknown;
}

export interface ParsedDeckFile {
	file: DeckFile;
	warnings: string[];
}

const KNOWN = new Set(["version", "name", "boards", "roots"]);

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

	if (source.boards && typeof source.boards === "object" && !Array.isArray(source.boards)) {
		const boards: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
		for (const [path, value] of Object.entries(source.boards as Record<string, unknown>)) {
			const at = value as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null;
			const x = Number(at?.x);
			const y = Number(at?.y);
			/*
			 * A size is read independently of a position, because they fail independently:
			 * a hand-edited `w` with a typo in it should not also lose the drag somebody
			 * made, and a board whose position was never written can still have been
			 * resized. Both are dropped silently when absent and warned about when present
			 * and wrong — a size of `0` or `-40` is a board nobody can see.
			 */
			const size: { w?: number; h?: number } = {};
			for (const key of ["w", "h"] as const) {
				if (at?.[key] === undefined) continue;
				const measure = Number(at[key]);
				if (Number.isFinite(measure) && measure > 0) size[key] = Math.round(measure);
				else warnings.push(`deck.json: ignoring ${key} for "${path}". It must be a number above zero.`);
			}
			// A position that is not a pair of numbers is no position at all; the
			// board still exists and gets placed by the auto-layout instead.
			if (Number.isFinite(x) && Number.isFinite(y)) boards[normalizeBoardPath(path)] = { x, y, ...size };
			else warnings.push(`deck.json: ignoring the position of "${path}". x and y must be numbers.`);
		}
		file.boards = boards;
	}

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
	const { version, name, boards, roots, ...rest } = file;
	const ordered: Record<string, unknown> = { version: version ?? 1 };
	if (name !== undefined) ordered.name = name;
	if (boards !== undefined) ordered.boards = boards;
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

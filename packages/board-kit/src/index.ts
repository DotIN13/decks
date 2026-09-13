/**
 * The board vocabulary, as data, in one place.
 *
 * A board is HTML, and what may appear on one is a closed set: seven classes
 * `runtime/lib/board.css` styles, five kinds of component the app can put on a board, and
 * three tones a callout may carry. That set used to be written down in eight files across
 * three workspaces — two unions here, the splice's placeholders there, the palette's key,
 * its label, its icon and its default size, the cheat sheet, the stylesheet, the authoring
 * skill and the agent's own reference — with nothing that noticed them disagreeing.
 *
 * They had already drifted, in the two ways a list like this drifts:
 *
 * - `callout` was a box class the inspector could switch to and **no palette could place**,
 *   because adding a kind meant remembering four files and one of them was forgotten;
 * - the authoring skill taught `kpi`, `table` and `chip` — which are real classes in the
 *   stylesheet — as though they were box classes, because nothing said which was which.
 *
 * This package is a leaf: no dependencies, no imports, nothing to configure. The server and
 * the browser both import it, and a test on each side checks the part that cannot be data —
 * that `board.css` styles every class named here, and that the skill teaches exactly this
 * list.
 *
 * **What it deliberately does not own:** the markup a new component is made of (that is a
 * splice, and it lives with the other splices in `boards/patch.ts`), the icons (they are
 * components), and the prose in the skill. Those are checked against this, not generated
 * from it — a generated sentence in an agent's instructions would be worse than the copy.
 */

/**
 * The kinds of component the app can put on a board.
 *
 * Each one is a `BoardPatch` insert, and each has its own branch in `applyPatches` — a
 * sticky is a `div` with a class, an embed is a `div` with `data-embed` — so this list is
 * the union the wire speaks rather than the markup it produces.
 */
export const COMPONENT_KINDS = ["sticky", "card", "text", "image", "embed"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/**
 * What the palette knows about a kind, and what the server needs to make one.
 *
 * `key` is the one field that says whether the palette can place it. `image` has no key on
 * purpose: an image arrives by dropping one on a board, and a button that opened a file
 * picker for a picture is a second, worse way to do the same thing.
 */
export interface ComponentSpec {
	readonly kind: ComponentKind;
	/** What the palette and the cheat sheet call it. */
	readonly label: string;
	/** The class the inserted element carries. */
	readonly className: string;
	/** The key that arms it, lowercase. Absent for a kind the palette does not offer. */
	readonly key?: string;
	/** The size a new one is given, in board pixels. */
	readonly size: { readonly width: number; readonly height?: number };
	/**
	 * The words a new one is created with.
	 *
	 * The server's, not the browser's: an insert carries a rect and no text, and the file is
	 * written here — so the placeholder has to be known on the server. Absent for a kind that
	 * holds no text of its own, which is what `undefined` means here rather than `""`.
	 */
	readonly text?: string;
}

/*
 * **A callout is not on this list, and that is a decision rather than an omission.**
 *
 * It is one of the four box classes, so it is a thing a person wants — but it is *made* by
 * swapping a box, and the inspector offers that swap for every box already. A palette button
 * would be a second way to do one thing and one more key on a palette that has five, so
 * `callout` is reachable and not insertable. If somebody decides the other way, one entry
 * here is the whole change — the key, the label, the button and the default size all follow
 * from it — and the test beside this file will say so.
 */

/** The palette's order, which is the order the buttons are drawn in. */
export const COMPONENTS: readonly ComponentSpec[] = [
	{ kind: "sticky", label: "Sticky note", className: "sticky", key: "s", size: { width: 220 }, text: "…" },
	{ kind: "card", label: "Card", className: "card", key: "c", size: { width: 360 }, text: "Untitled" },
	{ kind: "text", label: "Text", className: "text", key: "t", size: { width: 320 }, text: "Text" },
	// A dropped picture and a dropped PDF are the same component; the difference is what the
	// file is, which the embed's own `data-embed` already says.
	{ kind: "image", label: "Image", className: "embed", size: { width: 420, height: 320 } },
	{ kind: "embed", label: "Embed a file", className: "embed", key: "e", size: { width: 420, height: 320 } },
];

/** A component the palette can place: the one field it needs, made non-optional. */
export type PaletteSpec = ComponentSpec & { readonly key: string };

/** The kinds a palette button exists for, in the palette's order. */
export const PALETTE: readonly PaletteSpec[] = COMPONENTS.filter(
	(candidate): candidate is PaletteSpec => candidate.key !== undefined,
);

/** The spec for a kind, or nothing when the kind is not one this build makes. */
export function component(kind: string): ComponentSpec | undefined {
	return COMPONENTS.find((candidate) => candidate.kind === kind);
}

/**
 * The classes an agent may write on a board, and what kind of thing each is.
 *
 * This is the list the authoring skill teaches, which is a slightly smaller list than
 * "every class in `board.css`": an `embed` is a component the app makes (it carries a
 * `data-embed`), and the structural classes — `.board`, `.doc`, `.stage` — are the app's own
 * scaffolding. What is here is what a person or an agent writes by hand as content.
 *
 * `box` is the distinction that matters to the editor: the four box classes all mean "a box
 * with prose in it" and the inspector may swap any of them for any other. `kpi`, `table` and
 * `chip` style their children instead — a table's rows, a chip's own shape — so swapping one
 * in produces a component whose content no longer fits it, and they are not offered.
 *
 * The other three are still *vocabulary*: they are in the stylesheet, the agent is taught
 * them, and the inspector knows not to offer them. Written down here once so a class cannot
 * be in the stylesheet and absent from the agent's instructions, or the reverse.
 */
export interface BoardClassSpec {
	readonly name: string;
	/** A box of prose the inspector can swap for the other boxes. */
	readonly box: boolean;
	/** Short and plain, for the skill's table and the inspector's row. */
	readonly label: string;
}

export const BOARD_CLASSES: readonly BoardClassSpec[] = [
	{ name: "text", box: true, label: "Text" },
	{ name: "sticky", box: true, label: "Sticky note" },
	{ name: "card", box: true, label: "Card" },
	{ name: "callout", box: true, label: "Callout" },
	{ name: "kpi", box: false, label: "A row of numbers" },
	{ name: "table", box: false, label: "A table" },
	{ name: "chip", box: false, label: "A chip" },
];

/**
 * The four box classes, as a tuple, so `BoxClass` is a union rather than `string`.
 *
 * A value as well as a type because both sides iterate it: the inspector draws a row per
 * class, and the server's splice has to accept any of them on an `update`.
 */
export const BOX_CLASSES = ["text", "sticky", "card", "callout"] as const;
export type BoxClass = (typeof BOX_CLASSES)[number];

/**
 * `data-tone` as `board.css` reads it. Absent means the accent.
 *
 * Only a callout reads it, which is why it is here rather than on every class: a tone on a
 * card is an attribute nothing looks at.
 */
export const CALLOUT_TONES = ["warn", "danger", "ok"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

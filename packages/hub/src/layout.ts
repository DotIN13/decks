/**
 * How a deck is laid out, and what a canvas may point at: the rules, in one place.
 *
 *     deck/
 *       canvases/<name>/                 a canvas, standing alone
 *         canvas.pen  canvas.json
 *         boards/  frames/  files/       its own boards, frames, and the pictures and files they use
 *       shared/canvases/<owner>/<name>/  a canvas a friend shared, the same shape
 *       assets/  docs/  apps/            the deck's own, which a canvas points at by their deck path
 *       boards/                          the library: boards on no canvas, read only
 *       lib/                             the board runtime, served beside every canvas's boards/
 *
 * A canvas's drawing and its boards may point at its own folder, at the deck's `assets/`, `docs/`
 * and `apps/` by their deck path, and at web addresses and icons. Not at another canvas, the
 * library or the old `frames/`, nothing outside the deck, no hidden folder and no `..` past the
 * deck: placing a board from somewhere else copies it in (`stage/pens.ts`).
 *
 * Inside the harness a board is still named by its deck path (`canvases/plan/boards/a.html`), as
 * every record, picture and route always named it. A canvas's drawing names its boards relative
 * to its own folder (`boards/a.html`), so the folder can be copied anywhere whole; the drawing is
 * read and written through `resolveReference` and `referenceFor`, which turn one into the other.
 *
 * A friend's canvas is named `shared/<owner>/<canvas>` inside the harness, and lives in
 * `shared/canvases/<owner>/<canvas>/`. What it points at in the owner's deck (`assets/…`, `docs/…`)
 * came with it, mirrored at the same paths inside its folder, so it reads its own copy and never
 * this deck's. The owner's apps did not come: an app board shows its picture there.
 */

/** Where a deck keeps its canvases, where a friend's land, and what a canvas's own folder holds besides its drawing. */
import { CANVASES, OWN_PARTS, SHARED_CANVASES } from "@decks/sync-protocol";
import { CARD_SANDBOX } from "@decks/card-host/sandbox";
export { CANVASES, OWN_PARTS, SHARED_CANVASES };
/** The deck's folders a canvas may point at by their deck path. */
export const DECK_PARTS = ["assets", "docs", "apps"] as const;
/**
 * The card runtime (`@decks/card-host`'s `lib/`: card.css, theme.css, card.js and the live pages),
 * served at the deck's `lib/` and inside every canvas's folder, so a card's `../../lib/card.css`
 * and an old board's `../lib/board.css` both find it.
 */
export const LIB = "lib";

/**
 * A file of `lib/` by the name a page asked for: `board.css` and `board.js`, which pages written
 * before cards ask for, are `card.css` and `card.js` (at a version too, `~ab12/board.css`). The same
 * rule as `@decks/card-host`'s `libName`.
 */
export function libName(rest: string): string {
	return rest.replace(/(^|\/)board\.(css|js)$/, "$1card.$2");
}

/**
 * The sandbox a friend's page runs in: scripts, forms, pop-ups, dialogs and downloads, and never
 * `allow-same-origin`, so its page has a blank origin and reaches nothing of the harness's. The
 * card host's `CARD_SANDBOX`, the one list every live card is served with too.
 */
export const SHARED_SANDBOX = CARD_SANDBOX;

/** What a canvas may point at, said once for every refusal. */
const MAY = "a canvas points at its own boards/, frames/ and files/, and the deck's assets/, docs/ and apps/";

export type Resolution = { path: string } | { refused: string };

/** The parts of a forward-slashed path, a backslash read as a slash. */
const partsOf = (path: string): string[] => path.split("\\").join("/").split("/");

/** The first hidden part of a path (`.decks`, `.git`, `.env`), or undefined. `.` and `..` are not hidden, they are steps. */
export function hiddenPart(path: string): string | undefined {
	return partsOf(path).find((part) => part.length > 1 && part.startsWith(".") && part !== "..");
}

/** Whether a deck-relative path, or the part of an absolute path below a root, has a hidden part. */
export function isHidden(path: string): boolean {
	return hiddenPart(path) !== undefined;
}

/** One plain folder name: what a canvas or an owner may be called on disk. */
export function plainSegment(name: unknown): name is string {
	return typeof name === "string" && name.length > 0 && name.length <= 200 && name !== "." && name !== ".." && !name.startsWith(".") && !/[/\\\0]/.test(name);
}

/** A friend's canvas's name inside the harness: `shared/<owner>/<canvas>`. */
export function sharedName(owner: string, canvas: string): string {
	return `shared/${owner}/${canvas}`;
}

/** The owner and canvas of a shared canvas's name, or undefined for one of this deck's own. */
export function sharedParts(name: string): { owner: string; canvas: string } | undefined {
	const match = /^shared\/([^/]+)\/([^/]+)$/.exec(name);
	if (!match || !plainSegment(match[1]) || !plainSegment(match[2])) return undefined;
	return { owner: match[1]!, canvas: match[2]! };
}

export const isSharedCanvas = (name: string): boolean => sharedParts(name) !== undefined;

/** Whether a canvas name names a folder at all: one plain segment, or a shared canvas's three. */
export function canvasNameOk(name: unknown): name is string {
	return typeof name === "string" && (plainSegment(name) || isSharedCanvas(name));
}

/** A canvas's folder, deck-relative: `canvases/<name>` or `shared/canvases/<owner>/<canvas>`. */
export function canvasFolder(name: string): string {
	const shared = sharedParts(name);
	if (shared) return `${SHARED_CANVASES}/${shared.owner}/${shared.canvas}`;
	if (!plainSegment(name)) throw new Error(`"${name}" is not a canvas's name.`);
	return `${CANVASES}/${name}`;
}

/** The canvas a deck path is in, its folder, and the path inside it; undefined for a path in no canvas. */
export function canvasOfPath(path: string): { name: string; folder: string; rest: string } | undefined {
	const clean = path.split("\\").join("/").replace(/^\/+/, "");
	const own = /^canvases\/([^/]+)\/(.*)$/.exec(clean);
	if (own && plainSegment(own[1])) return { name: own[1]!, folder: `${CANVASES}/${own[1]}`, rest: own[2]! };
	const shared = /^shared\/canvases\/([^/]+)\/([^/]+)\/(.*)$/.exec(clean);
	if (shared && plainSegment(shared[1]) && plainSegment(shared[2])) return { name: sharedName(shared[1]!, shared[2]!), folder: `${SHARED_CANVASES}/${shared[1]}/${shared[2]}`, rest: shared[3]! };
	return undefined;
}

/** How many folders deep a canvas's folder is: 2 for `canvases/x`, 4 for a shared one. */
export const canvasDepth = (name: string): number => canvasFolder(name).split("/").length;

/** A path's parts with `.` and `..` worked out, or undefined when `..` climbs past its start. */
function normalise(parts: string[]): string[] | undefined {
	const out: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (!out.length) return undefined;
			out.pop();
		} else out.push(part);
	}
	return out;
}

/**
 * What a reference written in a canvas's drawing (a board item's `metadata.path`) names, as a deck
 * path: `boards/a.html` on the canvas `plan` is `canvases/plan/boards/a.html`; `docs/notes.md` is
 * the deck's own `docs/notes.md`, or for a friend's canvas the copy that came with it. Refused, with
 * a sentence, when it points anywhere a canvas may not.
 */
export function resolveReference(name: string, reference: string): Resolution {
	if (typeof reference !== "string" || !reference.trim()) return { refused: "it names nothing" };
	if (reference.includes("\0")) return { refused: "it has a null byte in it" };
	if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(reference)) return { refused: `it is outside the deck: ${MAY}` };
	const hidden = hiddenPart(reference);
	if (hidden) return { refused: `${hidden} is a hidden folder, and no canvas reads one` };
	const parts = normalise(partsOf(reference));
	if (!parts || !parts.length) return { refused: `it climbs out of the canvas: ${MAY}` };
	const top = parts[0]!;
	const folder = canvasFolder(name);
	if ((OWN_PARTS as readonly string[]).includes(top) && parts.length > 1) return { path: `${folder}/${parts.join("/")}` };
	if ((DECK_PARTS as readonly string[]).includes(top) && parts.length > 1) {
		if (!isSharedCanvas(name)) return { path: parts.join("/") };
		// A friend's canvas reads the copies that came with it; their apps did not come.
		if (top === "apps") return { refused: "apps are not shared with a canvas" };
		return { path: `${folder}/${parts.join("/")}` };
	}
	return { refused: `${top}/ is not a place ${MAY}` };
}

/**
 * The reference a canvas writes for a deck path, the other way round: `canvases/plan/boards/a.html`
 * on `plan` is `boards/a.html`. Refused for a path the canvas may not point at; a board from another
 * canvas or the library is copied in first (`stage/pens.ts`), and then has a reference here.
 */
export function referenceFor(name: string, deckPath: string): Resolution {
	const clean = deckPath.split("\\").join("/").replace(/^\/+/, "");
	const parts = normalise(partsOf(clean));
	if (!parts || !parts.length) return { refused: "it climbs out of the deck" };
	const hidden = hiddenPart(clean);
	if (hidden) return { refused: `${hidden} is a hidden folder, and no canvas reads one` };
	const folder = canvasFolder(name).split("/");
	const inside = folder.every((part, i) => parts[i] === part);
	if (inside) {
		const rest = parts.slice(folder.length);
		if (rest.length > 1 && (OWN_PARTS as readonly string[]).includes(rest[0]!)) return { path: rest.join("/") };
		if (isSharedCanvas(name) && rest.length > 1 && (DECK_PARTS as readonly string[]).includes(rest[0]!) && rest[0] !== "apps") return { path: rest.join("/") };
		return { refused: `${rest.join("/")} is not in the canvas's boards/, frames/ or files/` };
	}
	if (!isSharedCanvas(name) && (DECK_PARTS as readonly string[]).includes(parts[0]!) && parts.length > 1) return { path: parts.join("/") };
	return { refused: `${clean} is not ${canvasOfPath(clean) ? "on this canvas" : "in this canvas's folder"}: ${MAY}` };
}

/** Whether a deck path is a canvas's own (in its folder), so the canvas may place it as it is. */
export function ownedBy(name: string, deckPath: string): boolean {
	return "path" in referenceFor(name, deckPath) && !(DECK_PARTS as readonly string[]).includes(deckPath.split("/")[0]!);
}

/** The address a board item gives pen.dev for a reference: its own folder's as written, the deck's climbing out. */
export function urlFor(name: string, reference: string): string {
	const top = reference.split("/")[0]!;
	if ((OWN_PARTS as readonly string[]).includes(top) || isSharedCanvas(name)) return reference;
	return `${"../".repeat(canvasDepth(name))}${reference}`;
}

/**
 * The file a board's page asks for, through a canvas's folder, as the deck path it is.
 *
 * A board in `canvases/plan/boards/` asks for `../lib/board.css`, which is `lib/card.css` (`libName`):
 * the deck's `lib/`, served there so a board moved into a canvas needs no rewrite. The same for the
 * deck's `assets/`, `docs/` and `apps/` from one of this deck's own canvases. A friend's canvas gets
 * the deck's `lib/` too, but its `assets/` and `docs/` are the copies in its own folder, and nothing
 * of this deck's apps. A path in no canvas, or in a canvas's own parts, is itself.
 */
export function servedAs(path: string): Resolution {
	const at = canvasOfPath(path);
	if (!at) return { path: path.startsWith(`${LIB}/`) ? `${LIB}/${libName(path.slice(LIB.length + 1))}` : path };
	const [top, ...rest] = at.rest.split("/");
	if (!rest.length) return { path };
	if (top === LIB) return { path: `${LIB}/${libName(rest.join("/"))}` };
	if (isSharedCanvas(at.name)) {
		if (top === "apps") return { refused: "apps are not shared with a canvas" };
		return { path };
	}
	if ((DECK_PARTS as readonly string[]).includes(top!)) return { path: `${top}/${rest.join("/")}` };
	return { path };
}

/** Whether a deck path is a page: a card in a canvas's own `cards/`, or an old board in its `boards/` or the library. */
export function isPagePath(path: string): boolean {
	const clean = path.split("\\").join("/").replace(/^\/+/, "");
	if (!/\.x?html?$/i.test(clean) || clean.includes("\0")) return false;
	if (/^boards\//.test(clean)) return true;
	const at = canvasOfPath(clean);
	return !!at && (at.rest.startsWith("boards/") || isCardPath(clean));
}

/**
 * Whether a deck path is a card: the `index.html` of a folder in a canvas's own `cards/`
 * (`cards/sales/index.html`), which the stage puts in a shadow root of its own page rather than a
 * frame. Everything else in the folder is the card's own (its scripts, styles, data); a card is a
 * board in every other way.
 */
export function isCardPath(path: string): boolean {
	const clean = path.split("\\").join("/").replace(/^\/+/, "");
	if (clean.includes("\0")) return false;
	const at = canvasOfPath(clean);
	return !!at && /^cards\/[^/]+\/index\.html$/i.test(at.rest);
}

/** The card a deck path belongs to: `canvases/x/cards/sales/chart.js` is `canvases/x/cards/sales/index.html`. */
export function cardOf(path: string): string | undefined {
	const clean = path.split("\\").join("/").replace(/^\/+/, "");
	const at = canvasOfPath(clean);
	const name = at ? /^cards\/([^/]+)\//.exec(at.rest)?.[1] : undefined;
	return at && name ? `${clean.slice(0, clean.length - at.rest.length)}cards/${name}/index.html` : undefined;
}

/** What a board or card is called from its path: a card by its folder (`sales`), a board by its file (`plan`). */
export function pageName(path: string): string {
	const parts = path.split("/");
	if (isCardPath(path)) return parts[parts.length - 2] ?? "card";
	return (parts[parts.length - 1] ?? "board").replace(/\.[^.]+$/, "");
}

/**
 * What a canvas shared with you to view says to anything that would change it: whose it is, that it
 * follows their copy, and how to have one you can change.
 */
export function viewOnlySentence(title: string, owner: string, name: string): string {
	return `${title} is shared with you to view, by ${owner}: it follows their copy, and only they can change it. To change it, make your own copy: Make a copy in the canvas menu, or decks canvas copy-shared --canvas ${name}.`;
}

/**
 * The folder a friend's canvases land in, from their name: letters, digits, dots, dashes and
 * underscores, at most 40, cut at a word, or "friend". Every harness names an owner the same way.
 */
export function ownerFolderBase(ownerName: string): string {
	const slugged = ownerName.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	let cut = slugged;
	if (cut.length > 40) {
		cut = slugged.slice(0, 40);
		const boundary = cut.lastIndexOf("-");
		cut = (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/g, "");
	}
	return cut.replace(/[^A-Za-z0-9._-]/g, "").replace(/^[._-]+/, "") || "friend";
}

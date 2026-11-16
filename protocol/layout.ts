// How a deck is laid out, and what a canvas may point at.
//   canvases/<name>/ canvas.pen canvas.json cards/ frames/ files/
//   shared/canvases/<owner>/<name>/   a friend's canvas, the same shape
//   assets/ docs/ apps/               the deck's own, named by deck path
// A canvas points at its own folder and the deck's assets/, docs/ and apps/.

export const CANVASES = "canvases";
export const SHARED_CANVASES = "shared/canvases";
export const OWN_PARTS = ["cards", "frames", "files"] as const;
export const DECK_PARTS = ["assets", "docs", "apps"] as const;
export const LIB = "lib";

const MAY = "a canvas points at its own cards/, frames/ and files/, and the deck's assets/, docs/ and apps/";

export type Resolution = { path: string } | { refused: string };

const partsOf = (path: string): string[] => path.split("\\").join("/").split("/");
const clean = (path: string): string => path.split("\\").join("/").replace(/^\/+/, "");
const isOwn = (top: string | undefined) => (OWN_PARTS as readonly string[]).includes(top ?? "");
const isDeck = (top: string | undefined) => (DECK_PARTS as readonly string[]).includes(top ?? "");

// Paths: what is hidden, what is plain, what the file calls may reach.
/** The first hidden part of a path (.decks, .git), or undefined. */
export function hiddenPart(path: string): string | undefined {
	return partsOf(path).find((part) => part.length > 1 && part.startsWith(".") && part !== "..");
}

/** One plain folder name: not empty, no dot first, no slash or NUL. */
export function plainSegment(name: unknown): name is string {
	return typeof name === "string" && name.length > 0 && name.length <= 200 && !name.startsWith(".") && !/[/\\\0]/.test(name);
}

function normalise(parts: string[]): string[] | undefined {
	const out: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part !== "..") out.push(part);
		else if (!out.pop()) return undefined;
	}
	return out;
}

/** Whether a path may be read or written through file.* calls: inside the deck, nothing hidden. */
export function deckPathOk(path: string): boolean {
	if (typeof path !== "string" || path.includes("\0") || /^(?:[a-z]:|\/)/i.test(path)) return false;
	const parts = normalise(partsOf(path));
	return parts !== undefined && hiddenPart(path) === undefined;
}

// Canvases by name, a friend's included.
export function sharedName(owner: string, canvas: string): string {
	return `shared/${owner}/${canvas}`;
}

export function sharedParts(name: string): { owner: string; canvas: string } | undefined {
	const match = /^shared\/([^/]+)\/([^/]+)$/.exec(name);
	if (!match || !plainSegment(match[1]) || !plainSegment(match[2])) return undefined;
	return { owner: match[1], canvas: match[2] };
}

export const isSharedCanvas = (name: string): boolean => sharedParts(name) !== undefined;

export function canvasNameOk(name: unknown): name is string {
	return typeof name === "string" && (plainSegment(name) || isSharedCanvas(name));
}

/** The folder a friend's canvases land in, from their name; "friend" when nothing is left. */
export function ownerFolderBase(ownerName: string): string {
	const slug = ownerName.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	let cut = slug;
	if (cut.length > 40) {
		const head = slug.slice(0, 40);
		const at = head.lastIndexOf("-");
		cut = (at > 0 ? head.slice(0, at) : head).replace(/-+$/g, "");
	}
	return cut.replace(/[^A-Za-z0-9._-]/g, "").replace(/^[._-]+/, "") || "friend";
}

/** A canvas's folder from the deck's root. */
export function canvasFolder(name: string): string {
	const shared = sharedParts(name);
	if (shared) return `${SHARED_CANVASES}/${shared.owner}/${shared.canvas}`;
	if (!plainSegment(name)) throw new Error(`"${name}" is not a canvas's name.`);
	return `${CANVASES}/${name}`;
}

/** The canvas a deck path is in, its folder, and the path inside it. */
export function canvasOfPath(path: string): { name: string; folder: string; rest: string } | undefined {
	const p = clean(path);
	const own = /^canvases\/([^/]+)\/(.*)$/.exec(p);
	if (own && plainSegment(own[1])) return { name: own[1], folder: `${CANVASES}/${own[1]}`, rest: own[2] ?? "" };
	const shared = /^shared\/canvases\/([^/]+)\/([^/]+)\/(.*)$/.exec(p);
	if (shared && plainSegment(shared[1]) && plainSegment(shared[2])) {
		return { name: sharedName(shared[1], shared[2]), folder: `${SHARED_CANVASES}/${shared[1]}/${shared[2]}`, rest: shared[3] ?? "" };
	}
	return undefined;
}

// The references a drawing writes.
/** What a reference written in a canvas's drawing names, as a deck path. */
export function resolveReference(name: string, reference: string): Resolution {
	if (typeof reference !== "string" || !reference.trim()) return { refused: "it names nothing" };
	if (reference.includes("\0")) return { refused: "it has a null byte in it" };
	if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(reference)) return { refused: `it is outside the deck: ${MAY}` };
	const hidden = hiddenPart(reference);
	if (hidden) return { refused: `${hidden} is a hidden folder, and no canvas reads one` };
	const parts = normalise(partsOf(reference));
	if (!parts || parts.length < 2) return { refused: `it climbs out of the canvas: ${MAY}` };
	const top = parts[0];
	if (isOwn(top)) return { path: `${canvasFolder(name)}/${parts.join("/")}` };
	if (!isDeck(top)) return { refused: `${top}/ is not a place ${MAY}` };
	if (!isSharedCanvas(name)) return { path: parts.join("/") };
	if (top === "apps") return { refused: "apps are not shared with a canvas" };
	return { path: `${canvasFolder(name)}/${parts.join("/")}` };
}

/** The reference a canvas writes for a deck path: the other way round. */
export function referenceFor(name: string, deckPath: string): Resolution {
	const p = clean(deckPath);
	const parts = normalise(partsOf(p));
	if (!parts || !parts.length) return { refused: "it climbs out of the deck" };
	const hidden = hiddenPart(p);
	if (hidden) return { refused: `${hidden} is a hidden folder, and no canvas reads one` };
	const folder = canvasFolder(name).split("/");
	if (folder.every((part, i) => parts[i] === part)) {
		const rest = parts.slice(folder.length);
		if (rest.length > 1 && isOwn(rest[0])) return { path: rest.join("/") };
		if (isSharedCanvas(name) && rest.length > 1 && isDeck(rest[0]) && rest[0] !== "apps") return { path: rest.join("/") };
		return { refused: `${rest.join("/")} is not in the canvas's cards/, frames/ or files/` };
	}
	if (!isSharedCanvas(name) && isDeck(parts[0]) && parts.length > 1) return { path: parts.join("/") };
	return { refused: `${p} is not in this canvas's folder: ${MAY}` };
}

// Cards.
/** Whether a deck path is a card: cards/<name>/index.html inside a canvas. */
export function isCardPath(path: string): boolean {
	const at = canvasOfPath(path);
	return !!at && !path.includes("\0") && /^cards\/[^/]+\/index\.html$/i.test(at.rest);
}

/** A card named by its folder or its index.html, as its index.html; undefined when that is not a card. */
export function cardIndex(raw: string): string | undefined {
	const trimmed = clean(raw).replace(/\/+$/, "");
	const index = /\/index\.html$/i.test(trimmed) ? trimmed : `${trimmed}/index.html`;
	return isCardPath(index) ? index : undefined;
}

/** The index.html of the card called name in a canvas's folder. */
export function cardAt(folder: string, name: string): string {
	return `${folder}/cards/${name}/index.html`;
}

/** The card a file belongs to: .../cards/sales/chart.js is .../cards/sales/index.html. */
export function cardOf(path: string): string | undefined {
	const p = clean(path);
	const at = canvasOfPath(p);
	const name = at ? /^cards\/([^/]+)\//.exec(at.rest)?.[1] : undefined;
	return at && name ? `${at.folder}/cards/${name}/index.html` : undefined;
}


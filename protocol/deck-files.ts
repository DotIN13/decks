// What two of the deck's files say, read one way by every program that reads
// them: a card's meta tag, and the deck's import map.

/** Where the deck's import map is, from the deck's root. */
export const IMPORT_MAP = "assets/importmap.json";

// A card's meta tag.

/** A card's `<meta name="card" content='{…}'>`: the tag as written, its name, what it holds, and its size where it says one. */
export type CardMeta = { tag: string; name: string; given: Record<string, unknown>; w?: number; h?: number };

const META = /<meta\s+name=["']([\w-]+)["']\s+content='(\{[^']*)'(\s*\/?>)?/i;

/**
 * The first meta tag in a card's source whose content is a JSON object, or undefined for none.
 * Any name is read, as older cards name it otherwise: look at `name` when only `card` will do. A
 * width or height that is not a number above 0 is left out; content that is not JSON reads as {}.
 */
export function cardMeta(source: string): CardMeta | undefined {
	const found = META.exec(source);
	if (!found) return undefined;
	const given = objectOf(found[2]!);
	return { tag: found[0], name: found[1]!, given, ...sized("w", given.w), ...sized("h", given.h) };
}

function objectOf(text: string): Record<string, unknown> {
	try {
		const value = JSON.parse(text) as unknown;
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

const sized = (key: "w" | "h", value: unknown) => (typeof value === "number" && value > 0 ? { [key]: value } : {});

// The deck's import map.

/**
 * The names the deck's import map (`{ "imports": { "name": "address" } }`) gives, from its text: an
 * https address as it is; a relative one as its deck path under assets/; one that leaves assets/,
 * names a hidden part, starts with / or has another scheme, dropped. No map reads as {}.
 */
export function importMap(text: string | undefined): Record<string, string> {
	const imports = objectOf(text ?? "").imports;
	const out: Record<string, string> = {};
	if (!imports || typeof imports !== "object") return out;
	for (const [name, address] of Object.entries(imports as Record<string, unknown>)) {
		if (!name || typeof address !== "string") continue;
		const target = /^https:\/\//i.test(address) ? address : assetPath(address);
		if (target) out[name] = target;
	}
	return out;
}

/** A relative address in the map as a deck path under assets/, or undefined when it leaves it. */
function assetPath(address: string): string | undefined {
	if (/^[a-z][a-z0-9+.-]*:|^\//i.test(address)) return undefined;
	const parts = ["assets"];
	for (const part of address.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length <= 1) return undefined;
			parts.pop();
		} else parts.push(part);
	}
	if (parts.length < 2 || parts.some((part) => part.startsWith("."))) return undefined;
	return parts.join("/");
}

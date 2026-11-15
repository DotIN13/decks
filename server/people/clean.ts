import { Refused } from "../../protocol/index.ts";

// What a name, a tag, a workspace and an avatar may be. Pure, so each rule is
// tested without a server.

export const MAX_TAGS = 4;
export const MAX_TAG = 24;
export const MAX_WORKSPACE = 24;
export const MAX_NAME = 40;
export const PALETTE = ["#3b5cf6", "#2eaf5a", "#e7af36", "#623be2", "#d92e3c", "#0f9ba8"] as const;

// Tags and workspaces: one slug rule, each with its own cap
/** Letters and digits of any script kept, the rest one dash, cut at a word when long. */
export function slug(raw: string, max: number): string {
	const slugged = raw.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
	if (slugged.length <= max) return slugged;
	const cut = slugged.slice(0, max);
	const at = cut.lastIndexOf("-");
	return (at > 0 ? cut.slice(0, at) : cut).replace(/-+$/g, "");
}

/** Slugged, empties and repeats dropped, first ones kept, at most four. */
export function cleanTags(raw: readonly unknown[]): string[] {
	const out: string[] = [];
	for (const one of raw) {
		const tag = typeof one === "string" ? slug(one, MAX_TAG) : "";
		if (tag && !out.includes(tag)) out.push(tag);
		if (out.length === MAX_TAGS) break;
	}
	return out;
}

/** One slug, or undefined for none. */
export function cleanWorkspace(raw: string | null | undefined): string | undefined {
	return typeof raw === "string" ? slug(raw, MAX_WORKSPACE) || undefined : undefined;
}

// Names and colours
/** A name trimmed and capped; an empty one is refused. */
export function cleanName(raw: string): string {
	const name = raw.trim().slice(0, MAX_NAME).trim();
	if (!name) throw new Refused("invalid", "A name cannot be empty.", "agent.update");
	return name;
}

/** The base and the first number nothing else uses: Agent 1, Agent 2. */
export function numberedName(base: string, taken: (name: string) => boolean): string {
	const stem = base.trim() || "Agent";
	for (let n = 1; ; n += 1) if (!taken(`${stem} ${n}`)) return `${stem} ${n}`;
}

/** The palette colour fewest agents wear, the first of those when tied. */
export function nextColour(worn: readonly string[]): string {
	const count = (c: string) => worn.filter((w) => w === c).length;
	return PALETTE.reduce((best, c) => (count(c) < count(best) ? c : best), PALETTE[0]);
}

// Avatars
/** An avatar as a picture's address: an emoji drawn as text, or an SVG checked. */
export function avatarUrl(avatar: { emoji: string } | { svg: string }): string {
	if ("emoji" in avatar) {
		const glyph = escapeXml([...avatar.emoji.trim()].slice(0, 4).join(""));
		if (!glyph) throw new Refused("invalid", "An emoji avatar needs an emoji.", "agent.update");
		return dataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="44" font-size="44" text-anchor="middle">${glyph}</text></svg>`);
	}
	const svg = avatar.svg.trim();
	const open = /^<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
	if (!open || !/<\/svg>\s*$/i.test(svg)) throw new Refused("invalid", "An avatar's SVG must start with <svg> and end with </svg>.", "agent.update");
	if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(open)) throw new Refused("invalid", 'An avatar\'s <svg> needs xmlns="http://www.w3.org/2000/svg", or it draws nothing.', "agent.update");
	if (!/viewBox=/.test(open)) throw new Refused("invalid", "An avatar's <svg> needs a viewBox, so it scales to the row.", "agent.update");
	if (/<script\b|\son\w+=/i.test(svg)) throw new Refused("invalid", "An avatar's SVG may not hold scripts.", "agent.update");
	if (svg.length > 20000) throw new Refused("invalid", "An avatar's SVG is at most 20,000 characters.", "agent.update");
	return dataUrl(svg);
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const dataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

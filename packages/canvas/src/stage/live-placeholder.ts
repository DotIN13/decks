import type { Board } from "@decks/protocol";

/**
 * What the sheet draws for a document or an app board when its page is not showing.
 *
 * Neither has a picture worth drawing: the server's shot of a document board is its page before the
 * file arrived ("Opening…"), and of an app board its page before the app answered. So each is drawn
 * as a card: the kind's icon and the board's name, in the scheme's own greys, at the board's size.
 */

/** The kinds of board drawn this way, by their `data-live`. */
export const PLACEHOLDER_KINDS: ReadonlySet<string> = new Set(["doc", "app"]);

/** Whether a board is drawn as a placeholder rather than its picture. */
export const hasPlaceholder = (board: Pick<Board, "live">): boolean => !!board.live && PLACEHOLDER_KINDS.has(board.live);

/** Lucide's file-text and app-window, as path data on a 24 grid (a rectangle written as a path). */
const ICONS: Record<string, string[]> = {
	doc: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
	app: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M10 4v4", "M2 8h20", "M6 4v4"],
};

/** A document's card is on the document page's own ground, `--b-bg` in the board's theme (`board-host/lib/theme.css`). */
const DOC_GROUND = { light: "#ffffff", dark: "#161616" };

const COLOURS = {
	light: { ground: "#f5f5f5", icon: "#9a9a9a", text: "#555555", faint: "#8a8a8a" },
	dark: { ground: "#1e1e1e", icon: "#7a7a7a", text: "#c8c8c8", faint: "#8a8a8a" },
};

/** Pixels per board unit, and the widest picture made: enough to read a little past life size. */
const SCALE = 2;
const MAX_SIDE = 2048;

const made = new Map<string, string>();

/**
 * The placeholder as a picture the sheet can draw, kept per kind, name, size and scheme.
 *
 * A PNG drawn here rather than an SVG: the engine decodes pictures with `createImageBitmap`, which
 * takes no SVG. Empty without a page to draw in (a test, a server).
 */
export function placeholderPicture(board: Pick<Board, "live" | "title" | "path" | "w" | "h">, scheme: "light" | "dark"): string {
	const kind = board.live === "app" ? "app" : "doc";
	const w = Math.max(40, Math.round(board.w));
	const h = Math.max(40, Math.round(board.h));
	const name = (board.title || board.path.split("/").pop() || "").trim();
	const key = `${kind}|${name}|${w}|${h}|${scheme}`;
	const known = made.get(key);
	if (known !== undefined) return known;
	if (typeof document === "undefined") return "";
	const scale = Math.min(SCALE, MAX_SIDE / Math.max(w, h));
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(w * scale);
	canvas.height = Math.round(h * scale);
	const g = canvas.getContext("2d");
	if (!g) return "";
	g.scale(scale, scale);
	const c = COLOURS[scheme];
	g.fillStyle = kind === "doc" ? DOC_GROUND[scheme] : c.ground;
	g.fillRect(0, 0, w, h);
	// Sized to the board, so the icon reads at any zoom without the card looking empty.
	const icon = Math.round(Math.min(96, Math.max(32, Math.min(w, h) * 0.12)));
	const font = Math.round(Math.min(28, Math.max(14, icon * 0.32)));
	const cy = h / 2 - font;
	g.save();
	g.translate(w / 2 - icon / 2, cy - icon / 2);
	g.scale(icon / 24, icon / 24);
	g.strokeStyle = c.icon;
	g.lineWidth = 1.5;
	g.lineCap = "round";
	g.lineJoin = "round";
	for (const d of ICONS[kind]!) g.stroke(new Path2D(d));
	g.restore();
	g.textAlign = "center";
	g.textBaseline = "alphabetic";
	g.fillStyle = c.text;
	g.font = `600 ${font}px -apple-system, system-ui, sans-serif`;
	let shown = name;
	while (shown.length > 1 && g.measureText(shown).width > w - 48) shown = `${shown.slice(0, -2)}…`;
	g.fillText(shown, w / 2, cy + icon / 2 + font * 1.6);
	g.fillStyle = c.faint;
	g.font = `${Math.round(font * 0.8)}px -apple-system, system-ui, sans-serif`;
	g.fillText(kind === "app" ? "App" : "Document", w / 2, cy + icon / 2 + font * 3);
	const url = canvas.toDataURL("image/png");
	made.set(key, url);
	return url;
}

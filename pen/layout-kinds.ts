import type { PenNode } from "./types.ts";

/** A note whose words are markdown: pen.dev shows them as typed, Decks draws the note as a card. */
export const MARKDOWN = "decks.markdown";
export const isMarkdown = (node: PenNode): boolean => node.type !== "text" && node.metadata?.type === MARKDOWN;
/** A text item whose words are markdown: one block of a markdown card, with no paper of its own. */
export const isMarkdownText = (node: PenNode): boolean => node.type === "text" && node.metadata?.type === MARKDOWN;
/**
 * A markdown card: a column frame whose children are its blocks (markdown texts, pictures), so its
 * drop slots are the gaps between lines. Drawn on the card's paper when it has no fill of its own.
 * Its old tag (`OLD_CARD`) is still read on a frame; the markdown-cards migration rewrites it.
 */
export const CARD = "decks.markdown-card";
/** The markdown card's old tag, on a frame only: a `browser` item with it is an HTML card. */
export const OLD_CARD = "decks.card";
export const isCard = (node: PenNode | undefined): boolean => node?.type === "frame" && (node.metadata?.type === CARD || node.metadata?.type === OLD_CARD);

/**
 * A film or a sound: pen's own rectangle, filled with its still, tagged `decks.media`. pen.dev shows
 * the poster, the right thing for something not playing; nothing decodes until it is pressed.
 */
export const MEDIA = "decks.media";

export interface MediaItem {
	kind: "video" | "audio";
	/** The deck path of the file itself, as the item's metadata holds it. */
	file: string;
	/** The deck path of the still, when there is one. */
	poster?: string;
	seconds?: number;
	/** A sound's loudness along its length, 0 to 1 per bar: its waveform. */
	peaks?: number[];
}

/** What an item says it is, when it is a film or a sound; `undefined` for everything else. */
export function mediaOf(node: PenNode | undefined): MediaItem | undefined {
	const data = node?.metadata;
	if (!data || data.type !== MEDIA) return undefined;
	const kind = data.kind === "audio" ? "audio" : "video";
	const file = typeof data.file === "string" ? data.file : "";
	if (!file) return undefined;
	return {
		kind,
		file,
		...(typeof data.poster === "string" && data.poster ? { poster: data.poster } : {}),
		...(typeof data.seconds === "number" && Number.isFinite(data.seconds) ? { seconds: data.seconds } : {}),
		...(Array.isArray(data.peaks) && data.peaks.length && data.peaks.every((peak) => typeof peak === "number") ? { peaks: data.peaks as number[] } : {}),
	};
}

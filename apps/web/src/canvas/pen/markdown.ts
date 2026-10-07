import type { Token, Tokens } from "marked";
import { CALLOUTS, cardMarked, sizedAlt, type Colour, type ColourToken, type CriticToken, type HighlightToken, type WikiToken } from "./card-syntax.ts";

/**
 * The markdown a card on the stage is written in: Obsidian's, with coloured words and an agent's
 * suggestions on top (`card-syntax.ts` says what each adds).
 *
 * pen has no rich text: a note's `content` is a plain string. A card is a note whose metadata says
 * `{ "type": "decks.markdown" }`, and Decks reads its words as Obsidian reads them; pen.dev,
 * which knows nothing of the mark, shows the same words as they were typed.
 *
 * `marked`'s lexer does the reading — CommonMark and GFM: tables, task lists, strikethrough,
 * autolinks, reference links, nested blocks — and this file turns its tokens into the handful of
 * blocks and styled runs the canvas lays out (`markdown-layout.ts`). Obsidian's own inline syntax
 * and ours are `marked` extensions (`card-syntax.ts`); footnotes, callouts, embeds on a line of their
 * own and `:emoji:` shortcodes are done here. Raw HTML is shown as the words inside it, with `<br>`
 * as a break.
 */

export interface Run {
	text: string;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	code?: boolean;
	/** Where a link goes; the run is its words. */
	link?: string;
	/** A footnote's number, set small. */
	sup?: boolean;
	/** An image in a line, shown by its words. */
	image?: { url: string; alt: string; width?: number };
	/** `==highlighted==`: "default" for Obsidian's own colour, or one of its six. */
	mark?: Colour | "default";
	/** `[coloured]{.red}` words. */
	colour?: Colour;
	/** A `[[link]]` to a note: its target. Drawn as a link, but it goes nowhere on the canvas. */
	wiki?: string;
	/** Words an agent suggests adding, or taking out (CriticMarkup), and the reason it gave. */
	added?: true;
	removed?: true;
	reason?: string;
}

/** A callout's colour (`CALLOUTS`): Obsidian folds its two dozen types onto these. */
export type Alert = "blue" | "cyan" | "green" | "orange" | "red" | "purple" | "gray";
export type Align = "left" | "center" | "right" | null;

export type Block =
	| { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Run[] }
	| { kind: "paragraph"; runs: Run[] }
	| { kind: "image"; url: string; alt: string; width?: number }
	/** `![[file]]` on a line of its own: a file shown where it sits. */
	| { kind: "embed"; target: string }
	| { kind: "list"; ordered: boolean; start: number; loose: boolean; items: Array<{ checked?: boolean; blocks: Block[] }> }
	| { kind: "quote"; alert?: Alert; title?: string; blocks: Block[] }
	| { kind: "code"; lang: string; text: string }
	| { kind: "table"; align: Align[]; header: Run[][]; rows: Run[][][] }
	| { kind: "rule" }
	| { kind: "footnotes"; items: Array<{ number: number; blocks: Block[] }> };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", larr: "←", rarr: "→", uarr: "↑", darr: "↓", times: "×", middot: "·", bull: "•", deg: "°" };
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
		if (name[0] === "#") {
			const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return ENTITIES[name.toLowerCase()] ?? whole;
	});
}

/** GitHub's shortcodes for the emoji people actually type. */
const EMOJI: Record<string, string> = {
	smile: "😄", smiley: "😃", grin: "😁", laughing: "😆", joy: "😂", wink: "😉", blush: "😊", heart_eyes: "😍", thinking: "🤔", neutral_face: "😐", confused: "😕", cry: "😢", sob: "😭", scream: "😱", sweat_smile: "😅", sunglasses: "😎", upside_down_face: "🙃", eyes: "👀",
	"+1": "👍", thumbsup: "👍", "-1": "👎", thumbsdown: "👎", clap: "👏", wave: "👋", pray: "🙏", muscle: "💪", point_right: "👉", point_left: "👈", ok_hand: "👌", raised_hands: "🙌",
	heart: "❤️", broken_heart: "💔", fire: "🔥", star: "⭐", sparkles: "✨", tada: "🎉", rocket: "🚀", zap: "⚡", boom: "💥", bulb: "💡", memo: "📝", pencil: "✏️", pushpin: "📌", link: "🔗", lock: "🔒", key: "🔑", bell: "🔔", mag: "🔍", bookmark: "🔖", books: "📚", book: "📖", calendar: "📅", clock: "🕐", hourglass: "⌛", chart_with_upwards_trend: "📈", chart_with_downwards_trend: "📉", bar_chart: "📊", package: "📦", gear: "⚙️", wrench: "🔧", hammer: "🔨", bug: "🐛", construction: "🚧", rotating_light: "🚨", warning: "⚠️", no_entry: "⛔", x: "❌", white_check_mark: "✅", heavy_check_mark: "✔️", ballot_box_with_check: "☑️", question: "❓", exclamation: "❗", information_source: "ℹ️", arrow_right: "➡️", arrow_left: "⬅️", arrow_up: "⬆️", arrow_down: "⬇️", recycle: "♻️", checkered_flag: "🏁", trophy: "🏆", gift: "🎁", art: "🎨", computer: "💻", iphone: "📱", globe_with_meridians: "🌐", earth_americas: "🌎", sun: "☀️", cloud: "☁️", umbrella: "☂️", snowflake: "❄️", coffee: "☕", pizza: "🍕", seedling: "🌱", herb: "🌿", money_with_wings: "💸", dollar: "💵", moneybag: "💰", speech_balloon: "💬", thought_balloon: "💭", lipstick: "💄", robot: "🤖", brain: "🧠", test_tube: "🧪", microscope: "🔬", telescope: "🔭", 100: "💯",
};
const emojify = (text: string) => text.replace(/:([a-z0-9_+-]+):/g, (whole, name: string) => EMOJI[name] ?? whole);

/** A card's markdown, as the blocks it is drawn in, top to bottom. */
export function parseMarkdown(source: string): Block[] {
	const { body, notes } = footnotesOf(source.replace(/\r\n?/g, "\n"));
	const numbers = new Map<string, number>();
	const tokens = cardMarked().lexer(body);
	const blocks = blocksOf(tokens, numbers);
	// GitHub lists footnotes in the order they are first cited, and leaves out the ones never cited.
	const items = [...numbers].flatMap(([label, number]) => {
		const text = notes.get(label);
		return text === undefined ? [] : [{ number, blocks: blocksOf(cardMarked().lexer(text), numbers) }];
	});
	if (items.length) blocks.push({ kind: "footnotes", items });
	return blocks;
}

/** Take `[^label]: text` definitions, and the indented lines under them, out of the source. */
function footnotesOf(source: string): { body: string; notes: Map<string, string> } {
	const notes = new Map<string, string>();
	const out: string[] = [];
	const lines = source.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const def = /^\[\^([^\]\s]+)\]:\s?(.*)$/.exec(lines[i]!);
		if (!def) {
			out.push(lines[i]!);
			continue;
		}
		const text = [def[2]!];
		while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1]!)) text.push(lines[++i]!.trim());
		notes.set(def[1]!, text.join("\n"));
	}
	return { body: out.join("\n"), notes };
}

function blocksOf(tokens: readonly Token[], notes: Map<string, number>): Block[] {
	const out: Block[] = [];
	for (const token of tokens) {
		switch (token.type) {
			case "heading": {
				const t = token as Tokens.Heading;
				out.push({ kind: "heading", level: Math.min(6, Math.max(1, t.depth)) as 1, runs: runsOf(t.tokens, notes) });
				break;
			}
			case "paragraph":
			case "text": {
				const t = token as Tokens.Paragraph | Tokens.Text;
				const runs = t.tokens ? runsOf(t.tokens, notes) : textRuns(t.text, {}, notes);
				// An image or an embed on a line of its own is drawn as the picture, or the file.
				const only = runs.filter((run) => run.image || run.text.trim());
				const embed = embedOf(t.tokens);
				if (embed) out.push(embed);
				else if (only.length === 1 && only[0]!.image) {
					const { url, alt, width } = only[0]!.image;
					out.push({ kind: "image", url, alt, ...(width ? { width } : {}) });
				} else if (runs.some((run) => run.image || run.text.trim())) out.push({ kind: "paragraph", runs });
				break;
			}
			case "list": {
				const t = token as Tokens.List;
				out.push({
					kind: "list",
					ordered: t.ordered,
					start: typeof t.start === "number" ? t.start : 1,
					loose: t.loose,
					items: t.items.map((item) => ({ ...(item.task ? { checked: !!item.checked } : {}), blocks: blocksOf(item.tokens.filter((x) => x.type !== "checkbox"), notes) })),
				});
				break;
			}
			case "blockquote": {
				const t = token as Tokens.Blockquote;
				const inner = blocksOf(t.tokens, notes);
				// Obsidian's callouts: a quote whose first line is [!type], maybe folded (+ or -), maybe titled.
				// GitHub's five alerts are among them.
				const first = inner[0];
				const mark = first?.kind === "paragraph" ? /^\[!([a-z-]+)\][+-]?[ \t]*([^\n]*)\n?/i.exec(first.runs[0]?.text ?? "") : null;
				if (mark && first?.kind === "paragraph") {
					const type = mark[1]!.toLowerCase();
					first.runs[0] = { ...first.runs[0]!, text: first.runs[0]!.text.slice(mark[0].length) };
					if (!first.runs[0].text) first.runs.shift();
					if (!first.runs.some((run) => run.text.trim() || run.image)) inner.shift();
					const title = mark[2]!.trim() || type.charAt(0).toUpperCase() + type.slice(1);
					out.push({ kind: "quote", alert: (CALLOUTS[type] ?? "blue") as Alert, title, blocks: inner });
				} else out.push({ kind: "quote", blocks: inner });
				break;
			}
			case "code": {
				const t = token as Tokens.Code;
				out.push({ kind: "code", lang: (t.lang ?? "").trim().split(/\s+/)[0]!.toLowerCase(), text: t.text });
				break;
			}
			case "table": {
				const t = token as Tokens.Table;
				out.push({ kind: "table", align: t.align, header: t.header.map((cell) => runsOf(cell.tokens, notes)), rows: t.rows.map((row) => row.map((cell) => runsOf(cell.tokens, notes))) });
				break;
			}
			case "hr":
				out.push({ kind: "rule" });
				break;
			case "hidden":
				break; // %% a hidden comment %%
			case "html": {
				// Raw HTML is shown as the words in it, a <br> as a break and a block tag as a new paragraph.
				const text = decodeEntities(token.raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr|summary|details)>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
				for (const line of text.split(/\n{2,}/)) if (line.trim()) out.push({ kind: "paragraph", runs: textRuns(line, {}, notes) });
				break;
			}
			default:
				break; // space, def: nothing to draw
		}
	}
	return out;
}

type Style = Omit<Run, "text" | "image">;

/** Plain words, with their `[^label]` footnote marks and `:shortcodes:` turned into what they stand for. */
function textRuns(text: string, style: Style, notes: Map<string, number>): Run[] {
	const out: Run[] = [];
	const parts = emojify(decodeEntities(text)).split(/(\[\^[^\]\s]+\])/);
	for (const part of parts) {
		const mark = /^\[\^([^\]\s]+)\]$/.exec(part);
		if (mark) {
			if (!notes.has(mark[1]!)) notes.set(mark[1]!, notes.size + 1);
			out.push({ text: String(notes.get(mark[1]!)), ...style, sup: true });
		} else if (part) out.push({ text: part, ...style });
	}
	return out;
}

function runsOf(tokens: readonly Token[] | undefined, notes: Map<string, number>, style: Style = {}): Run[] {
	const out: Run[] = [];
	for (const token of tokens ?? []) {
		switch (token.type) {
			case "text": {
				const t = token as Tokens.Text;
				out.push(...(t.tokens ? runsOf(t.tokens, notes, style) : textRuns(t.text, style, notes)));
				break;
			}
			case "escape":
				out.push({ text: (token as Tokens.Escape).text, ...style });
				break;
			case "strong":
				out.push(...runsOf((token as Tokens.Strong).tokens, notes, { ...style, bold: true }));
				break;
			case "em":
				out.push(...runsOf((token as Tokens.Em).tokens, notes, { ...style, italic: true }));
				break;
			case "del":
				out.push(...runsOf((token as Tokens.Del).tokens, notes, { ...style, strike: true }));
				break;
			case "codespan":
				out.push({ text: decodeEntities((token as Tokens.Codespan).text), ...style, code: true });
				break;
			case "br":
				out.push({ text: "\n", ...style });
				break;
			case "link": {
				const t = token as Tokens.Link;
				out.push(...runsOf(t.tokens, notes, { ...style, link: t.href }));
				break;
			}
			case "image": {
				const t = token as Tokens.Image;
				const { alt, width } = sizedAlt(t.text);
				out.push({ text: alt || "image", ...style, image: { url: t.href, alt, ...(width ? { width } : {}) } });
				break;
			}
			case "highlight": {
				const t = token as HighlightToken;
				out.push(...runsOf(t.tokens as Token[], notes, { ...style, mark: t.colour ?? "default" }));
				break;
			}
			case "colour": {
				const t = token as ColourToken;
				out.push(...runsOf(t.tokens as Token[], notes, { ...style, colour: t.colour }));
				break;
			}
			case "wiki": {
				const t = token as WikiToken;
				out.push(t.embed ? { text: `📄 ${t.alias ?? t.target}`, ...style } : { text: t.alias ?? t.target, ...style, wiki: t.target });
				break;
			}
			case "critic": {
				const t = token as CriticToken;
				if (t.op === "comment") {
					// The reason belongs to the suggestion just before it.
					const last = out.at(-1);
					if (last && (last.added || last.removed)) for (let i = out.length - 1; i >= 0 && (out[i]!.added || out[i]!.removed); i--) out[i]!.reason = t.new;
				} else if (t.op === "highlight") out.push(...textRuns(t.old, { ...style, mark: "default" }, notes));
				else {
					if (t.old) out.push(...textRuns(t.old, { ...style, removed: true }, notes));
					if (t.new) out.push(...textRuns(t.new, { ...style, added: true }, notes));
				}
				break;
			}
			case "hidden":
				break;
			case "html": {
				const raw = token.raw;
				if (/^<br\s*\/?>$/i.test(raw)) out.push({ text: "\n", ...style });
				else if (!/^<\/?[a-z][^>]*>$/i.test(raw)) out.push(...textRuns(raw.replace(/<[^>]+>/g, ""), style, notes));
				break;
			}
			default:
				if ("text" in token && typeof token.text === "string") out.push(...textRuns(token.text, style, notes));
		}
	}
	// Neighbours in the same style become one run.
	const merged: Run[] = [];
	for (const run of out) {
		const last = merged.at(-1);
		if (last && !last.image && !run.image && sameStyle(last, run)) last.text += run.text;
		else merged.push({ ...run });
	}
	return merged;
}

const sameStyle = (a: Run, b: Run) =>
	!!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.strike === !!b.strike && !!a.code === !!b.code && !!a.sup === !!b.sup && a.link === b.link &&
	a.mark === b.mark && a.colour === b.colour && a.wiki === b.wiki && !!a.added === !!b.added && !!a.removed === !!b.removed && a.reason === b.reason;

/** `![[file]]`, alone on its line: the file, or, for a picture, the picture at the width it gives. */
function embedOf(tokens: readonly Token[] | undefined): Block | undefined {
	const real = (tokens ?? []).filter((token) => !(token.type === "text" && !token.raw.trim()));
	const only = real.length === 1 && real[0]!.type === "wiki" ? (real[0] as WikiToken) : undefined;
	if (!only?.embed) return undefined;
	if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(only.target)) return { kind: "image", url: only.target, alt: only.alias ?? only.target, ...(only.width ? { width: only.width } : {}) };
	return { kind: "embed", target: only.target };
}

/** Every word a card will draw, for fetching the fonts it needs before it is laid out. */
export function wordsOf(blocks: readonly Block[]): string {
	const runs = (list: readonly Run[]) => list.map((run) => run.text).join("");
	return blocks
		.map((block) => {
			switch (block.kind) {
				case "heading":
				case "paragraph":
					return runs(block.runs);
				case "image":
					return block.alt;
				case "embed":
					return `📄 ${block.target}`;
				case "list":
					return block.items.map((item) => wordsOf(item.blocks)).join("\n");
				case "quote":
					return wordsOf(block.blocks);
				case "code":
					return block.text;
				case "table":
					return [...block.header, ...block.rows.flat()].map(runs).join(" ");
				case "footnotes":
					return block.items.map((item) => wordsOf(item.blocks)).join("\n");
				default:
					return "";
			}
		})
		.join("\n");
}

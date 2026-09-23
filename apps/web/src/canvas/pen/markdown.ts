/**
 * The markdown a card on the stage is written in, read into blocks the canvas can set.
 *
 * pen has no rich text: a note's `content` is a plain string. A card is a note whose metadata says
 * `{ "type": "decks.markdown" }`, and Decks reads its words as markdown; pen.dev, which knows
 * nothing of the mark, shows the same words as they were typed. So this is a small reader for what
 * a card needs — headings, paragraphs, lists, quotes, fenced code, and inside a line bold, italic,
 * code and links — not a full CommonMark parser. What it does not know stays as the words it is.
 */

export interface Run {
	text: string;
	bold?: boolean;
	italic?: boolean;
	code?: boolean;
	/** Where a link goes; the run is its words. */
	link?: string;
}

export type Block =
	| { kind: "heading"; level: 1 | 2 | 3; runs: Run[] }
	| { kind: "paragraph"; runs: Run[] }
	| { kind: "item"; ordered: boolean; number: number; depth: number; checked?: boolean; runs: Run[] }
	| { kind: "quote"; runs: Run[] }
	| { kind: "code"; text: string }
	| { kind: "rule" };

/** The words inside a line, split into styled runs. */
export function inline(text: string): Run[] {
	const runs: Run[] = [];
	const push = (run: Run) => {
		if (!run.text) return;
		const last = runs.at(-1);
		if (last && !last.link && !run.link && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.code === !!run.code) last.text += run.text;
		else runs.push(run);
	};
	const walk = (s: string, style: { bold?: boolean; italic?: boolean }) => {
		let i = 0;
		let plain = "";
		const flush = () => {
			push({ text: plain, ...style });
			plain = "";
		};
		while (i < s.length) {
			const rest = s.slice(i);
			// `code`: nothing inside is read.
			const code = /^`([^`]+)`/.exec(rest);
			if (code) {
				flush();
				push({ text: code[1]!, code: true, ...style });
				i += code[0].length;
				continue;
			}
			// [words](url)
			const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
			if (link) {
				flush();
				for (const run of inline(link[1]!)) push({ ...run, ...style, ...(run.bold ? { bold: true } : {}), link: link[2]! });
				i += link[0].length;
				continue;
			}
			// **bold** or __bold__
			const bold = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
			if (bold) {
				flush();
				walk(bold[2]!, { ...style, bold: true });
				i += bold[0].length;
				continue;
			}
			// *italic* or _italic_, and an underscore inside a word is only an underscore
			const italic = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?![\w*])/.exec(rest);
			if (italic && !(italic[1] === "_" && /\w$/.test(plain))) {
				flush();
				walk(italic[2]!, { ...style, italic: true });
				i += italic[0].length;
				continue;
			}
			plain += s[i];
			i += 1;
		}
		flush();
	};
	walk(text, {});
	return runs;
}

/** A card's markdown, as the blocks it is drawn in, top to bottom. */
export function parseMarkdown(source: string): Block[] {
	const blocks: Block[] = [];
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	let paragraph: string[] = [];
	const endParagraph = () => {
		if (paragraph.length) blocks.push({ kind: "paragraph", runs: inline(paragraph.join(" ")) });
		paragraph = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (/^\s*```/.test(line)) {
			endParagraph();
			const body: string[] = [];
			for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]!); i++) body.push(lines[i]!);
			blocks.push({ kind: "code", text: body.join("\n") });
			continue;
		}
		if (!line.trim()) {
			endParagraph();
			continue;
		}
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			endParagraph();
			blocks.push({ kind: "heading", level: Math.min(3, heading[1]!.length) as 1 | 2 | 3, runs: inline(heading[2]!.replace(/\s+#+\s*$/, "")) });
			continue;
		}
		if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
			endParagraph();
			blocks.push({ kind: "rule" });
			continue;
		}
		const item = /^(\s*)([-*+]|(\d+)[.)])\s+(.*)$/.exec(line);
		if (item) {
			endParagraph();
			const depth = Math.min(4, Math.floor(item[1]!.replace(/\t/g, "  ").length / 2));
			let text = item[4]!;
			const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
			if (task) text = task[2]!;
			blocks.push({ kind: "item", ordered: !!item[3], number: item[3] ? Number(item[3]) : 0, depth, ...(task ? { checked: task[1] !== " " } : {}), runs: inline(text) });
			continue;
		}
		const quote = /^\s*>\s?(.*)$/.exec(line);
		if (quote) {
			endParagraph();
			const last = blocks.at(-1);
			if (last?.kind === "quote" && lines[i - 1]?.trim().startsWith(">")) last.runs.push(...inline(` ${quote[1]}`));
			else blocks.push({ kind: "quote", runs: inline(quote[1]!) });
			continue;
		}
		paragraph.push(line.trim());
	}
	endParagraph();
	return blocks;
}
